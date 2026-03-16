/**
 * Bot Engine — server-side trading loop.
 * Polls Coinbase for BTC price, builds OHLCV candles,
 * runs indicators, places orders when bot is enabled.
 */
import axios from 'axios';
import { strategyAlgo, strategyScalper } from './indicators.js';
import { getBaseUrl, getKalshiPath, getAuthHeaders, calcFee } from './kalshiAuth.js';

const COINBASE_URL = 'https://api.coinbase.com/v2/prices/BTC-USD/spot';
const CANDLE_PERIOD_MS = 15 * 60 * 1000; // 15 minutes
const PRICE_POLL_MS = 15_000;            // poll Coinbase every 15s
const MAX_CANDLES = 60;                  // keep last 60 candles (~15 hours)
const MAX_CONSECUTIVE_LOSSES = 3;
const BALANCE_FLOOR = 5;                 // stop trading below $5

export class BotEngine {
  constructor() {
    // Config (user-adjustable)
    this.config = {
      strategy: 'algo',       // 'algo' | 'scalper'
      algoMode: 'momentum',   // 'momentum' | 'mean_reversion'
      riskPct: 25,            // % of balance per trade
      maxPositions: 3,
      minConfidence: 65,
      dailyLossLimitPct: 20,  // stop if balance drops this % in a day
      maxTradeSize: 50,       // hard cap per trade in dollars
      botEnabled: false,
    };

    // Runtime state
    this.state = {
      btcPrice: null,
      candles: [],            // [{open,high,low,close,timestamp}]
      currentCandle: null,
      indicators: {},
      signal: null,
      openPositions: [],
      sessionStartBalance: null,
      currentBalance: null,
      sessionPnl: 0,
      feesTotal: 0,
      tradeLog: [],
      consecutiveLosses: 0,
      dailyStartBalance: null,
      activeMarket: null,     // current KXBTC15M-* market from Kalshi
      reconnectCount: 0,
    };

    // Kalshi credentials (set via setCredentials)
    this.credentials = { apiKeyId: null, privateKeyPem: null, environment: 'Demo' };

    // Subscribers for SSE/WS push
    this._listeners = [];
    this._pollTimer = null;
    this._marketRefreshTimer = null;
    this._balanceRefreshTimer = null;
  }

  setCredentials(apiKeyId, privateKeyPem, environment) {
    this.credentials = { apiKeyId, privateKeyPem, environment };
    this.state.sessionStartBalance = null;
    this.state.dailyStartBalance = null;
  }

  setConfig(partial) {
    this.config = { ...this.config, ...partial };
    this.emit('config', this.config);
  }

  setBotEnabled(enabled) {
    this.config.botEnabled = enabled;
    this.emit('bot_toggle', { enabled });
    if (enabled) this.emit('log', { msg: `Bot ENABLED — strategy: ${this.config.strategy}`, type: 'success' });
    else this.emit('log', { msg: 'Bot DISABLED — signals still running', type: 'info' });
  }

  on(listener) { this._listeners.push(listener); }
  off(listener) { this._listeners = this._listeners.filter(l => l !== listener); }
  emit(type, data) { this._listeners.forEach(fn => { try { fn({ type, ...data }); } catch (_) {} }); }

  // ─── Price Feed ────────────────────────────────────────────────────────────

  async fetchBtcPrice() {
    try {
      const { data } = await axios.get(COINBASE_URL, { timeout: 5000 });
      return parseFloat(data.data.amount);
    } catch (_) {
      return null;
    }
  }

  updateCandle(price) {
    const now = Date.now();
    const candleStart = Math.floor(now / CANDLE_PERIOD_MS) * CANDLE_PERIOD_MS;

    if (!this.state.currentCandle || this.state.currentCandle.timestamp !== candleStart) {
      // Close previous candle
      if (this.state.currentCandle) {
        this.state.candles.push({ ...this.state.currentCandle });
        if (this.state.candles.length > MAX_CANDLES) this.state.candles.shift();
      }
      // Open new candle
      this.state.currentCandle = { open: price, high: price, low: price, close: price, timestamp: candleStart };
    } else {
      this.state.currentCandle.close = price;
      this.state.currentCandle.high = Math.max(this.state.currentCandle.high, price);
      this.state.currentCandle.low = Math.min(this.state.currentCandle.low, price);
    }
  }

  getAllCandles() {
    const all = [...this.state.candles];
    if (this.state.currentCandle) all.push({ ...this.state.currentCandle });
    return all;
  }

  // ─── Kalshi API calls ──────────────────────────────────────────────────────

  async kalshiGet(path) {
    const { apiKeyId, privateKeyPem, environment } = this.credentials;
    const base = getBaseUrl(environment);
    const fullPath = getKalshiPath(path);
    const ts = String(Date.now());
    const headers = getAuthHeaders(apiKeyId, privateKeyPem, 'GET', fullPath, ts);
    const { data } = await axios.get(`${base}${fullPath}`, { headers, timeout: 8000 });
    return data;
  }

