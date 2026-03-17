/**
 * Bot Engine — server-side trading loop.
 * Polls Coinbase for BTC price, builds OHLCV candles,
 * runs indicators, places orders when bot is enabled.
 *
 * Supabase integration:
 *   - openBotRun()   on start()
 *   - insertSignal() every tick() evaluation
 *   - insertTrade()  on placeTrade() success
 *   - updateTrade()  on position reconciliation (after market settles)
 *   - closeBotRun()  on stop() or toggle-off
 */
import axios from 'axios';
import {
  analyzeSwing, analyzeThetaDecay, analyzeScalper, analyzeMomentum,
  getExternalSignals, STRATEGIES,
} from './indicators.js';
import { getBaseUrl, getKalshiPath, getAuthHeaders, calcFee } from './kalshiAuth.js';
import {
  openBotRun, closeBotRun, setRunStartBalance,
  insertSignal, insertTrade, updateTrade,
  upsertBotConfig, insertLog, isSupabaseEnabled,
} from './supabase.js';

const COINBASE_URL     = 'https://api.coinbase.com/v2/prices/BTC-USD/spot';
const CANDLE_PERIOD_MS = 15 * 60 * 1000; // 15 minutes
const PRICE_POLL_MS    = 15_000;          // poll Coinbase every 15s
const MAX_CANDLES      = 60;              // keep last 60 candles (~15 hours)
const MAX_CONSECUTIVE_LOSSES = 3;
const BALANCE_FLOOR    = 5;              // stop trading below $5

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export class BotEngine {
  constructor() {
    // Config (user-adjustable)
    this.config = {
      strategy:            'swing',  // 'swing' | 'theta' | 'scalper' | 'momentum'
      riskPct:             25,       // % of balance per trade
      maxPositions:        3,
      minConfidence:       55,
      dailyLossLimitPct:   20,       // stop if balance drops this % in a day
      maxTradeSize:        50,       // hard cap per trade in dollars
      maxContractsPerTrade: 10,      // position sizing cap
      cooldownMinutes:     5,        // minutes to wait after a loss
      botEnabled:          false,
    };

    // Runtime state
    this.state = {
      btcPrice:            null,
      candles:             [],        // [{open,high,low,close,timestamp}]
      currentCandle:       null,
      indicators:          {},
      signal:              null,
      lastSignal:          null,      // full signal result for UI
      openPositions:       [],
      sessionStartBalance: null,
      currentBalance:      null,
      sessionPnl:          0,
      feesTotal:           0,
      tradeLog:            [],
      consecutiveLosses:   0,
      dailyStartBalance:   null,
      activeMarket:        null,      // current KXBTC15M-* or KXBTCD-* market
      reconnectCount:      0,
      cooldownUntil:       0,         // timestamp — skip trading until this time
      externalSignals:     null,      // cached external signals

      // Supabase run tracking
      supabaseRunId:       null,      // UUID of the current bot_run row
      supabaseTradeId:     null,      // UUID of the currently open trade row
    };

    // Kalshi credentials (set via setCredentials)
    this.credentials = { apiKeyId: null, privateKeyPem: null, environment: 'Demo' };

    // Subscribers for SSE/WS push
    this._listeners   = [];
    this._pollTimer   = null;
    this._marketRefreshTimer  = null;
    this._balanceRefreshTimer = null;
  }

  setCredentials(apiKeyId, privateKeyPem, environment) {
    this.credentials = { apiKeyId, privateKeyPem, environment };
    this.state.sessionStartBalance = null;
    this.state.dailyStartBalance   = null;
  }

  setConfig(partial) {
    this.config = { ...this.config, ...partial };
    this.emit('config', this.config);
    // Persist config change to Supabase (non-blocking)
    upsertBotConfig(this.config);
  }

  setBotEnabled(enabled) {
    this.config.botEnabled = enabled;
    this.emit('bot_toggle', { enabled });
    upsertBotConfig(this.config);

    if (enabled) {
      this.emit('log', { msg: `Bot ENABLED — strategy: ${this.config.strategy}`, type: 'success' });
      insertLog('info', `Bot enabled`, { strategy: this.config.strategy }, this.state.supabaseRunId);
    } else {
      this.emit('log', { msg: 'Bot DISABLED — signals still running', type: 'info' });
      insertLog('info', 'Bot disabled', {}, this.state.supabaseRunId);
      // Close the run when bot is turned off
      this._closeRun('stopped');
    }
  }

  on(listener)  { this._listeners.push(listener); }
  off(listener) { this._listeners = this._listeners.filter(l => l !== listener); }
  emit(type, data) {
    this._listeners.forEach(fn => { try { fn({ type, ...data }); } catch (_) {} });
  }

  // ─── Internal Supabase run management ──────────────────────────────────────

  async _openRun() {
    if (!isSupabaseEnabled()) return;
    try {
      const runId = await openBotRun({
        strategy:      this.config.strategy,
        riskPct:       this.config.riskPct,
        minConfidence: this.config.minConfidence,
        environment:   this.credentials.environment,
      });
      this.state.supabaseRunId = runId;
      if (runId) console.log(`[Engine] Supabase run opened: ${runId}`);
    } catch (e) {
      // Supabase is optional — a failure here must never stop the trading engine
      console.warn('[Engine] _openRun failed (non-fatal) — trading continues without Supabase:', e.message);
      this.state.supabaseRunId = null;
    }
  }

  async _closeRun(status = 'stopped') {
    if (!this.state.supabaseRunId) return;
    const trades = this.state.tradeLog;
    const totalPnl   = trades.reduce((s, t) => s + (t.pnl ?? 0), 0);
    const totalFees  = this.state.feesTotal;
    const tradeCount = trades.length;
    await closeBotRun(this.state.supabaseRunId, {
      status,
      finalBalance: this.state.currentBalance,
      totalPnl,
      totalFees,
      tradeCount,
    });
    this.state.supabaseRunId = null;
  }

  // ─── Price Feed ─────────────────────────────────────────────────────────────

  async fetchBtcPrice() {
    try {
      const { data } = await axios.get(COINBASE_URL, { timeout: 5000 });
      return parseFloat(data.data.amount);
    } catch (_) {
      return null;
    }
  }

  updateCandle(price) {
    const now        = Date.now();
    const candleStart = Math.floor(now / CANDLE_PERIOD_MS) * CANDLE_PERIOD_MS;

    if (!this.state.currentCandle || this.state.currentCandle.timestamp !== candleStart) {
      // Close previous candle
      if (this.state.currentCandle) {
        this.state.candles.push({ ...this.state.currentCandle });
        if (this.state.candles.length > MAX_CANDLES) this.state.candles.shift();
      }
      // Open new candle
      this.state.currentCandle = {
        open: price, high: price, low: price, close: price, timestamp: candleStart,
      };
    } else {
      this.state.currentCandle.close = price;
      this.state.currentCandle.high  = Math.max(this.state.currentCandle.high, price);
      this.state.currentCandle.low   = Math.min(this.state.currentCandle.low, price);
    }
  }

  getAllCandles() {
    const all = [...this.state.candles];
    if (this.state.currentCandle) all.push({ ...this.state.currentCandle });
    return all;
  }

  // ─── Kalshi API calls ────────────────────────────────────────────────────────

  async kalshiGet(path) {
    const { apiKeyId, privateKeyPem, environment } = this.credentials;
    const base     = getBaseUrl(environment);
    const fullPath = getKalshiPath(path);
    const ts       = String(Date.now());
    const headers  = getAuthHeaders(apiKeyId, privateKeyPem, 'GET', fullPath, ts);
    const { data } = await axios.get(`${base}${fullPath}`, { headers, timeout: 8000 });
    return data;
  }

  async kalshiPost(path, body) {
    const { apiKeyId, privateKeyPem, environment } = this.credentials;
    const base     = getBaseUrl(environment);
    const fullPath = getKalshiPath(path);
    const ts       = String(Date.now());
    const headers  = getAuthHeaders(apiKeyId, privateKeyPem, 'POST', fullPath, ts);
    const { data } = await axios.post(`${base}${fullPath}`, body, { headers, timeout: 8000 });
    return data;
  }

  async kalshiDelete(path) {
    const { apiKeyId, privateKeyPem, environment } = this.credentials;
    const base     = getBaseUrl(environment);
    const fullPath = getKalshiPath(path);
    const ts       = String(Date.now());
    const headers  = getAuthHeaders(apiKeyId, privateKeyPem, 'DELETE', fullPath, ts);
    const { data } = await axios.delete(`${base}${fullPath}`, { headers, timeout: 8000 });
    return data;
  }

  async fetchBalance() {
    try {
      const data    = await this.kalshiGet('/portfolio/balance');
      const balance = (data.balance || 0) / 100; // cents → dollars
      this.state.currentBalance = balance;

      // First fetch of the session — capture session start balance
      const isFirstFetch = this.state.sessionStartBalance == null;
      if (isFirstFetch) {
        this.state.sessionStartBalance = balance;
        this.state.dailyStartBalance   = balance;
        // Write start balance to the open bot_run row
        if (this.state.supabaseRunId) {
          setRunStartBalance(this.state.supabaseRunId, balance);
        }
      }

      this.emit('balance', { balance, sessionStartBalance: this.state.sessionStartBalance });
      return balance;
    } catch (err) {
      this.emit('log', { msg: `Balance fetch failed: ${err.message}`, type: 'error' });
      insertLog('error', `Balance fetch failed: ${err.message}`, {}, this.state.supabaseRunId);
      return null;
    }
  }

  async fetchActiveMarket() {
    try {
      // Kalshi market status values: 'active' (trading now), 'initialized' (upcoming), 'finalized'
      // Do NOT use 'open' — it returns nothing. Query without status filter and pick by time.
      const seriesTicker = this.config.strategy === 'theta' ? 'KXBTCD' : 'KXBTC15M';
      const data = await this.kalshiGet(`/markets?series_ticker=${seriesTicker}&limit=20`);
      const markets = data.markets || [];

      const now = Date.now();

      // Prefer 'active' markets (currently trading). If none, use the next 'initialized' one.
      // Filter out already-finalized markets and ones closing in <2 min (too late to trade).
      const tradeable = markets
        .filter(m => {
          const closeMs = new Date(m.close_time).getTime();
          const minToClose = (closeMs - now) / 60000;
          return (m.status === 'active' || m.status === 'initialized') && minToClose > 2;
        })
        .sort((a, b) => new Date(a.close_time) - new Date(b.close_time));

      if (tradeable.length === 0) {
        this.emit('log', { msg: 'No tradeable markets found for series ' + seriesTicker, type: 'warn' });
        return null;
      }

      const market = tradeable[0];

      // The list endpoint returns null for yes_bid/yes_ask — fetch live prices from orderbook.
      let yesBid = 0, yesAsk = 0, noBid = 0, noAsk = 0;
      try {
        const ob = await this.kalshiGet(`/markets/${market.ticker}/orderbook`);
        const obData = ob.orderbook_fp || ob.orderbook || {};

        // yes_dollars: array of [price, quantity] — best bid = highest price with liquidity
        const yesBids = (obData.yes_dollars || []).map(([p]) => parseFloat(p)).filter(p => p > 0);
        const noBids  = (obData.no_dollars  || []).map(([p]) => parseFloat(p)).filter(p => 0 < p);

        if (yesBids.length) {
          yesBid = Math.max(...yesBids);
          yesAsk = parseFloat((1 - Math.min(...noBids || [1 - yesBid])).toFixed(2));
        }
        if (noBids.length) {
          noBid  = Math.max(...noBids);
          noAsk  = parseFloat((1 - Math.min(...yesBids || [1 - noBid])).toFixed(2));
        }
      } catch (obErr) {
        this.emit('log', { msg: `Orderbook fetch failed for ${market.ticker}: ${obErr.message}`, type: 'warn' });
      }

      const minutesToClose = (new Date(market.close_time).getTime() - now) / 60000;

      this.state.activeMarket = {
        ticker:         market.ticker,
        closeTime:      market.close_time,
        floorStrike:    market.floor_strike,
        capStrike:      market.cap_strike,
        status:         market.status,
        minutesToClose: Math.round(minutesToClose),
        yesBid,
        yesAsk,
        noBid,
        noAsk,
      };
      this.emit('market', this.state.activeMarket);
      console.log(`[Engine] Active market: ${market.ticker} | closes in ${Math.round(minutesToClose)}min | YES bid: ${yesBid} ask: ${yesAsk}`);
      return this.state.activeMarket;
    } catch (err) {
      this.emit('log', { msg: `Market fetch failed: ${err.message}`, type: 'error' });
      return null;
    }
  }

  async fetchPositions() {
    try {
      const data      = await this.kalshiGet('/portfolio/positions?limit=20');
      const positions = (data.market_positions || []).map(p => ({
        ticker:       p.ticker,
        yesContracts: p.position    || 0,
        noContracts:  p.no_position || 0,
        realizedPnl:  (p.realized_pnl || 0) / 100,
        totalCost:    (p.total_traded  || 0) / 100,
        feesPaid:     (p.fees_paid     || 0) / 100,
      }));
      this.state.openPositions = positions;
      this.emit('positions', { positions });
      return positions;
    } catch (err) {
      this.emit('log', { msg: `Positions fetch failed: ${err.message}`, type: 'error' });
      return [];
    }
  }

  // ─── Fill Confirmation ──────────────────────────────────────────────────────
  // After placing an order, poll for fill status (5x at 500ms intervals)

  async waitForFill(orderId, maxAttempts = 5, delayMs = 500) {
    for (let i = 0; i < maxAttempts; i++) {
      await sleep(delayMs);
      try {
        const data = await this.kalshiGet(`/portfolio/orders/${orderId}`);
        const order = data.order || data;
        if (order.status === 'filled' || order.remaining_count === 0) {
          return { filled: true, fillPrice: order.avg_price, fillCount: order.count };
        }
        if (order.status === 'canceled' || order.status === 'cancelled') {
          return { filled: false };
        }
      } catch (_) {}
    }
    // Cancel unfilled order
    try {
      await this.kalshiDelete(`/portfolio/orders/${orderId}`);
    } catch (_) {}
    return { filled: false };
  }

  // ─── Settled P&L reconciliation ─────────────────────────────────────────────
  //
  // Called after a candle closes when we have an open supabaseTradeId.
  // Polls Kalshi for the actual settled P&L and stamps it on the trade row.
  // This is the ONLY number that should be trusted for accounting.

  async reconcileSettledTrade(ticker) {
    if (!this.state.supabaseTradeId) return;
    const { apiKeyId, privateKeyPem, environment } = this.credentials;
    if (!apiKeyId || !privateKeyPem) return;

    const runId   = this.state.supabaseRunId;
    const tradeId = this.state.supabaseTradeId;
    this.state.supabaseTradeId = null; // clear immediately — don't reconcile twice

    console.log(`[Reconcile] Fetching settled P&L for ${ticker}...`);
    insertLog('reconcile', `Reconciling ${ticker}`, { ticker }, runId);

    let reconciledPnl = null;
    let status        = 'settled';

    try {
      // Kalshi settled positions: ?settlement_status=settled&limit=20
      const base     = getBaseUrl(environment);
      const fullPath = getKalshiPath('/portfolio/positions?settlement_status=settled&limit=20');
      const ts       = String(Date.now());
      const headers  = getAuthHeaders(apiKeyId, privateKeyPem, 'GET', fullPath, ts);
      const { data } = await axios.get(`${base}${fullPath}`, { headers, timeout: 8000 });

      const positions = data.market_positions || [];
      const pos       = positions.find(p => p.ticker === ticker);

      if (pos) {
        if (pos.realized_pnl_dollars != null) {
          reconciledPnl = parseFloat(pos.realized_pnl_dollars);
        } else if (pos.realized_pnl != null && pos.realized_pnl !== 0) {
          reconciledPnl = pos.realized_pnl / 100;
        } else if (pos.settlement_value != null) {
          const contracts   = Math.abs(pos.position_fp ?? pos.position ?? 1);
          const settledPay  = (pos.settlement_value / 100) * contracts;
          const cost        = (pos.total_traded || 0) / 100;
          reconciledPnl     = settledPay - cost;
        }
      }

      if (reconciledPnl !== null) {
        status = reconciledPnl > 0 ? 'won' : reconciledPnl < 0 ? 'lost' : 'settled';
        console.log(`[Reconcile] ${ticker} → Kalshi P&L: ${reconciledPnl >= 0 ? '+' : ''}$${reconciledPnl.toFixed(2)} ✓`);
        insertLog('reconcile', `${ticker} settled: ${reconciledPnl >= 0 ? '+' : ''}$${reconciledPnl.toFixed(2)}`, { ticker, pnl: reconciledPnl }, runId);

        // Market cooldown after loss
        if (reconciledPnl < 0) {
          this.state.cooldownUntil = Date.now() + (this.config.cooldownMinutes || 5) * 60000;
          this.emit('log', { msg: `Loss on ${ticker} — cooldown ${this.config.cooldownMinutes} min`, type: 'info' });
          insertLog('info', `Cooldown activated: ${this.config.cooldownMinutes} min`, { ticker }, runId);
        }
      } else {
        console.warn(`[Reconcile] ${ticker} — no P&L data found in settled positions`);
        insertLog('warn', `${ticker} — no P&L data in settled positions`, { ticker }, runId);
      }
    } catch (err) {
      console.warn(`[Reconcile] Failed for ${ticker}:`, err.message);
      insertLog('error', `Reconcile failed for ${ticker}: ${err.message}`, { ticker }, runId);
    }

    // Update the trade row with the Kalshi-sourced truth
    await updateTrade(tradeId, {
      status,
      pnl:           reconciledPnl,
      reconciledPnl: reconciledPnl,
      signalReason:  reconciledPnl !== null
        ? `SETTLED ✓ Kalshi: ${reconciledPnl >= 0 ? '+' : ''}$${reconciledPnl.toFixed(2)}`
        : 'SETTLED — P&L not available from Kalshi API',
    });

    // Update session P&L with the real number
    if (reconciledPnl !== null) {
      this.state.sessionPnl += reconciledPnl;
      this.emit('pnl', { sessionPnl: this.state.sessionPnl });
    }

    return reconciledPnl;
  }

  // ─── Strategy routing ─────────────────────────────────────────────────────

  runIndicators() {
    const candles = this.getAllCandles();
    if (candles.length < 2) return null;

    const currentPrice = this.state.btcPrice;
    const marketInfo = this.state.activeMarket;
    const ext = this.state.externalSignals;

    let result;
    switch (this.config.strategy) {
      case STRATEGIES.SWING:
        result = analyzeSwing(candles, currentPrice, marketInfo, ext);
        break;
      case STRATEGIES.THETA:
        result = analyzeThetaDecay(candles, currentPrice, marketInfo, ext);
        break;
      case STRATEGIES.SCALPER:
        result = analyzeScalper(candles, currentPrice, marketInfo, ext);
        break;
      case STRATEGIES.MOMENTUM:
        result = analyzeMomentum(candles, currentPrice, marketInfo, ext);
        break;
      default:
        result = analyzeSwing(candles, currentPrice, marketInfo, ext);
    }

    // External signals as confidence filters
    if (ext && result.signal !== 'NONE') {
      if (ext.fearGreedIndex < 20 && result.signal === 'YES') {
        result.confidence = Math.max(0, result.confidence - 15);
        result.reasoning.push('✗ Extreme fear (F&G <20) + YES signal — confidence reduced 15pts');
      }
      if (ext.fearGreedIndex > 80 && result.signal === 'NO') {
        result.confidence = Math.max(0, result.confidence - 15);
        result.reasoning.push('✗ Extreme greed (F&G >80) + NO signal — confidence reduced 15pts');
      }
    }

    // Decay entry logic for theta strategy
    if (this.config.strategy === STRATEGIES.THETA && marketInfo?.closeTime) {
      const minutesToExpiry = (new Date(marketInfo.closeTime).getTime() - Date.now()) / 60000;
      if (minutesToExpiry < 5) {
        result.signal = 'NONE';
        result.reasoning.push('✗ <5 min to expiry — too risky for theta');
      } else if (minutesToExpiry <= 30) {
        result.reasoning.push('✓ Ideal theta decay window (5-30 min)');
      } else if (minutesToExpiry > 90 && result.confidence < 75) {
        result.signal = 'NONE';
        result.reasoning.push('✗ >90 min to expiry, confidence <75 — skipping');
      }
    }

    this.state.indicators = result;
    this.state.lastSignal = result;
    this.emit('indicators', result);
    return result;
  }

  // ─── Trade execution ─────────────────────────────────────────────────────────

  async placeTrade(signal, indicators) {
    const { apiKeyId, privateKeyPem } = this.credentials;
    if (!apiKeyId || !privateKeyPem) return;

    const market = this.state.activeMarket;
    if (!market) {
      this.emit('log', { msg: 'No active market found — skipping trade', type: 'error' });
      return;
    }

    const balance = this.state.currentBalance || 0;
    if (balance < BALANCE_FLOOR) {
      this.emit('log', {
        msg:  `Balance $${balance.toFixed(2)} below floor $${BALANCE_FLOOR} — bot paused`,
        type: 'error',
      });
      this.config.botEnabled = false;
      this.emit('bot_toggle', { enabled: false, reason: 'balance_floor' });
      insertLog('warn', `Balance floor hit: $${balance.toFixed(2)}`, {}, this.state.supabaseRunId);
      return;
    }

    // Daily loss limit check
    const dailyDrop    = this.state.dailyStartBalance - balance;
    const dailyDropPct = this.state.dailyStartBalance > 0
      ? (dailyDrop / this.state.dailyStartBalance) * 100
      : 0;
    if (dailyDropPct >= this.config.dailyLossLimitPct) {
      this.emit('log', {
        msg:  `Daily loss limit ${this.config.dailyLossLimitPct}% hit — bot paused for today`,
        type: 'error',
      });
      this.config.botEnabled = false;
      this.emit('bot_toggle', { enabled: false, reason: 'daily_loss_limit' });
      insertLog('warn', `Daily loss limit hit: ${dailyDropPct.toFixed(1)}%`, {}, this.state.supabaseRunId);
      return;
    }

    // Max positions check
    if (this.state.openPositions.length >= this.config.maxPositions) {
      this.emit('log', {
        msg:  `Max positions (${this.config.maxPositions}) reached — skipping`,
        type: 'info',
      });
      return;
    }

    // Position sizing by confidence
    const confidence = indicators.confidence || 0;
    const maxContracts = this.config.maxContractsPerTrade || 10;
    let sizedContracts = Math.max(1, Math.floor(confidence / 100 * maxContracts));

    // Price: use live bid/ask from the market (always taker — crossing spread)
    const contractPrice = signal === 'YES'
      ? (market.yesAsk || 0.50)
      : (market.noAsk  || 0.50);

    // Also cap by balance/risk
    const rawSize  = balance * (this.config.riskPct / 100);
    const tradeSize = Math.min(rawSize, this.config.maxTradeSize);
    const balanceContracts = Math.max(1, Math.floor(tradeSize / contractPrice));
    const contracts = Math.min(sizedContracts, balanceContracts);
    const actualCost  = contracts * contractPrice;

    // Fee: TAKER rate (0.07) — we cross the spread on entry
    const fee        = calcFee(contracts, contractPrice, false); // false = taker
    const netIfWin   = contracts * 1.00 - actualCost - fee;
    const netIfLose  = -(actualCost + fee);
    const breakEvenRate = (actualCost + fee) / contracts;

    this.emit('log', {
      msg: `[TRADE PREVIEW] ${signal} | ${contracts}c @ ${(contractPrice * 100).toFixed(0)}¢`
         + ` | Fee (taker): $${fee.toFixed(3)}`
         + ` | Win: +$${netIfWin.toFixed(2)}`
         + ` | Lose: $${netIfLose.toFixed(2)}`
         + ` | BEP: ${(breakEvenRate * 100).toFixed(0)}¢`,
      type: 'info',
    });

    const side        = signal === 'YES' ? 'yes' : 'no';
    const priceInCents = Math.round(contractPrice * 100);

    const orderBody = {
      ticker:   market.ticker,
      action:   'buy',
      side,
      count:    contracts,
      type:     'limit',
      ...(side === 'yes'
        ? { yes_price: priceInCents }
        : { no_price:  priceInCents }),
      client_order_id: `alpha-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    };

    try {
      const result = await this.kalshiPost('/portfolio/orders', orderBody);
      const orderId = result.order?.order_id || result.order_id || null;

      // Fill confirmation — poll 5x at 500ms
      if (orderId) {
        const fillResult = await this.waitForFill(orderId);
        if (!fillResult.filled) {
          this.emit('log', { msg: `Order ${orderId} not filled — cancelled`, type: 'info' });
          insertLog('info', `Order not filled, cancelled: ${orderId}`, { orderId }, this.state.supabaseRunId);
          return; // Don't record as a trade
        }
        this.emit('log', { msg: `Order ${orderId} FILLED`, type: 'success' });
      }

      this.state.feesTotal += fee;

      // ── Write to Supabase trades table ───────────────────────────────────
      const supabaseTradeId = await insertTrade({
        runId:            this.state.supabaseRunId,
        orderId,
        ticker:           market.ticker,
        side,
        action:           'buy',
        count:            contracts,
        pricePerContract: contractPrice,
        totalCost:        actualCost,
        feeDollars:       fee,
        signalReason:     `[${signal} conf:${confidence}%] ${indicators.strategyName || this.config.strategy}`,
        btcPriceAtTrade:  this.state.btcPrice,
        marketTitle:      market.ticker,
      });

      // Store the Supabase trade UUID so we can reconcile after settlement
      this.state.supabaseTradeId = supabaseTradeId;

      const logEntry = {
        id:         Date.now(),
        time:       new Date().toLocaleTimeString('en-GB', { hour12: false }),
        strategy:   this.config.strategy,
        signal,
        market:     market.ticker,
        contracts,
        price:      contractPrice,
        fee,
        netIfWin,
        confidence,
        orderId:    orderId || '?',
        supabaseTradeId,
        pnl:        null, // filled in after reconcile
      };
      this.state.tradeLog.unshift(logEntry);
      if (this.state.tradeLog.length > 100) this.state.tradeLog.pop();
      this.emit('trade', logEntry);
      this.emit('log', {
        msg:  `Order placed: ${signal} ${contracts}c on ${market.ticker}`
            + ` (Kalshi: ${orderId || '?'})`,
        type: 'success',
      });

      insertLog('trade', `Order placed: ${signal} ${contracts}c @ ${priceInCents}¢`, {
        orderId, ticker: market.ticker, fee, contracts,
      }, this.state.supabaseRunId);

    } catch (err) {
      const msg = err.response?.data?.message
                || err.response?.data?.error
                || err.message;
      this.emit('log', { msg: `Order failed: ${msg}`, type: 'error' });
      insertLog('error', `Order failed: ${msg}`, {}, this.state.supabaseRunId);
      this.state.consecutiveLosses++;
      if (this.state.consecutiveLosses >= MAX_CONSECUTIVE_LOSSES) {
        this.config.botEnabled = false;
        this.emit('bot_toggle', { enabled: false, reason: 'loss_streak' });
        this.emit('log', {
          msg:  `${MAX_CONSECUTIVE_LOSSES} consecutive failures — bot auto-paused`,
          type: 'error',
        });
        insertLog('warn', `Loss streak: bot auto-paused after ${MAX_CONSECUTIVE_LOSSES} failures`, {}, this.state.supabaseRunId);
      }
    }
  }

  // ─── Main loop ──────────────────────────────────────────────────────────────

  async tick() {
    const price = await this.fetchBtcPrice();
    if (price == null) {
      this.emit('log', { msg: 'Coinbase price fetch failed', type: 'error' });
      return;
    }

    this.state.btcPrice = price;
    this.updateCandle(price);
    this.emit('price', { price, candles: this.getAllCandles(), currentCandle: this.state.currentCandle });

    // Fetch external signals (cached internally for 30s)
    try {
      this.state.externalSignals = await getExternalSignals();
    } catch (_) {}

    // Cooldown check
    if (Date.now() < this.state.cooldownUntil) {
      const remaining = Math.ceil((this.state.cooldownUntil - Date.now()) / 60000);
      this.emit('eval', {
        id: Date.now(), time: new Date().toLocaleTimeString('en-GB', { hour12: false }),
        price, signal: 'NONE', confidence: 0, action: `COOLDOWN (${remaining} min remaining)`,
      });
      return;
    }

    const indicators = this.runIndicators();
    if (!indicators) return;

    const { signal, confidence } = indicators;

    // ── Write signal evaluation to Supabase ────────────────────────────────
    const traded = !!(signal && signal !== 'NONE' && confidence >= this.config.minConfidence && this.config.botEnabled);
    insertSignal({
      runId:          this.state.supabaseRunId,
      direction:      signal === 'YES' ? 'up' : signal === 'NO' ? 'down' : 'neutral',
      confidence:     confidence || 0,
      btcPrice:       price,
      marketTicker:   this.state.activeMarket?.ticker ?? null,
      marketYesPrice: this.state.activeMarket?.yesBid ?? null,
      rsi:            indicators.indicators?.rsi ?? null,
      macd:           indicators.indicators?.macd?.value ?? null,
      macdSignal:     indicators.indicators?.macd?.signal ?? null,
      reasoning:      indicators.reasoning?.join('; ') || null,
      traded,
    });

    // Log every evaluation
    const evalEntry = {
      id:        Date.now(),
      time:      new Date().toLocaleTimeString('en-GB', { hour12: false }),
      price,
      signal:    signal || 'NONE',
      confidence,
      strategy:  indicators.strategyName || this.config.strategy,
      reasoning: indicators.reasoning,
      action:    'SKIP',
    };

    if (!signal || signal === 'NONE' || confidence < this.config.minConfidence) {
      evalEntry.action = signal && signal !== 'NONE'
        ? `SKIP (conf ${confidence} < ${this.config.minConfidence})`
        : 'NO SIGNAL';
      this.emit('eval', evalEntry);
      return;
    }

    if (!this.config.botEnabled) {
      evalEntry.action = `SIGNAL: ${signal} (bot OFF)`;
      this.emit('eval', evalEntry);
      return;
    }

    evalEntry.action = `PLACING ${signal}`;
    this.emit('eval', evalEntry);
    await this.placeTrade(signal, indicators);
  }

  start() {
    if (this._pollTimer) return;
    this.emit('log', { msg: 'Price engine started — polling Coinbase every 15s', type: 'success' });

    // Open a Supabase bot_run immediately
    this._openRun();

    // Immediate first tick
    this.tick();
    this._pollTimer = setInterval(() => this.tick(), PRICE_POLL_MS);

    // Refresh market & balance on a slower cadence
    this.fetchActiveMarket();
    this.fetchBalance();
    this._marketRefreshTimer  = setInterval(() => this.fetchActiveMarket(), 60_000);
    this._balanceRefreshTimer = setInterval(() => this.fetchBalance(), 30_000);
    this._positionsTimer      = setInterval(() => this.fetchPositions(), 30_000);

    // Reconcile settled trades every 5 minutes
    this._reconcileTimer = setInterval(() => this._checkReconcile(), 5 * 60_000);
  }

  stop() {
    clearInterval(this._pollTimer);
    clearInterval(this._marketRefreshTimer);
    clearInterval(this._balanceRefreshTimer);
    clearInterval(this._positionsTimer);
    clearInterval(this._reconcileTimer);
    this._pollTimer          = null;
    this._reconcileTimer     = null;
    this._closeRun('stopped');
    this.emit('log', { msg: 'Price engine stopped', type: 'info' });
  }

  // ─── Reconcile check ────────────────────────────────────────────────────────

  async _checkReconcile() {
    if (!this.state.supabaseTradeId) return;
    const trade = this.state.tradeLog.find(t => t.supabaseTradeId === this.state.supabaseTradeId);
    if (!trade) return;

    const market = this.state.activeMarket;
    if (!market) return;

    // If the current market ticker differs from the trade's market, the candle closed
    if (trade.market !== market.ticker) {
      await this.reconcileSettledTrade(trade.market);
    }
  }

  getSnapshot() {
    return {
      btcPrice:            this.state.btcPrice,
      candles:             this.getAllCandles(),
      indicators:          this.state.indicators,
      lastSignal:          this.state.lastSignal,
      activeMarket:        this.state.activeMarket,
      openPositions:       this.state.openPositions,
      balance:             this.state.currentBalance,
      sessionStartBalance: this.state.sessionStartBalance,
      sessionPnl:          this.state.sessionPnl,
      feesTotal:           this.state.feesTotal,
      tradeLog:            this.state.tradeLog,
      config:              this.config,
      botEnabled:          this.config.botEnabled,
      supabaseRunId:       this.state.supabaseRunId,
      supabaseEnabled:     isSupabaseEnabled(),
      externalSignals:     this.state.externalSignals,
      cooldownUntil:       this.state.cooldownUntil,
    };
  }
}

export const botEngine = new BotEngine();
