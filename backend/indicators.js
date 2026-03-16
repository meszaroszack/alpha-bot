/**
 * Technical indicators for the Alpha Bot trading engine.
 * All functions operate on arrays of close prices (numbers).
 */

/** Simple Moving Average */
export function sma(prices, period) {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

/** Wilder's RSI(14) — standard implementation */
export function rsi(prices, period = 14) {
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
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** EMA — exponential moving average */
export function ema(prices, period) {
  if (prices.length < period) return null;
  const k = 2 / (period + 1);
  let val = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) val = prices[i] * k + val * (1 - k);
  return val;
}

/** MACD(12,26,9) — returns { macd, signal, histogram } */
export function macd(prices, fast = 12, slow = 26, signal = 9) {
  if (prices.length < slow + signal) return null;
  // Build EMA series for signal line
  const macdLine = [];
  for (let i = slow - 1; i < prices.length; i++) {
    const slice = prices.slice(0, i + 1);
    const e12 = ema(slice, fast);
    const e26 = ema(slice, slow);
    if (e12 != null && e26 != null) macdLine.push(e12 - e26);
  }
  if (macdLine.length < signal) return null;
  const signalLine = ema(macdLine, signal);
  const macdVal = macdLine[macdLine.length - 1];
  return { macd: macdVal, signal: signalLine, histogram: macdVal - signalLine };
}

/** Previous MACD histogram value — for crossover detection */
export function macdPrev(prices, fast = 12, slow = 26, signal = 9) {
  if (prices.length < slow + signal + 1) return null;
  return macd(prices.slice(0, -1), fast, slow, signal);
}

/** Bollinger Bands(20, 2) — returns { upper, middle, lower } */
export function bollingerBands(prices, period = 20, stdDev = 2) {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  return { upper: mean + stdDev * sd, middle: mean, lower: mean - stdDev * sd, bandwidth: (2 * stdDev * sd) / mean };
}

/** ATR(14) — needs OHLC candles [{high, low, close}] */
export function atr(candles, period = 14) {
  if (candles.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const { high, low } = candles[i];
    const prevClose = candles[i - 1].close;
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  // Wilder's smoothing
  let atrVal = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) atrVal = (atrVal * (period - 1) + trs[i]) / period;
  return atrVal;
}

/**
 * Strategy A — Algo (RSI + MACD momentum or mean-reversion)
 * Returns: { signal: 'YES'|'NO'|null, confidence: 0-100, rsi, macd, histogram }
 */
export function strategyAlgo(closes, mode = 'momentum') {
  const rsiVal = rsi(closes);
  const macdData = macd(closes);
  const macdPrevData = macdPrev(closes);

  if (rsiVal == null || macdData == null || macdPrevData == null) {
    return { signal: null, confidence: 0, rsi: rsiVal, macd: macdData?.macd, histogram: macdData?.histogram, reason: 'Insufficient data' };
  }

  const { macd: macdVal, signal: signalLine, histogram } = macdData;
  const prevHistogram = macdPrevData.histogram;

  // Crossover detection
  const bullishCross = prevHistogram <= 0 && histogram > 0;
  const bearishCross = prevHistogram >= 0 && histogram < 0;

  let signal = null;
  let confidence = 0;

  if (mode === 'momentum') {
    // Both RSI and MACD must agree
    if (rsiVal > 55 && (bullishCross || (histogram > 0 && macdVal > 0))) {
      signal = 'YES';
      const rsiStrength = Math.min((rsiVal - 55) / 30, 1); // 0-1
      const macdStrength = Math.min(Math.abs(histogram) / 200, 1);
      confidence = Math.round(50 + rsiStrength * 25 + macdStrength * 25);
    } else if (rsiVal < 45 && (bearishCross || (histogram < 0 && macdVal < 0))) {
      signal = 'NO';
      const rsiStrength = Math.min((45 - rsiVal) / 30, 1);
      const macdStrength = Math.min(Math.abs(histogram) / 200, 1);
      confidence = Math.round(50 + rsiStrength * 25 + macdStrength * 25);
    }
  } else if (mode === 'mean_reversion') {
    // Fade RSI extremes
    if (rsiVal > 70 && bearishCross) {
      signal = 'NO'; // Overbought, fade
      confidence = Math.round(50 + Math.min((rsiVal - 70) / 20, 1) * 50);
    } else if (rsiVal < 30 && bullishCross) {
      signal = 'YES'; // Oversold, fade
      confidence = Math.round(50 + Math.min((30 - rsiVal) / 20, 1) * 50);
    }
  }

  return { signal, confidence, rsi: rsiVal, macd: macdVal, signal_line: signalLine, histogram, mode };
}

/**
 * Strategy B — Volatility Scalper (Bollinger Bands + ATR)
 * Returns: { signal: 'YES'|'NO'|null, confidence: 0-100, bb, atr }
 */
export function strategyScalper(closes, candles) {
  const bb = bollingerBands(closes);
  const atrVal = atr(candles);

  if (!bb || atrVal == null || closes.length < 2) {
    return { signal: null, confidence: 0, bb, atr: atrVal, reason: 'Insufficient data' };
  }

  const price = closes[closes.length - 1];
  const prevAtr = atr(candles.slice(0, -1));
  const atrExpanding = prevAtr != null && atrVal > prevAtr;

  // Position within bands (0=lower, 0.5=middle, 1=upper)
  const bbRange = bb.upper - bb.lower || 1;
  const bbPosition = (price - bb.lower) / bbRange;

  let signal = null;
  let confidence = 0;

  if (atrExpanding) {
    if (bbPosition < 0.15) {
      // Price near lower band with expanding volatility → mean revert up → YES
      signal = 'YES';
      confidence = Math.round(65 + (0.15 - bbPosition) / 0.15 * 35);
    } else if (bbPosition > 0.85) {
      // Price near upper band → mean revert down → NO
      signal = 'NO';
      confidence = Math.round(65 + (bbPosition - 0.85) / 0.15 * 35);
    }
  }

  return { signal, confidence, bb, atr: atrVal, atrExpanding, bbPosition, price };
}