  async kalshiPost(path, body) {
    const { apiKeyId, privateKeyPem, environment } = this.credentials;
    const base = getBaseUrl(environment);
    const fullPath = getKalshiPath(path);
    const ts = String(Date.now());
    const headers = getAuthHeaders(apiKeyId, privateKeyPem, 'POST', fullPath, ts);
    const { data } = await axios.post(`${base}${fullPath}`, body, { headers, timeout: 8000 });
    return data;
  }

  async fetchBalance() {
    try {
      const data = await this.kalshiGet('/portfolio/balance');
      const balance = (data.balance || 0) / 100; // cents → dollars
      this.state.currentBalance = balance;
      if (this.state.sessionStartBalance == null) this.state.sessionStartBalance = balance;
      if (this.state.dailyStartBalance == null) this.state.dailyStartBalance = balance;
      this.emit('balance', { balance, sessionStartBalance: this.state.sessionStartBalance });
      return balance;
    } catch (err) {
      this.emit('log', { msg: `Balance fetch failed: ${err.message}`, type: 'error' });
      return null;
    }
  }

  async fetchActiveMarket() {
    try {
      const data = await this.kalshiGet('/markets?series_ticker=KXBTC&status=open&limit=20');
      const markets = data.markets || [];
      // Find the nearest-expiry KXBTC15M market
      const btc15m = markets
        .filter(m => m.ticker?.includes('KXBTC15M'))
        .sort((a, b) => new Date(a.close_time) - new Date(b.close_time));
      if (btc15m.length === 0) return null;
      const market = btc15m[0];
      this.state.activeMarket = {
        ticker: market.ticker,
        closeTime: market.close_time,
        floorStrike: market.floor_strike,
        capStrike: market.cap_strike,
        yesBid: market.yes_bid / 100,
        yesAsk: market.yes_ask / 100,
        noBid: market.no_bid / 100,
        noAsk: market.no_ask / 100,
      };
      this.emit('market', this.state.activeMarket);
      return this.state.activeMarket;
    } catch (err) {
      this.emit('log', { msg: `Market fetch failed: ${err.message}`, type: 'error' });
      return null;
    }
  }

  async fetchPositions() {
    try {
      const data = await this.kalshiGet('/portfolio/positions?limit=20');
      const positions = (data.market_positions || []).map(p => ({
        ticker: p.ticker,
        yesContracts: p.position || 0,
        noContracts: p.no_position || 0,
        realizedPnl: (p.realized_pnl || 0) / 100,
        totalCost: (p.total_traded || 0) / 100,
        feesPaid: (p.fees_paid || 0) / 100,
      }));
      this.state.openPositions = positions;
      this.emit('positions', { positions });
      return positions;
    } catch (err) {
      this.emit('log', { msg: `Positions fetch failed: ${err.message}`, type: 'error' });
      return [];
    }
  }

  // ─── Signal evaluation ─────────────────────────────────────────────────────

  runIndicators() {
    const candles = this.getAllCandles();
    if (candles.length < 2) return null;
    const closes = candles.map(c => c.close);

    let result;
    if (this.config.strategy === 'algo') {
      result = strategyAlgo(closes, this.config.algoMode);
    } else {
      result = strategyScalper(closes, candles);
    }

    this.state.indicators = result;
    this.emit('indicators', result);
    return result;
  }

