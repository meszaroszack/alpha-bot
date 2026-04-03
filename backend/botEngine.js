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
      stopLossPct:         40,       // exit if position loses 40% of cost
      takeProfitPct:       50,       // exit if position gains 50% of cost
      exitEnabled:         true,     // master toggle for exit logic
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

      // Active trades for exit monitoring
      activeTrades:        [],        // trades awaiting exit/settlement

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
      const seriesTicker = 'KXBTC15M';
      const now = Date.now();

      // Step 1: Try status=open — Kalshi returns currently-active (trading) markets.
      // This is the PREFERRED path: it finds the live market directly.
      let market = null;
      try {
        const activeData = await this.kalshiGet(`/markets?series_ticker=${seriesTicker}&status=open&limit=5`);
        const activeMarkets = (activeData.markets || [])
          .filter(m => {
            const minToClose = (new Date(m.close_time).getTime() - now) / 60000;
            return minToClose > 2; // skip markets expiring in <2 min
          })
          .sort((a, b) => new Date(a.close_time) - new Date(b.close_time));
        if (activeMarkets.length > 0) market = activeMarkets[0];
      } catch (_) {}

      // Step 2: If no active market (e.g. between candle windows), fall back to
      // the soonest upcoming 'initialized' market.
      if (!market) {
        const upcomingData = await this.kalshiGet(`/markets?series_ticker=${seriesTicker}&status=initialized&limit=20`);
        const upcoming = (upcomingData.markets || [])
          .sort((a, b) => new Date(a.close_time) - new Date(b.close_time));
        if (upcoming.length > 0) market = upcoming[0];
      }

      if (!market) {
        this.emit('log', { msg: 'No tradeable markets found for series ' + seriesTicker, type: 'warn' });
        return null;
      }

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

      // For KXBTC15M: floor_strike = the BTC price when this market opened (the YES/NO line)
      const referencePrice = market.floor_strike ?? market.cap_strike ?? null;
      const gapPct = (referencePrice && this.state.btcPrice)
        ? (((this.state.btcPrice - referencePrice) / referencePrice) * 100)
        : null;

      this.state.activeMarket = {
        ticker:         market.ticker,
        closeTime:      market.close_time,
        referencePrice,                       // the BTC price at market open (the line to beat)
        gapPct,                               // how far current BTC is from the reference, + = above, - = below
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
      console.log(`[Engine] Active market: ${market.ticker} | ref: $${referencePrice?.toLocaleString()} | BTC gap: ${gapPct != null ? (gapPct >= 0 ? '+' : '') + gapPct.toFixed(2) + '%' : 'N/A'} | closes in ${Math.round(minutesToClose)}min`);
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

  async reconcileSettledTrade(ticker, logSupabaseTradeId = null) {
    const { apiKeyId, privateKeyPem, environment } = this.credentials;
    if (!apiKeyId || !privateKeyPem) return;

    const tradeId = logSupabaseTradeId ?? this.state.supabaseTradeId;
    if (!tradeId) return;

    if (this.state.supabaseTradeId === tradeId) {
      this.state.supabaseTradeId = null; // clear when reconciling the current open trade
    }

    const runId = this.state.supabaseRunId;

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
        console.log(`[DIAG] RECONCILE FOUND | ticker: ${ticker} | realized_pnl_dollars: ${pos.realized_pnl_dollars} | realized_pnl: ${pos.realized_pnl} | settlement_value: ${pos.settlement_value} | total_traded: ${pos.total_traded} | position: ${pos.position} | no_position: ${pos.no_position} | position_fp: ${pos.position_fp}`);

        if (pos.realized_pnl_dollars != null) {
          reconciledPnl = parseFloat(pos.realized_pnl_dollars);
        } else if (pos.realized_pnl != null && pos.realized_pnl !== 0) {
          reconciledPnl = pos.realized_pnl / 100;
        } else {
          // settlement_value from Kalshi is in cents per contract (100 = win, 0 = loss)
          // total_traded is total cost paid in cents
          const contracts   = Math.abs(pos.position_fp ?? pos.position ?? pos.no_position ?? 1);
          const settledPay  = ((pos.settlement_value ?? 0) / 100) * contracts; // cents→dollars per contract × contracts
          const cost        = (pos.total_traded ?? 0) / 100;                   // cents → dollars
          reconciledPnl     = settledPay - cost;
          if (reconciledPnl === 0 && (pos.settlement_value ?? 0) >= 100 && contracts > 0) {
            reconciledPnl = contracts * 1.0 - cost;
          }
          if (reconciledPnl === 0 && pos.settlement_value == null) {
            console.warn(`[Reconcile] settlement_value missing for ${ticker} — P&L may be inaccurate`);
          }
        }
      } else {
        console.log(`[DIAG] RECONCILE MISS | ticker: ${ticker} | total settled positions checked: ${positions.length} | tickers: ${positions.map(p => p.ticker).join(', ')}`);
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

    // Remove from activeTrades — position is settled
    this.state.activeTrades = this.state.activeTrades.filter(t => t.ticker !== ticker);

    // Update the trade row with the Kalshi-sourced truth
    await updateTrade(tradeId, {
      status,
      pnl:           reconciledPnl,
      reconciledPnl: reconciledPnl,
      signalReason:  reconciledPnl !== null
        ? `SETTLED ✓ Kalshi: ${reconciledPnl >= 0 ? '+' : ''}$${reconciledPnl.toFixed(2)}`
        : 'SETTLED — P&L not available from Kalshi API',
    });

    const logEntryMatch = this.state.tradeLog.find(t => t.supabaseTradeId === tradeId);
    if (logEntryMatch) logEntryMatch.pnl = reconciledPnl;

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

    // Fetch fresh positions before deciding — the 30s interval cache is too stale
    await this.fetchPositions();

    // Same-market deduplication: skip if we already hold a position on this ticker
    const activeTicker = market.ticker;
    const existingPosition = this.state.openPositions.find(p => p.ticker === activeTicker);
    if (existingPosition) {
      this.emit('log', {
        msg:  `Already have position on ${activeTicker} — skipping`,
        type: 'info',
      });
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

    console.log(`[DIAG] ORDER | ${signal} ${contracts}c on ${market.ticker} @ ${priceInCents}¢ | refPrice: $${market.referencePrice} | BTC: $${this.state.btcPrice} | gap: ${market.gapPct != null ? (market.gapPct >= 0 ? '+' : '') + market.gapPct.toFixed(2) + '%' : 'N/A'}`);

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

      // Track active trade for exit monitoring
      this.state.activeTrades.push({
        ticker:          market.ticker,
        side,
        contracts,
        entryPrice:      contractPrice,
        supabaseTradeId: null, // will be set below after Supabase insert
        entryTime:       Date.now(),
      });

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

      // Back-fill supabaseTradeId on the active trade entry
      const activeTrade = this.state.activeTrades.find(t => t.ticker === market.ticker && !t.supabaseTradeId);
      if (activeTrade) activeTrade.supabaseTradeId = supabaseTradeId;

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

  // ─── Exit logic — stop-loss & take-profit ──────────────────────────────────

  async exitPosition(trade, reason) {
    this.emit('log', { msg: `[EXIT] ${reason} triggered for ${trade.ticker} (${trade.side})`, type: 'info' });
    insertLog('exit', `${reason} for ${trade.ticker}`, { ticker: trade.ticker, side: trade.side, reason }, this.state.supabaseRunId);

    // Fetch fresh orderbook to get current bid
    let currentBidCents;
    try {
      const ob = await this.kalshiGet(`/markets/${trade.ticker}/orderbook`);
      const obData = ob.orderbook_fp || ob.orderbook || {};
      const bidArr = trade.side === 'yes'
        ? (obData.yes_dollars || [])
        : (obData.no_dollars || []);
      const bids = bidArr.map(([p]) => parseFloat(p)).filter(p => p > 0);
      if (bids.length === 0) {
        this.emit('log', { msg: `[EXIT] No bids for ${trade.ticker} ${trade.side} — skipping`, type: 'warn' });
        return;
      }
      currentBidCents = Math.round(Math.max(...bids) * 100);
    } catch (err) {
      // Market may have expired
      if (err.response?.status === 404 || err.response?.status === 400) {
        this.emit('log', { msg: `[EXIT] Market ${trade.ticker} expired — removing from activeTrades`, type: 'info' });
        this.state.activeTrades = this.state.activeTrades.filter(t => t.ticker !== trade.ticker);
        await this.reconcileSettledTrade(trade.ticker);
        return;
      }
      this.emit('log', { msg: `[EXIT] Orderbook fetch failed for ${trade.ticker}: ${err.message}`, type: 'warn' });
      return;
    }

    const orderBody = {
      ticker:          trade.ticker,
      action:          'sell',
      side:            trade.side,
      count:           trade.contracts,
      type:            'limit',
      ...(trade.side === 'yes'
        ? { yes_price: currentBidCents }
        : { no_price:  currentBidCents }),
      client_order_id: `exit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    };

    try {
      const result = await this.kalshiPost('/portfolio/orders', orderBody);
      const orderId = result.order?.order_id || result.order_id || null;

      if (orderId) {
        const fillResult = await this.waitForFill(orderId);
        if (!fillResult.filled) {
          this.emit('log', { msg: `[EXIT] Sell order ${orderId} not filled — will retry next tick`, type: 'warn' });
          return;
        }
        this.emit('log', { msg: `[EXIT] ${reason} sell FILLED for ${trade.ticker} @ ${currentBidCents}¢`, type: 'success' });
      }

      // Remove from activeTrades
      this.state.activeTrades = this.state.activeTrades.filter(t => t.ticker !== trade.ticker);

      // Calculate realized P&L for the exit
      const exitPrice = currentBidCents / 100;
      const pnl = (exitPrice - trade.entryPrice) * trade.contracts;

      // Log the exit trade to Supabase
      const exitTradeId = await insertTrade({
        runId:            this.state.supabaseRunId,
        orderId,
        ticker:           trade.ticker,
        side:             trade.side,
        action:           'sell',
        count:            trade.contracts,
        pricePerContract: exitPrice,
        totalCost:        exitPrice * trade.contracts,
        feeDollars:       calcFee(trade.contracts, exitPrice, false),
        signalReason:     `[${reason}] entry: ${(trade.entryPrice * 100).toFixed(0)}¢ → exit: ${currentBidCents}¢ | P&L: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`,
        btcPriceAtTrade:  this.state.btcPrice,
        marketTitle:      trade.ticker,
      });

      // Update session P&L
      this.state.sessionPnl += pnl;
      this.emit('pnl', { sessionPnl: this.state.sessionPnl });

      // Cooldown after stop-loss
      if (reason === 'STOP_LOSS') {
        this.state.cooldownUntil = Date.now() + (this.config.cooldownMinutes || 5) * 60000;
        this.emit('log', { msg: `Stop-loss on ${trade.ticker} — cooldown ${this.config.cooldownMinutes} min`, type: 'info' });
      }

      insertLog('exit', `${reason} filled: ${trade.ticker} ${trade.contracts}c @ ${currentBidCents}¢ | P&L: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`, {
        orderId, ticker: trade.ticker, reason, pnl, exitTradeId,
      }, this.state.supabaseRunId);

    } catch (err) {
      const msg = err.response?.data?.message || err.response?.data?.error || err.message;
      this.emit('log', { msg: `[EXIT] Sell failed for ${trade.ticker}: ${msg}`, type: 'error' });
      insertLog('error', `Exit sell failed for ${trade.ticker}: ${msg}`, { ticker: trade.ticker, reason }, this.state.supabaseRunId);
      // Keep in activeTrades — will retry next tick
    }
  }

  async checkExits() {
    // Copy the array since exitPosition mutates activeTrades
    const trades = [...this.state.activeTrades];
    for (const trade of trades) {
      // Skip if already removed by a prior exit in this loop
      if (!this.state.activeTrades.includes(trade)) continue;

      let currentBid;
      try {
        // Reuse active market orderbook data if same ticker
        if (this.state.activeMarket?.ticker === trade.ticker) {
          currentBid = trade.side === 'yes'
            ? this.state.activeMarket.yesBid
            : this.state.activeMarket.noBid;
        }
        // If no cached bid or zero, fetch fresh
        if (!currentBid || currentBid <= 0) {
          const ob = await this.kalshiGet(`/markets/${trade.ticker}/orderbook`);
          const obData = ob.orderbook_fp || ob.orderbook || {};
          const bidArr = trade.side === 'yes'
            ? (obData.yes_dollars || [])
            : (obData.no_dollars || []);
          const bids = bidArr.map(([p]) => parseFloat(p)).filter(p => p > 0);
          currentBid = bids.length > 0 ? Math.max(...bids) : 0;
        }
      } catch (err) {
        this.emit('log', { msg: `[EXIT-CHECK] Orderbook failed for ${trade.ticker}: ${err.message} — skipping`, type: 'warn' });
        continue;
      }

      if (currentBid <= 0) continue;

      const unrealizedPnlPct = ((currentBid - trade.entryPrice) / trade.entryPrice) * 100;

      this.emit('log', {
        msg: `[MONITOR] ${trade.ticker} ${trade.side} | entry: ${(trade.entryPrice * 100).toFixed(0)}¢ | bid: ${(currentBid * 100).toFixed(0)}¢ | P&L: ${unrealizedPnlPct >= 0 ? '+' : ''}${unrealizedPnlPct.toFixed(1)}%`,
        type: 'info',
      });

      if (unrealizedPnlPct <= -this.config.stopLossPct) {
        await this.exitPosition(trade, 'STOP_LOSS');
      } else if (unrealizedPnlPct >= this.config.takeProfitPct) {
        await this.exitPosition(trade, 'TAKE_PROFIT');
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
    console.log(`[DIAG] tick | BTC: $${price} | activeMarket: ${this.state.activeMarket?.ticker ?? 'none'} | ref: $${this.state.activeMarket?.referencePrice ?? 'N/A'} | gap: ${this.state.activeMarket?.gapPct != null ? (this.state.activeMarket.gapPct >= 0 ? '+' : '') + this.state.activeMarket.gapPct.toFixed(2) + '%' : 'N/A'}`);

    // Fetch external signals (cached internally for 30s)
    try {
      this.state.externalSignals = await getExternalSignals();
    } catch (_) {}

    // ── Signal evaluation & trade placement ─────────────────────────────────
    await this._evaluateAndTrade(price);

    // ── Monitor open positions for exits ────────────────────────────────────
    if (this.config.exitEnabled && this.state.activeTrades.length > 0) {
      await this.checkExits();
    }
  }

  async _evaluateAndTrade(price) {
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

    console.log(`[DIAG] indicators | strategy: ${this.config.strategy} | signal: ${indicators.signal} | confidence: ${indicators.confidence} | threshold: ${this.config.minConfidence}`);

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
      if (signal && signal !== 'NONE' && confidence < this.config.minConfidence) {
        console.log(`[DIAG] SKIP | signal: ${signal} confidence: ${confidence} < threshold: ${this.config.minConfidence} — no trade`);
      }
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

  // ─── Seed historical candles from Coinbase on startup ──────────────────────
  // Fetches last 50 completed 15-min candles so strategies can trade immediately
  // instead of waiting 6+ hours for enough live candles to accumulate.
  async seedHistoricalCandles() {
    try {
      this.emit('log', { msg: 'Seeding historical candles from Coinbase...', type: 'info' });
      const { data } = await axios.get(
        'https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=900&limit=50',
        { timeout: 10000 }
      );
      if (!Array.isArray(data) || data.length === 0) {
        this.emit('log', { msg: 'No historical candles returned from Coinbase', type: 'warn' });
        return;
      }
      // Coinbase returns [time, low, high, open, close, volume] newest-first — reverse to oldest-first
      const sorted = [...data].reverse();
      // Drop the last (current incomplete) candle — only use closed candles
      const closed = sorted.slice(0, -1);
      this.state.candles = closed.map(([time, low, high, open, close]) => ({
        timestamp: time * 1000,
        open:  parseFloat(open),
        high:  parseFloat(high),
        low:   parseFloat(low),
        close: parseFloat(close),
      }));
      this.emit('log', { msg: `Seeded ${this.state.candles.length} historical candles — ready to trade`, type: 'success' });
      this.emit('candles', { candles: this.state.candles });
    } catch (err) {
      this.emit('log', { msg: `Historical candle seed failed (non-fatal): ${err.message}`, type: 'warn' });
    }
  }

  start() {
    if (this._pollTimer) return;
    this.emit('log', { msg: 'Price engine started — polling Coinbase every 15s', type: 'success' });

    // Open a Supabase bot_run immediately
    this._openRun();

    // Seed historical candles FIRST, then start ticking
    // This ensures strategies can trade on the very first cycle
    this.seedHistoricalCandles().then(() => {
      this.tick();
    });
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
    // Reconcile any trade whose market has already expired
    for (const trade of this.state.tradeLog) {
      if (!trade.supabaseTradeId) continue;
      if (trade.pnl !== null && trade.pnl !== undefined) continue; // already reconciled

      // Check if this trade's market has expired
      const market = this.state.activeMarket;
      const tradeIsStale = !market || trade.market !== market.ticker;
      const tradeIsOld = (Date.now() - trade.id) > 16 * 60 * 1000; // older than 16 min

      if (tradeIsStale || tradeIsOld) {
        console.log(`[DIAG] _checkReconcile firing for stale trade: ${trade.market}`);
        await this.reconcileSettledTrade(trade.market, trade.supabaseTradeId);
        // Only reconcile one at a time per interval
        break;
      }
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
      activeTrades:        this.state.activeTrades,
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
