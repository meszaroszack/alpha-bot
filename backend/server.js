import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import fs from 'fs';

import { isSupabaseEnabled } from './supabase.js';
import {
  getBaseUrl, getKalshiPath, getAuthHeaders,
  buildWsHeaders, calcFee,
  KALSHI_WS_DEMO, KALSHI_WS_LIVE, KALSHI_WS_PATH,
} from './kalshiAuth.js';
import { botEngine } from './botEngine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const publicDir = path.join(__dirname, 'public');

// CORS — allow React frontend on port 3000
app.use(cors({ origin: ['http://localhost:3000', 'http://127.0.0.1:3000'], credentials: true }));
app.use(express.json());

// ─── SSE broadcast to all connected frontend clients ───────────────────────
const sseClients = new Set();

function broadcastSSE(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(res => { try { res.write(payload); } catch (_) {} });
}

// Wire bot engine events → SSE
botEngine.on((event) => {
  const { type, ...data } = event;
  broadcastSSE(type, data);
});

// ─── GET /api/events — SSE stream ──────────────────────────────────────────
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  sseClients.add(res);

  // Send snapshot on connect
  const snap = botEngine.getSnapshot();
  res.write(`event: snapshot\ndata: ${JSON.stringify(snap)}\n\n`);

  req.on('close', () => sseClients.delete(res));
});

// ─── POST /api/kalshi/auth ─────────────────────────────────────────────────
app.post('/api/kalshi/auth', async (req, res) => {
  const { apiKey, privateKey, environment = 'Demo' } = req.body || {};
  const apiKeyId = apiKey || process.env.KALSHI_API_KEY;
  const privateKeyPem = privateKey || process.env.KALSHI_API_SECRET;

  if (!apiKeyId) return res.status(400).json({ error: 'API Key is required.' });
  if (!privateKeyPem) return res.status(500).json({ error: 'Private key not provided.' });

  const baseUrl = getBaseUrl(environment);
  const p = getKalshiPath('/portfolio/balance');
  const ts = String(Date.now());

  try {
    const { data } = await axios.get(`${baseUrl}${p}`, {
      headers: getAuthHeaders(apiKeyId, privateKeyPem, 'GET', p, ts),
    });
    const balance = (data.balance || 0) / 100;

    // Register credentials in bot engine
    botEngine.setCredentials(apiKeyId, privateKeyPem, environment);
    botEngine.start();

    const token = jwt.sign({ apiKey: apiKeyId, environment }, JWT_SECRET, { expiresIn: '24h' });
    return res.json({ token, balance });
  } catch (err) {
    const status = err.response?.status || 500;
    const message = err.response?.data?.message || err.response?.data?.error || err.message;
    return res.status(status).json({ error: message || 'Authentication failed.' });
  }
});

// ─── GET /api/config ──────────────────────────────────────────────────────
app.get('/api/config', (_req, res) => {
  res.json({ config: botEngine.config });
});

// ─── POST /api/config ─────────────────────────────────────────────────────
app.post('/api/config', (req, res) => {
  const { strategy, riskPct, maxPositions, minConfidence, dailyLossLimitPct, maxTradeSize, maxContractsPerTrade, cooldownMinutes } = req.body || {};
  const patch = {};
  if (strategy != null) patch.strategy = strategy;
  if (riskPct != null) patch.riskPct = Number(riskPct);
  if (maxPositions != null) patch.maxPositions = Number(maxPositions);
  if (minConfidence != null) patch.minConfidence = Number(minConfidence);
  if (dailyLossLimitPct != null) patch.dailyLossLimitPct = Number(dailyLossLimitPct);
  if (maxTradeSize != null) patch.maxTradeSize = Number(maxTradeSize);
  if (maxContractsPerTrade != null) patch.maxContractsPerTrade = Number(maxContractsPerTrade);
  if (cooldownMinutes != null) patch.cooldownMinutes = Number(cooldownMinutes);
  botEngine.setConfig(patch);
  return res.json({ config: botEngine.config });
});

// ─── POST /api/start ──────────────────────────────────────────────────────
app.post('/api/start', (_req, res) => {
  botEngine.setBotEnabled(true);
  res.json({ enabled: true });
});

// ─── POST /api/stop ───────────────────────────────────────────────────────
app.post('/api/stop', (_req, res) => {
  botEngine.setBotEnabled(false);
  res.json({ enabled: false });
});

// ─── GET /api/signals ─────────────────────────────────────────────────────
app.get('/api/signals', (_req, res) => {
  const snap = botEngine.getSnapshot();
  res.json({
    lastSignal: snap.lastSignal,
    externalSignals: snap.externalSignals,
  });
});