  // ─── Trade execution ───────────────────────────────────────────────────────

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
      this.emit('log', { msg: `Balance $${balance.toFixed(2)} below floor $${BALANCE_FLOOR} — bot paused`, type: 'error' });
      this.config.botEnabled = false;
      this.emit('bot_toggle', { enabled: false, reason: 'balance_floor' });
      return;
    }

    // Daily loss limit check
    const dailyDrop = this.state.dailyStartBalance - balance;
    const dailyDropPct = this.state.dailyStartBalance > 0 ? (dailyDrop / this.state.dailyStartBalance) * 100 : 0;
    if (dailyDropPct >= this.config.dailyLossLimitPct) {
      this.emit('log', { msg: `Daily loss limit ${this.config.dailyLossLimitPct}% hit — bot paused for today`, type: 'error' });
      this.config.botEnabled = false;
      this.emit('bot_toggle', { enabled: false, reason: 'daily_loss_limit' });
      return;
    }

    // Max positions check
    if (this.state.openPositions.length >= this.config.maxPositions) {
      this.emit('log', { msg: `Max positions (${this.config.maxPositions}) reached — skipping`, type: 'info' });
      return;
    }

    // Size the trade
    const rawSize = balance * (this.config.riskPct / 100);
    const tradeSize = Math.min(rawSize, this.config.maxTradeSize);

    // Price: use live bid/ask from the market
    const contractPrice = signal === 'YES' ? (market.yesAsk || 0.50) : (market.noAsk || 0.50);
    const contracts = Math.max(1, Math.floor(tradeSize / contractPrice));

    // Fee preview (using limit order = maker fee)
    const fee = calcFee(contracts, contractPrice, true);
    const netIfWin = contracts * 1.00 - (contracts * contractPrice) - fee;
    const netIfLose = -(contracts * contractPrice) - fee;
    const breakEvenRate = (contracts * contractPrice + fee) / contracts;

    this.emit('log', {
      msg: `[TRADE PREVIEW] ${signal} | ${contracts}c @ ${(contractPrice * 100).toFixed(0)}¢ | Fee: $${fee.toFixed(2)} | Win: +$${netIfWin.toFixed(2)} | Lose: $${netIfLose.toFixed(2)} | BEP: ${(breakEvenRate * 100).toFixed(0)}¢`,
      type: 'info'
    });

    const side = signal === 'YES' ? 'yes' : 'no';
    const priceInCents = Math.round(contractPrice * 100);

    const orderBody = {
      ticker: market.ticker,
      action: 'buy',
      side,
      count: contracts,
      type: 'limit',
      ...(side === 'yes' ? { yes_price: priceInCents } : { no_price: priceInCents }),
      client_order_id: `alpha-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    };

    try {
      const result = await this.kalshiPost('/portfolio/orders', orderBody);
      this.state.feesTotal += fee;
      const logEntry = {
        id: Date.now(),
        time: new Date().toLocaleTimeString('en-GB', { hour12: false }),
        strategy: this.config.strategy,
        signal,
        market: market.ticker,
        contracts,
        price: contractPrice,
        fee,
        netIfWin,
        confidence: indicators.confidence,
        orderId: result.order?.order_id || result.order_id || '?',
      };
      this.state.tradeLog.unshift(logEntry);
      if (this.state.tradeLog.length > 100) this.state.tradeLog.pop();
      this.emit('trade', logEntry);
      this.emit('log', { msg: `Order placed: ${signal} ${contracts}c on ${market.ticker} (ID: ${logEntry.orderId})`, type: 'success' });
    } catch (err) {
      const msg = err.response?.data?.message || err.response?.data?.error || err.message;
      this.emit('log', { msg: `Order failed: ${msg}`, type: 'error' });
      this.state.consecutiveLosses++;
      if (this.state.consecutiveLosses >= MAX_CONSECUTIVE_LOSSES) {
        this.config.botEnabled = false;
        this.emit('bot_toggle', { enabled: false, reason: 'loss_streak' });
        this.emit('log', { msg: `${MAX_CONSECUTIVE_LOSSES} consecutive failures — bot auto-paused`, type: 'error' });
      }
    }
  }

  // ─── Main loop ─────────────────────────────────────────────────────────────

  async tick() {
    const price = await this.fetchBtcPrice();
    if (price == null) {
      this.emit('log', { msg: 'Coinbase price fetch failed', type: 'error' });
      return;
    }

    this.state.btcPrice = price;
    this.updateCandle(price);
    this.emit('price', { price, candles: this.getAllCandles(), currentCandle: this.state.currentCandle });

    const indicators = this.runIndicators();
    if (!indicators) return;

    const { signal, confidence } = indicators;

    // Log every evaluation
    const evalEntry = {
      id: Date.now(),
      time: new Date().toLocaleTimeString('en-GB', { hour12: false }),
      price,
      signal: signal || 'NONE',
      confidence,
      rsi: indicators.rsi != null ? indicators.rsi.toFixed(1) : '—',
      macd: indicators.macd != null ? indicators.macd.toFixed(2) : '—',
      histogram: indicators.histogram != null ? indicators.histogram.toFixed(2) : '—',
      bb: indicators.bb ? `${(indicators.bbPosition * 100).toFixed(0)}%` : '—',
      atr: indicators.atr != null ? indicators.atr.toFixed(2) : '—',
      action: 'SKIP',
    };

    if (!signal || confidence < this.config.minConfidence) {
      evalEntry.action = signal ? `SKIP (conf ${confidence} < ${this.config.minConfidence})` : 'NO SIGNAL';
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

    // Immediate first tick
    this.tick();
    this._pollTimer = setInterval(() => this.tick(), PRICE_POLL_MS);

    // Refresh market & balance on a slower cadence
    this.fetchActiveMarket();
    this.fetchBalance();
    this._marketRefreshTimer = setInterval(() => this.fetchActiveMarket(), 60_000);
    this._balanceRefreshTimer = setInterval(() => this.fetchBalance(), 30_000);
    // Also refresh positions every 30s
    this._positionsTimer = setInterval(() => this.fetchPositions(), 30_000);
  }

  stop() {
    clearInterval(this._pollTimer);
    clearInterval(this._marketRefreshTimer);
    clearInterval(this._balanceRefreshTimer);
    clearInterval(this._positionsTimer);
    this._pollTimer = null;
    this.emit('log', { msg: 'Price engine stopped', type: 'info' });
  }

  getSnapshot() {
    return {
      btcPrice: this.state.btcPrice,
      candles: this.getAllCandles(),
      indicators: this.state.indicators,
      activeMarket: this.state.activeMarket,
      openPositions: this.state.openPositions,
      balance: this.state.currentBalance,
      sessionStartBalance: this.state.sessionStartBalance,
      sessionPnl: this.state.sessionPnl,
      feesTotal: this.state.feesTotal,
      tradeLog: this.state.tradeLog,
      config: this.config,
      botEnabled: this.config.botEnabled,
    };
  }
}

export const botEngine = new BotEngine();
