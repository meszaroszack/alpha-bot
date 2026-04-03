/**
 * indicators.js — Four trading strategies + external signals for Alpha Bot.
 *
 * Strategies:
 *   A) Swing   — EMA crossover + velocity + swing detection (ported from kalshi-trader)
 *   B) Theta   — time-decay / reference-aligned bias for KXBTC15M (15m over/under)
 *   C) Scalper — Bollinger Bands + ATR volatility scalper
 *   D) Momentum — RSI + MACD crossover with divergence detection
 *
 * Each analyze function returns:
 *   { signal, confidence, reasoning[], stopLoss, targetPrice, strategyName, indicators{} }
 */

import axios from 'axios';

// ── Strategy enum ─────────────────────────────────────────────────────────────
export const STRATEGIES = {
  SWING:    'swing',
  THETA:    'theta',
  SCALPER:  'scalper',
  MOMENTUM: 'momentum',
};

// ── Technical indicator helpers ───────────────────────────────────────────────

function sma(prices, period) {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function ema(prices, period) {
  if (prices.length < period) return null;
  const k = 2 / (period + 1);
  let val = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) val = prices[i] * k + val * (1 - k);
  return val;
}

function emaArray(prices, period) {
  if (prices.length < period) return [];
  const k = 2 / (period + 1);
  const result = [];
  let val = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result.push(val);
  for (let i = period; i < prices.length; i++) {
    val = prices[i] * k + val * (1 - k);
    result.push(val);
  }
  return result;
}