// ─── GET /api/trades ──────────────────────────────────────────────────────
app.get('/api/trades', (_req, res) => {
  const snap = botEngine.getSnapshot();
  res.json({
    trades: snap.tradeLog,
    sessionPnl: snap.sessionPnl,
    feesTotal: snap.feesTotal,
  });
});

// ─── GET /api/market ──────────────────────────────────────────────────────
app.get('/api/market', (_req, res) => {
  const market = botEngine.state?.activeMarket || null;
  if (market) return res.json(market);
  return res.json({ error: 'Not connected' });
});

// ─── GET /api/status ──────────────────────────────────────────────────────
app.get('/api/status', (_req, res) => {
  res.json({
    supabaseEnabled: isSupabaseEnabled(),
    supabaseRunId:   botEngine.state.supabaseRunId,
    botEnabled:      botEngine.config.botEnabled,
    environment:     botEngine.credentials.environment,
    uptime:          process.uptime(),
  });
});

// ─── POST /api/bot/toggle ─────────────────────────────────────────────────
app.post('/api/bot/toggle', (req, res) => {
  const { enabled } = req.body || {};
  botEngine.setBotEnabled(!!enabled);
  return res.json({ enabled: botEngine.config.botEnabled });
});

// ─── POST /api/bot/config (legacy) ───────────────────────────────────────
app.post('/api/bot/config', (req, res) => {
  const { strategy, riskPct, maxPositions, minConfidence, dailyLossLimitPct, maxTradeSize, maxContractsPerTrade, cooldownMinutes } = req.body || {};
  const patch = {};
  if (strategy != null) patch.strategy = strategy;
  if (riskPct != null) patch.riskPct = Number(riskPct);
  if (maxPositions != null) patch.maxPositions = Number(maxPositions);
  if (minConfidence != null) patch.minConfidence = Number(minConfidence);
  if (dailyLossLimitPct != null) patch.dailyLossLimitPct = Number(dailyLossLimitPct);
  if (maxTradeSize != null) patch.maxTradeSize = Number(maxTradeSize);
  if (maxContractsPerTrade != null) patch.maxContractsPerTrade = Number(maxContractsPerTrade);
  if (cooldownMinutes != null) patch.cooldownMinutes = Number(cooldownMinutes);
  botEngine.setConfig(patch);
  return res.json({ config: botEngine.config });
});

// ─── GET /api/bot/snapshot ────────────────────────────────────────────────
app.get('/api/bot/snapshot', (_req, res) => {
  res.json(botEngine.getSnapshot());
});