function rsi(prices, period = 14) {
  if (prices.length < period + 1) return null;
  const deltas = [];
  for (let i = 1; i < prices.length; i++) deltas.push(prices[i] - prices[i - 1]);

  let avgGain = 0, avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (deltas[i] > 0) avgGain += deltas[i];
    else avgLoss += Math.abs(deltas[i]);
  }
  avgGain /= period;
  avgLoss /= period;

  for (let i = period; i < deltas.length; i++) {
    const gain = deltas[i] > 0 ? deltas[i] : 0;
    const loss = deltas[i] < 0 ? Math.abs(deltas[i]) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function macdCalc(prices, fast = 12, slow = 26, sig = 9) {
  if (prices.length < slow + sig) return null;
  const macdLine = [];
  for (let i = slow - 1; i < prices.length; i++) {
    const slice = prices.slice(0, i + 1);
    const e12 = ema(slice, fast);
    const e26 = ema(slice, slow);
    if (e12 != null && e26 != null) macdLine.push(e12 - e26);
  }
  if (macdLine.length < sig) return null;
  const signalLine = ema(macdLine, sig);
  const value = macdLine[macdLine.length - 1];
  return { value, signal: signalLine, histogram: value - signalLine };
}

function macdPrev(prices, fast = 12, slow = 26, sig = 9) {
  if (prices.length < slow + sig + 1) return null;
  return macdCalc(prices.slice(0, -1), fast, slow, sig);
}

function bollingerBands(prices, period = 20, stdDev = 2) {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  return { upper: mean + stdDev * sd, middle: mean, lower: mean - stdDev * sd };
}

function atr(candles, period = 14) {
  if (candles.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const { high, low } = candles[i];
    const prevClose = candles[i - 1].close;
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  let atrVal = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) atrVal = (atrVal * (period - 1) + trs[i]) / period;
  return atrVal;
}

function calcVelocity(prices, period = 5) {
  if (prices.length < period * 2) return 0;
  const recent = prices.slice(-period);
  const prior = prices.slice(-period * 2, -period);
  const recentMove = (recent[recent.length - 1] - recent[0]) / recent[0] * 100;
  const priorMove = (prior[prior.length - 1] - prior[0]) / prior[0] * 100;
  return recentMove - priorMove;
}

function detectSwing(prices, lookback = 3, threshold = 0.05) {
  if (prices.length < lookback + 1) return 0;
  const from = prices[prices.length - 1 - lookback];
  const to = prices[prices.length - 1];
  const changePct = ((to - from) / from) * 100;
  return Math.abs(changePct) >= threshold ? changePct : 0;
}

// ── External Signals (shared) ─────────────────────────────────────────────────

let _externalCache = null;
let _externalCacheTs = 0;
const EXTERNAL_CACHE_TTL = 30_000; // 30 seconds

export async function getExternalSignals() {
  if (_externalCache && Date.now() - _externalCacheTs < EXTERNAL_CACHE_TTL) {
    return _externalCache;
  }

  const result = {
    fearGreedIndex: 50,
    fearGreedLabel: 'Neutral',
    fundingRate: 0,
    orderbookPressure: 0,
    btcPrice: 0,
  };

  // Fear & Greed
  try {
    const { data } = await axios.get('https://api.alternative.me/fng/?limit=1', { timeout: 5000 });
    const fng = data?.data?.[0];
    if (fng) {
      result.fearGreedIndex = parseInt(fng.value, 10) || 50;
      result.fearGreedLabel = fng.value_classification || 'Neutral';
    }
  } catch (_) {}

  // Binance funding rate + BTC price
  try {
    const { data } = await axios.get('https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT', { timeout: 5000 });
    result.fundingRate = parseFloat(data?.lastFundingRate) || 0;
    result.btcPrice = parseFloat(data?.markPrice) || 0;
  } catch (_) {}

  // Orderbook pressure
  try {
    const { data } = await axios.get('https://api.binance.com/api/v3/depth?symbol=BTCUSDT&limit=20', { timeout: 5000 });
    const bids = (data?.bids || []).reduce((s, [, qty]) => s + parseFloat(qty), 0);
    const asks = (data?.asks || []).reduce((s, [, qty]) => s + parseFloat(qty), 0);
    const total = bids + asks;
    result.orderbookPressure = total > 0 ? (bids - asks) / total : 0;
  } catch (_) {}

  _externalCache = result;
  _externalCacheTs = Date.now();
  return result;
}

// ── Strategy A: Swing ─────────────────────────────────────────────────────────
// Ported from kalshi-trader: EMA crossover, velocity, swing detection

export function analyzeSwing(candles, currentPrice, marketInfo, externalSignals) {
  const closes = candles.map(c => c.close);
  const reasoning = [];
  const indicators = {};

  if (closes.length < 20) {
    return {
      signal: 'NONE', confidence: 0, reasoning: [`Warming up (${closes.length}/20 candles)`],
      stopLoss: null, targetPrice: null, strategyName: 'Swing', indicators,
    };
  }

  // KXBTC15M reference price alignment
  // gapPct: how far current BTC is above(+) or below(-) the market's opening reference price
  const referencePrice = marketInfo?.referencePrice ?? null;
  const gapPct = marketInfo?.gapPct ?? null;
  let refBonus = 0; // confidence adjustment based on gap alignment with signal

  // EMAs
  const emaFast = ema(closes, 5);
  const emaSlow = ema(closes, 20);
  indicators.emaFast = emaFast;
  indicators.emaSlow = emaSlow;

  // RSI
  const rsiVal = rsi(closes);
  indicators.rsi = rsiVal;

  // MACD
  const macdData = macdCalc(closes);
  indicators.macd = macdData;

  // Velocity
  const velocity = calcVelocity(closes, 5);
  indicators.velocity = velocity;

  // Swing detection
  const swingPct = detectSwing(closes, 3, 0.05);

  // ── Scoring ──────────────────────────────────────────────────────
  let emaScore = 0;        // 0-20
  let velocityScore = 0;   // 0-20
  let swingScore = 0;      // 0-20
  let externalScore = 0;   // 0-20
  let contextScore = 0;    // 0-20

  // EMA alignment (20pts)
  if (emaFast != null && emaSlow != null) {
    const emaAligned = emaFast > emaSlow;
    if (emaAligned) {
      emaScore = 20;
      reasoning.push('✓ EMA 5 > EMA 20 (bullish)');
    } else {
      emaScore = 0;
      reasoning.push('✗ EMA 5 < EMA 20 (bearish)');
    }
  }

  // Velocity (20pts)
  const absVelocity = Math.abs(velocity);
  velocityScore = Math.min(20, Math.round(absVelocity / 0.1 * 20));
  if (velocity > 0.02) {
    reasoning.push(`✓ Velocity: +${velocity.toFixed(3)}% (accelerating up)`);
  } else if (velocity < -0.02) {
    reasoning.push(`✓ Velocity: ${velocity.toFixed(3)}% (accelerating down)`);
  } else {
    reasoning.push(`→ Velocity: ${velocity.toFixed(3)}% (flat)`);
  }

  // Swing position (20pts)
  if (swingPct !== 0) {
    swingScore = Math.min(20, Math.round(Math.abs(swingPct) / 0.05 * 5));
    reasoning.push(`✓ Swing detected: ${swingPct > 0 ? '+' : ''}${swingPct.toFixed(2)}%`);
  } else {
    reasoning.push('→ No swing detected');
  }

  // External signals (20pts)
  if (externalSignals) {
    indicators.fearGreedIndex = externalSignals.fearGreedIndex;
    indicators.fundingRate = externalSignals.fundingRate;
    indicators.orderbookPressure = externalSignals.orderbookPressure;

    // Fear & Greed normalization: (value/100 - 0.5) * 2 → -1 to +1
    const fgNorm = (externalSignals.fearGreedIndex / 100 - 0.5) * 2;
    // Funding rate: positive = bullish
    const frNorm = externalSignals.fundingRate > 0.0003 ? 0.5 : externalSignals.fundingRate < -0.0001 ? -0.5 : 0;
    // Orderbook pressure: direct
    const obNorm = Math.max(-1, Math.min(1, externalSignals.orderbookPressure * 2));

    // Compute composite score BEFORE using it (fix compositeScore bug)
    const subScores = { fg: fgNorm * 0.25, fr: frNorm * 0.25, ob: obNorm * 0.35, momentum: 0.15 * (velocity > 0 ? 1 : velocity < 0 ? -1 : 0) };
    const compositeScore = Object.values(subScores).reduce((a, b) => a + b, 0);

    externalScore = Math.round(Math.abs(compositeScore) * 20);
    reasoning.push(`→ F&G: ${externalSignals.fearGreedIndex} ${externalSignals.fearGreedLabel}`);
    reasoning.push(`→ Funding: ${(externalSignals.fundingRate * 100).toFixed(4)}%`);
    reasoning.push(`→ OB pressure: ${externalSignals.orderbookPressure > 0 ? '+' : ''}${externalSignals.orderbookPressure.toFixed(3)}`);
  }

  // Market context (20pts)
  if (rsiVal != null) {
    if (rsiVal > 55 && rsiVal < 75) contextScore += 10;
    else if (rsiVal < 45 && rsiVal > 25) contextScore += 10;
    if (macdData && macdData.histogram > 0) contextScore += 10;
    else if (macdData && macdData.histogram < 0) contextScore += 5;
    reasoning.push(`→ RSI: ${rsiVal.toFixed(1)}`);
  }

  // ── Determine signal direction ──────────────────────────────────
  const maxScore = 100;
  const compositeScore = emaScore + velocityScore + swingScore + externalScore + contextScore;
  const confidence = Math.min(100, Math.round(compositeScore / maxScore * 100));

  let signal = 'NONE';
  let stopLoss = null;
  let targetPrice = null;

  // Bullish conditions
  const bullish = (emaFast > emaSlow) && (velocity > 0 || swingPct > 0);
  // Bearish conditions
  const bearish = (emaFast < emaSlow) && (velocity < 0 || swingPct < 0);

  // RSI sanity: overbought fade risk
  let rsiPenalty = 0;
  if (rsiVal != null && rsiVal > 72 && bullish) rsiPenalty = 15;
  if (rsiVal != null && rsiVal < 28 && bearish) rsiPenalty = 15;

  const adjustedConf = Math.max(0, confidence - rsiPenalty);

  if (bullish && adjustedConf >= 55) {
    signal = 'YES';
    if (currentPrice) {
      stopLoss = Math.round(currentPrice * 0.985);
      targetPrice = Math.round(currentPrice * 1.02);
    }
  } else if (bearish && adjustedConf >= 55) {
    signal = 'NO';
    if (currentPrice) {
      stopLoss = Math.round(currentPrice * 1.015);
      targetPrice = Math.round(currentPrice * 0.98);
    }
  }

  if (rsiPenalty > 0) {
    reasoning.push(`✗ RSI ${rsiVal > 72 ? 'overbought' : 'oversold'} penalty: -${rsiPenalty}%`);
  }

  // Reference price alignment: if BTC is already above ref and signal is YES → bonus
  // If BTC is already below ref and signal is NO → bonus
  // If signal contradicts current gap direction → penalty
  if (gapPct !== null && signal !== 'NONE') {
    if (signal === 'YES' && gapPct > 0.1) {
      refBonus = 8;
      reasoning.push(`✓ BTC already +${gapPct.toFixed(2)}% above ref — YES momentum confirmed`);
    } else if (signal === 'YES' && gapPct < -0.3) {
      refBonus = -10;
      reasoning.push(`✗ BTC ${gapPct.toFixed(2)}% BELOW ref — YES signal fighting the gap`);
    } else if (signal === 'NO' && gapPct < -0.1) {
      refBonus = 8;
      reasoning.push(`✓ BTC already ${gapPct.toFixed(2)}% below ref — NO momentum confirmed`);
    } else if (signal === 'NO' && gapPct > 0.3) {
      refBonus = -10;
      reasoning.push(`✗ BTC +${gapPct.toFixed(2)}% ABOVE ref — NO signal fighting the gap`);
    }
    reasoning.push(`→ Market ref: $${referencePrice?.toLocaleString()} | gap: ${gapPct >= 0 ? '+' : ''}${gapPct.toFixed(2)}%`);
  }

  // Apply refBonus to final confidence
  const finalConfidence = Math.min(100, Math.max(0, adjustedConf + refBonus));

  return {
    signal,
    confidence: finalConfidence,
    reasoning,
    stopLoss,
    targetPrice,
    strategyName: 'Swing',
    indicators,
  };
}

// ── Strategy B: Theta (15M) ─────────────────────────────────────────────────────
// KXBTC15M: time-decay NO bias when flat/weak; not KXBTCD strike-cushion logic

export function analyzeThetaDecay(candles, currentPrice, marketInfo, externalSignals) {
  // For KXBTC15M: theta strategy = prefer NO entries when BTC is flat or showing weakness
  // because NO contracts near 50¢ have the most convexity — if BTC stays flat, NO wins
  //
  // This is NOT the old KXBTCD strike-cushion strategy.
  // Entry conditions: time remaining 5-13 min, BTC showing flat or downward momentum, NO ask >= 0.45

  const reasoning = [];
  const indicators = {};

  if (!marketInfo?.ticker) {
    return { signal: 'NONE', confidence: 0, reasoning: ['No market data'], stopLoss: null, targetPrice: null, strategyName: 'Theta (15M)', indicators };
  }

  const { closeTime, referencePrice, gapPct } = marketInfo;
  const now = Date.now();
  const minutesToExpiry = closeTime ? (new Date(closeTime).getTime() - now) / 60000 : null;

  indicators.minutesToExpiry = minutesToExpiry;
  indicators.referencePrice  = referencePrice;
  indicators.gapPct          = gapPct;

  if (minutesToExpiry == null || minutesToExpiry < 2) {
    return { signal: 'NONE', confidence: 0, reasoning: ['<2 min to expiry — skip'], stopLoss: null, targetPrice: null, strategyName: 'Theta (15M)', indicators };
  }

  const closes = candles.map(c => c.close);
  if (closes.length < 5) {
    return { signal: 'NONE', confidence: 0, reasoning: [`Warming up (${closes.length}/5 candles)`], stopLoss: null, targetPrice: null, strategyName: 'Theta (15M)', indicators };
  }

  const rsiVal = rsi(closes);
  const recentMomentum = closes.length >= 6
    ? ((closes[closes.length - 1] - closes[closes.length - 6]) / closes[closes.length - 6]) * 100
    : 0;

  indicators.rsi = rsiVal;
  indicators.recentMomentum = recentMomentum;

  let confidence = 40;
  let signal = 'NONE';

  reasoning.push(`→ ${minutesToExpiry.toFixed(0)} min to expiry`);
  reasoning.push(`→ Ref price: $${referencePrice?.toLocaleString() ?? 'N/A'} | gap: ${gapPct != null ? (gapPct >= 0 ? '+' : '') + gapPct.toFixed(2) + '%' : 'N/A'}`);

  // Ideal theta window: 5-13 minutes left (maximum time pressure)
  if (minutesToExpiry >= 5 && minutesToExpiry <= 13) {
    confidence += 20;
    reasoning.push('✓ Ideal theta window (5-13 min) — maximum time pressure');
  } else if (minutesToExpiry > 13 && minutesToExpiry <= 30) {
    confidence += 8;
    reasoning.push('→ Early-mid decay window (13-30 min)');
  } else {
    reasoning.push(`→ ${minutesToExpiry.toFixed(0)} min remaining — too early for theta bias`);
  }

  // Prefer NO when BTC is flat or slightly below reference (NO wins if BTC stays here)
  if (gapPct !== null && gapPct <= 0.1 && gapPct >= -0.5) {
    confidence += 15;
    signal = 'NO';
    reasoning.push(`✓ BTC near/below ref (${gapPct.toFixed(2)}%) — flat close likely resolves NO`);
  } else if (gapPct !== null && gapPct > 0.1 && gapPct < 0.5) {
    confidence += 5;
    signal = 'YES';
    reasoning.push(`→ BTC slightly above ref (+${gapPct.toFixed(2)}%) — gentle YES lean`);
  } else if (gapPct !== null && gapPct >= 0.5) {
    confidence += 15;
    signal = 'YES';
    reasoning.push(`✓ BTC +${gapPct.toFixed(2)}% above ref — YES likely at expiry`);
  } else if (gapPct !== null && gapPct <= -0.5) {
    confidence += 20;
    signal = 'NO';
    reasoning.push(`✓ BTC ${gapPct.toFixed(2)}% below ref — strong NO`);
  }

  // RSI filter
  if (rsiVal !== null) {
    indicators.rsi = rsiVal;
    if (rsiVal < 40 && signal === 'NO') { confidence += 10; reasoning.push(`✓ RSI ${rsiVal.toFixed(1)} confirms downside`); }
    else if (rsiVal > 60 && signal === 'YES') { confidence += 10; reasoning.push(`✓ RSI ${rsiVal.toFixed(1)} confirms upside`); }
    else reasoning.push(`→ RSI: ${rsiVal.toFixed(1)}`);
  }

  // Momentum filter
  if (Math.abs(recentMomentum) > 0.1) {
    if ((recentMomentum < 0 && signal === 'NO') || (recentMomentum > 0 && signal === 'YES')) {
      confidence += 10;
      reasoning.push(`✓ Momentum ${recentMomentum >= 0 ? '+' : ''}${recentMomentum.toFixed(3)}% confirms signal`);
    } else {
      confidence -= 8;
      reasoning.push(`✗ Momentum ${recentMomentum >= 0 ? '+' : ''}${recentMomentum.toFixed(3)}% contradicts signal`);
    }
  }

  confidence = Math.min(95, Math.max(0, confidence));
  if (confidence < 55) signal = 'NONE';

  return {
    signal,
    confidence,
    reasoning,
    stopLoss: null,
    targetPrice: null,
    strategyName: 'Theta (15M)',
    indicators,
  };
}

// ── Strategy C: Scalper (Bollinger + ATR) ─────────────────────────────────────

export function analyzeScalper(candles, currentPrice, marketInfo, externalSignals) {
  const closes = candles.map(c => c.close);
  const reasoning = [];
  const indicators = {};

  if (closes.length < 20) {
    return {
      signal: 'NONE', confidence: 0, reasoning: [`Warming up (${closes.length}/20 candles)`],
      stopLoss: null, targetPrice: null, strategyName: 'Scalper', indicators,
    };
  }

  // KXBTC15M reference price alignment
  // gapPct: how far current BTC is above(+) or below(-) the market's opening reference price
  const referencePrice = marketInfo?.referencePrice ?? null;
  const gapPct = marketInfo?.gapPct ?? null;
  let refBonus = 0; // confidence adjustment based on gap alignment with signal

  // Bollinger Bands
  const bb = bollingerBands(closes, 20, 2);
  indicators.bollingerBands = bb;

  // ATR
  const atrVal = atr(candles, 14);
  indicators.atr = atrVal;

  // ATR vs 15-period average
  let atrAvg = null;
  if (candles.length >= 16) {
    const atrValues = [];
    for (let i = 15; i <= candles.length; i++) {
      const v = atr(candles.slice(0, i), 14);
      if (v != null) atrValues.push(v);
    }
    if (atrValues.length > 0) atrAvg = atrValues.reduce((a, b) => a + b, 0) / atrValues.length;
  }

  if (!bb || atrVal == null) {
    return {
      signal: 'NONE', confidence: 0, reasoning: ['Indicator calculation failed'],
      stopLoss: null, targetPrice: null, strategyName: 'Scalper', indicators,
    };
  }

  const price = closes[closes.length - 1];
  const bbRange = bb.upper - bb.lower || 1;
  const bbPosition = (price - bb.lower) / bbRange; // 0=lower, 1=upper
  indicators.bbPosition = bbPosition;

  // ATR filter: only trade if ATR above average (market is moving)
  const atrAboveAvg = atrAvg != null && atrVal > atrAvg;

  // ── Confidence sub-scores ──────────────────────────────────────
  let bbScore = 0;       // 0-40
  let atrScore = 0;      // 0-30
  let volumeScore = 15;  // 0-30 (default 15 without volume data)

  let signal = 'NONE';
  let stopLoss = null;
  let targetPrice = null;

  // BB position scoring
  if (bbPosition <= 0.10) {
    bbScore = 40;
    signal = 'YES';
    reasoning.push(`✓ Price at lower BB (${(bbPosition * 100).toFixed(0)}%) — mean revert UP`);
    stopLoss = currentPrice ? Math.round(currentPrice - 1.5 * atrVal) : null;
    targetPrice = currentPrice ? Math.round(bb.middle) : null;
  } else if (bbPosition <= 0.20) {
    bbScore = 30;
    signal = 'YES';
    reasoning.push(`✓ Price near lower BB (${(bbPosition * 100).toFixed(0)}%) — YES signal`);
    stopLoss = currentPrice ? Math.round(currentPrice - 1.5 * atrVal) : null;
    targetPrice = currentPrice ? Math.round(bb.middle) : null;
  } else if (bbPosition >= 0.90) {
    bbScore = 40;
    signal = 'NO';
    reasoning.push(`✓ Price at upper BB (${(bbPosition * 100).toFixed(0)}%) — mean revert DOWN`);
    stopLoss = currentPrice ? Math.round(currentPrice + 1.5 * atrVal) : null;
    targetPrice = currentPrice ? Math.round(bb.middle) : null;
  } else if (bbPosition >= 0.80) {
    bbScore = 30;
    signal = 'NO';
    reasoning.push(`✓ Price near upper BB (${(bbPosition * 100).toFixed(0)}%) — NO signal`);
    stopLoss = currentPrice ? Math.round(currentPrice + 1.5 * atrVal) : null;
    targetPrice = currentPrice ? Math.round(bb.middle) : null;
  } else {
    reasoning.push(`→ Price in middle of BB (${(bbPosition * 100).toFixed(0)}%) — no edge`);
  }

  // ATR scoring
  if (atrAboveAvg) {
    atrScore = 30;
    reasoning.push(`✓ ATR ${atrVal.toFixed(2)} > avg ${atrAvg?.toFixed(2)} — volatility OK`);
  } else if (atrAvg != null) {
    atrScore = 10;
    reasoning.push(`✗ ATR ${atrVal.toFixed(2)} < avg ${atrAvg?.toFixed(2)} — low volatility`);
  } else {
    atrScore = 15;
    reasoning.push(`→ ATR: ${atrVal.toFixed(2)}`);
  }

  // External signals context
  if (externalSignals) {
    indicators.fearGreedIndex = externalSignals.fearGreedIndex;
    indicators.orderbookPressure = externalSignals.orderbookPressure;
    reasoning.push(`→ F&G: ${externalSignals.fearGreedIndex} ${externalSignals.fearGreedLabel}`);
  }

  const confidence = Math.min(100, bbScore + atrScore + volumeScore);

  // Reset signal if no edge found
  if (signal === 'NONE' || confidence < 60) {
    signal = 'NONE';
  }

  if (gapPct !== null && signal !== 'NONE') {
    if (signal === 'YES' && gapPct > 0.1) {
      refBonus = 8;
      reasoning.push(`✓ BTC +${gapPct.toFixed(2)}% above ref — YES aligns`);
    } else if (signal === 'YES' && gapPct < -0.3) {
      refBonus = -10;
      reasoning.push(`✗ BTC ${gapPct.toFixed(2)}% below ref — gap fights YES`);
    } else if (signal === 'NO' && gapPct < -0.1) {
      refBonus = 8;
      reasoning.push(`✓ BTC ${gapPct.toFixed(2)}% below ref — NO aligns`);
    } else if (signal === 'NO' && gapPct > 0.3) {
      refBonus = -10;
      reasoning.push(`✗ BTC +${gapPct.toFixed(2)}% above ref — gap fights NO`);
    }
    reasoning.push(`→ Market ref: $${referencePrice?.toLocaleString()} | gap: ${gapPct >= 0 ? '+' : ''}${gapPct.toFixed(2)}%`);
  }

  const finalConfidence = Math.min(100, Math.max(0, confidence + refBonus));
  if (finalConfidence < 60) signal = 'NONE';

  return {
    signal,
    confidence: finalConfidence,
    reasoning,
    stopLoss,
    targetPrice,
    strategyName: 'Scalper',
    indicators,
  };
}

// ── Strategy D: Momentum (RSI + MACD) ─────────────────────────────────────────

export function analyzeMomentum(candles, currentPrice, marketInfo, externalSignals) {
  const closes = candles.map(c => c.close);
  const reasoning = [];
  const indicators = {};

  if (closes.length < 27) {
    return {
      signal: 'NONE', confidence: 0, reasoning: [`Warming up (${closes.length}/27 candles)`],
      stopLoss: null, targetPrice: null, strategyName: 'Momentum', indicators,
    };
  }

  // KXBTC15M reference price alignment
  // gapPct: how far current BTC is above(+) or below(-) the market's opening reference price
  const referencePrice = marketInfo?.referencePrice ?? null;
  const gapPct = marketInfo?.gapPct ?? null;
  let refBonus = 0; // confidence adjustment based on gap alignment with signal

  // RSI
  const rsiVal = rsi(closes);
  const rsiPrev = rsi(closes.slice(0, -1));
  indicators.rsi = rsiVal;

  // MACD
  const macdData = macdCalc(closes);
  const macdPrevData = macdPrev(closes);
  indicators.macd = macdData;

  if (rsiVal == null || macdData == null || macdPrevData == null) {
    return {
      signal: 'NONE', confidence: 0, reasoning: ['Insufficient data for indicators'],
      stopLoss: null, targetPrice: null, strategyName: 'Momentum', indicators,
    };
  }

  const { histogram } = macdData;
  const prevHistogram = macdPrevData.histogram;

  // Crossover detection using previous bar comparison
  const bullishCross = prevHistogram <= 0 && histogram > 0;
  const bearishCross = prevHistogram >= 0 && histogram < 0;

  // RSI direction
  const rsiRising = rsiPrev != null && rsiVal > rsiPrev;
  const rsiFalling = rsiPrev != null && rsiVal < rsiPrev;

  // Divergence detection
  let bullishDivergence = false;
  let bearishDivergence = false;
  if (closes.length >= 10) {
    const recent5 = closes.slice(-5);
    const prior5 = closes.slice(-10, -5);
    const priceLow = Math.min(...recent5) < Math.min(...prior5);
    const priceHigh = Math.max(...recent5) > Math.max(...prior5);

    // Price makes new low but RSI doesn't = bullish divergence
    if (priceLow && rsiPrev != null && rsiVal > rsiPrev) bullishDivergence = true;
    // Price makes new high but RSI doesn't = bearish divergence
    if (priceHigh && rsiPrev != null && rsiVal < rsiPrev) bearishDivergence = true;
  }

  // ── Confidence sub-scores ──────────────────────────────────────
  let rsiScore = 0;         // 0-25
  let crossoverScore = 0;   // 0-25
  let histogramScore = 0;   // 0-25
  let divergenceScore = 0;  // 0-25

  let signal = 'NONE';
  let stopLoss = null;
  let targetPrice = null;

  // ── YES conditions ──────────────────────────────────────────────
  const yesRsi = rsiVal < 35 && rsiRising;
  const yesMacd = bullishCross || (histogram > 0 && macdData.value > macdData.signal);
  const yesHistogram = histogram > 0 && histogram > prevHistogram;

  // ── NO conditions ───────────────────────────────────────────────
  const noRsi = rsiVal > 65 && rsiFalling;
  const noMacd = bearishCross || (histogram < 0 && macdData.value < macdData.signal);
  const noHistogram = histogram < 0 && histogram < prevHistogram;

  if (yesRsi || bullishDivergence) {
    // RSI zone
    if (rsiVal < 30) { rsiScore = 25; reasoning.push(`✓ RSI ${rsiVal.toFixed(1)} oversold + rising`); }
    else if (rsiVal < 35) { rsiScore = 18; reasoning.push(`✓ RSI ${rsiVal.toFixed(1)} near oversold + rising`); }
    else if (bullishDivergence) { rsiScore = 15; reasoning.push('✓ Bullish RSI divergence detected'); }

    // MACD crossover
    if (bullishCross) { crossoverScore = 25; reasoning.push('✓ MACD bullish crossover'); }
    else if (yesMacd) { crossoverScore = 15; reasoning.push('✓ MACD positive'); }
    else { reasoning.push('→ MACD not confirming'); }

    // Histogram momentum
    if (yesHistogram) { histogramScore = 25; reasoning.push('✓ MACD histogram expanding (bullish)'); }
    else if (histogram > 0) { histogramScore = 12; reasoning.push('→ MACD histogram positive'); }
    else { reasoning.push('✗ MACD histogram negative'); }

    // Divergence
    if (bullishDivergence) { divergenceScore = 25; reasoning.push('✓ Bullish divergence: price low / RSI higher'); }

    signal = 'YES';
    if (currentPrice) {
      stopLoss = Math.round(currentPrice * 0.985);
      targetPrice = Math.round(currentPrice * 1.025);
    }
  } else if (noRsi || bearishDivergence) {
    // RSI zone
    if (rsiVal > 70) { rsiScore = 25; reasoning.push(`✓ RSI ${rsiVal.toFixed(1)} overbought + falling`); }
    else if (rsiVal > 65) { rsiScore = 18; reasoning.push(`✓ RSI ${rsiVal.toFixed(1)} near overbought + falling`); }
    else if (bearishDivergence) { rsiScore = 15; reasoning.push('✓ Bearish RSI divergence detected'); }

    // MACD crossover
    if (bearishCross) { crossoverScore = 25; reasoning.push('✓ MACD bearish crossover'); }
    else if (noMacd) { crossoverScore = 15; reasoning.push('✓ MACD negative'); }
    else { reasoning.push('→ MACD not confirming'); }

    // Histogram momentum
    if (noHistogram) { histogramScore = 25; reasoning.push('✓ MACD histogram expanding (bearish)'); }
    else if (histogram < 0) { histogramScore = 12; reasoning.push('→ MACD histogram negative'); }
    else { reasoning.push('✗ MACD histogram positive'); }

    // Divergence
    if (bearishDivergence) { divergenceScore = 25; reasoning.push('✓ Bearish divergence: price high / RSI lower'); }

    signal = 'NO';
    if (currentPrice) {
      stopLoss = Math.round(currentPrice * 1.015);
      targetPrice = Math.round(currentPrice * 0.975);
    }
  } else {
    reasoning.push(`→ RSI: ${rsiVal.toFixed(1)} (neutral zone)`);
    reasoning.push(`→ MACD histogram: ${histogram.toFixed(2)}`);
    reasoning.push('→ No momentum signal');
  }

  // External context
  if (externalSignals) {
    indicators.fearGreedIndex = externalSignals.fearGreedIndex;
    indicators.fundingRate = externalSignals.fundingRate;
    indicators.orderbookPressure = externalSignals.orderbookPressure;
    reasoning.push(`→ F&G: ${externalSignals.fearGreedIndex} ${externalSignals.fearGreedLabel}`);
  }

  const confidence = Math.min(100, rsiScore + crossoverScore + histogramScore + divergenceScore);

  if (confidence < 58) signal = 'NONE';

  if (gapPct !== null && signal !== 'NONE') {
    if (signal === 'YES' && gapPct > 0.1) {
      refBonus = 8;
      reasoning.push(`✓ BTC +${gapPct.toFixed(2)}% above ref — YES momentum aligns`);
    } else if (signal === 'YES' && gapPct < -0.3) {
      refBonus = -10;
      reasoning.push(`✗ BTC ${gapPct.toFixed(2)}% below ref — gap fights YES`);
    } else if (signal === 'NO' && gapPct < -0.1) {
      refBonus = 8;
      reasoning.push(`✓ BTC ${gapPct.toFixed(2)}% below ref — NO momentum aligns`);
    } else if (signal === 'NO' && gapPct > 0.3) {
      refBonus = -10;
      reasoning.push(`✗ BTC +${gapPct.toFixed(2)}% above ref — gap fights NO`);
    }
    reasoning.push(`→ Market ref: $${referencePrice?.toLocaleString()} | gap: ${gapPct >= 0 ? '+' : ''}${gapPct.toFixed(2)}%`);
  }

  const finalConfidence = Math.min(100, Math.max(0, confidence + refBonus));
  if (finalConfidence < 58) signal = 'NONE';

  return {
    signal,
    confidence: finalConfidence,
    reasoning,
    stopLoss,
    targetPrice,
    strategyName: 'Momentum',
    indicators,
  };
}