// ─── GET /api/kalshi/balance ──────────────────────────────────────────────
app.get('/api/kalshi/balance', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const privateKeyPem = process.env.KALSHI_API_SECRET;
    const base = getBaseUrl(payload.environment);
    const p = getKalshiPath('/portfolio/balance');
    const ts = String(Date.now());
    const { data } = await axios.get(`${base}${p}`, {
      headers: getAuthHeaders(payload.apiKey, privateKeyPem, 'GET', p, ts),
    });
    return res.json({ balance: (data.balance || 0) / 100 });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/kalshi/market ───────────────────────────────────────────────
app.get('/api/kalshi/market', async (req, res) => {
  const market = botEngine.state?.activeMarket || null;
  if (market) return res.json(market);
  return res.json({ error: 'Not connected' });
});

// ─── GET /api/kalshi/positions ────────────────────────────────────────────
app.get('/api/kalshi/positions', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const privateKeyPem = process.env.KALSHI_API_SECRET;
    const base = getBaseUrl(payload.environment);
    const p = getKalshiPath('/portfolio/positions?limit=20');
    const ts = String(Date.now());
    const { data } = await axios.get(`${base}${p}`, {
      headers: getAuthHeaders(payload.apiKey, privateKeyPem, 'GET', p, ts),
    });
    const positions = (data.market_positions || []).map(pos => ({
      ticker: pos.ticker,
      yesContracts: pos.position || 0,
      noContracts: pos.no_position || 0,
      realizedPnl: (pos.realized_pnl || 0) / 100,
      totalCost: (pos.total_traded || 0) / 100,
      feesPaid: (pos.fees_paid || 0) / 100,
    }));
    return res.json({ positions });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/kalshi/order ───────────────────────────────────────────────
app.post('/api/kalshi/order', async (req, res) => {
  const { token, action, side, ticker, count, price, environment: bodyEnv } = req.body || {};
  if (!token) return res.status(401).json({ error: 'Session token required.' });

  let payload;
  try { payload = jwt.verify(token, JWT_SECRET); }
  catch { return res.status(401).json({ error: 'Invalid or expired session token.' }); }

  const apiKeyId = payload.apiKey;
  const environment = bodyEnv || payload.environment || 'Demo';
  const privateKeyPem = process.env.KALSHI_API_SECRET;
  if (!privateKeyPem) return res.status(500).json({ error: 'KALSHI_API_SECRET not set.' });

  const base = getBaseUrl(environment);
  const p = getKalshiPath('/portfolio/orders');
  const ts = String(Date.now());

  const marketTicker = ticker || botEngine.state?.activeMarket?.ticker;
  if (!marketTicker) return res.status(400).json({ error: 'No active market found.' });

  const tradeSide = (side || (action === 'buy' ? 'yes' : 'no')).toLowerCase();
  const contractCount = Math.max(1, parseInt(count, 10) || 1);
  const contractPrice = Math.round((price || 50) * 100) / 100;
  const priceInCents = Math.round(contractPrice * 100);
  const fee = calcFee(contractCount, contractPrice, true);

  const orderBody = {
    ticker: marketTicker,
    action: 'buy',
    side: tradeSide,
    count: contractCount,
    type: 'limit',
    ...(tradeSide === 'yes' ? { yes_price: priceInCents } : { no_price: priceInCents }),
    client_order_id: `alpha-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  };

  try {
    const { data } = await axios.post(`${base}${p}`, orderBody, {
      headers: getAuthHeaders(apiKeyId, privateKeyPem, 'POST', p, ts),
    });
    return res.json({ ...data, fee, priceInCents, marketTicker });
  } catch (err) {
    const status = err.response?.status || 500;
    const message = err.response?.data?.message || err.response?.data?.error || err.message;
    return res.status(status).json({ error: message || 'Order failed.' });
  }
});

// ─── Serve built frontend ──────────────────────────────────────────────────
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(publicDir, 'index.html'));
  });
}

// ─── WebSocket proxy: browser → server → Kalshi ───────────────────────────
const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const pathname = request.url?.split('?')[0] || '';
  if (pathname !== '/api/ws') { socket.destroy(); return; }
  wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
});

wss.on('connection', (clientWs, request) => {
  const url = new URL(request.url || '', `http://${request.headers.host || 'localhost'}`);
  const environment = url.searchParams.get('environment') || 'Demo';
  const sessionToken = url.searchParams.get('token') || null;
  const kalshiUrl = environment === 'Live' ? KALSHI_WS_LIVE : KALSHI_WS_DEMO;

  let resolvedApiKey = process.env.KALSHI_API_KEY;
  if (sessionToken) {
    try {
      const payload = jwt.verify(sessionToken, JWT_SECRET);
      resolvedApiKey = payload.apiKey || resolvedApiKey;
    } catch (_) {}
  }

  const privateKeyPem = process.env.KALSHI_API_SECRET;
  let kalshiWs = null;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  const MAX_RECONNECTS = 5;

  function connectToKalshi() {
    let wsOptions = {};
    if (resolvedApiKey && privateKeyPem) {
      try { wsOptions.headers = buildWsHeaders(resolvedApiKey, privateKeyPem); } catch (_) {}
    }

    kalshiWs = new WebSocket(kalshiUrl, wsOptions);

    kalshiWs.on('open', () => {
      reconnectAttempts = 0;
    });

    kalshiWs.on('message', (data) => {
      if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data);
    });

    kalshiWs.on('close', (code, reason) => {
      if (clientWs.readyState === WebSocket.OPEN && reconnectAttempts < MAX_RECONNECTS) {
        reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), 16000);
        try { clientWs.send(JSON.stringify({ type: 'system', msg: `Reconnecting to Kalshi... (attempt ${reconnectAttempts}/${MAX_RECONNECTS})` })); } catch (_) {}
        reconnectTimer = setTimeout(connectToKalshi, delay);
      } else {
        if (clientWs.readyState === WebSocket.OPEN) clientWs.close(1001, 'Kalshi upstream closed');
      }
    });

    kalshiWs.on('error', (err) => {
      console.error('[WS] Kalshi error:', err.message);
    });
  }

  connectToKalshi();

  clientWs.on('message', (data) => {
    if (kalshiWs && kalshiWs.readyState === WebSocket.OPEN) kalshiWs.send(data);
  });

  clientWs.on('close', () => {
    clearTimeout(reconnectTimer);
    if (kalshiWs) kalshiWs.close();
  });
});

server.listen(PORT, () => {
  console.log(`Alpha Bot backend running at http://localhost:${PORT}`);
});

// ─── Graceful shutdown — close bot_run on Railway SIGTERM ────────────────────
async function gracefulShutdown(signal) {
  console.log(`[Server] ${signal} received — closing bot run and shutting down`);
  botEngine.stop();
  process.exit(0);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
