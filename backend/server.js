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
import { signRequest, getBaseUrl, getKalshiPath } from './kalshiAuth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

const KALSHI_WS_DEMO = 'wss://demo-api.kalshi.co/trade-api/ws/v2';
const KALSHI_WS_LIVE = 'wss://api.kalshi.com/trade-api/ws/v2';
const KALSHI_WS_PATH = '/trade-api/ws/v2';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const publicDir = path.join(__dirname, 'public');

app.use(cors());
app.use(express.json());

function getAuthHeaders(apiKeyId, privateKeyPem, method, path, timestamp) {
  const signature = signRequest(privateKeyPem, timestamp, method, path);
  return {
    'KALSHI-ACCESS-KEY': apiKeyId,
    'KALSHI-ACCESS-TIMESTAMP': timestamp,
    'KALSHI-ACCESS-SIGNATURE': signature,
    'Content-Type': 'application/json',
  };
}

// POST /api/kalshi/auth — verify credentials and return a session token
app.post('/api/kalshi/auth', async (req, res) => {
  const { apiKey, environment = 'Demo' } = req.body || {};
  const apiKeyId = apiKey || process.env.KALSHI_API_KEY;
  const privateKeyPem = process.env.KALSHI_API_SECRET;

  if (!apiKeyId) {
    return res.status(400).json({ error: 'API Key (KALSHI_API_KEY or apiKey in body) is required.' });
  }
  if (!privateKeyPem) {
    return res.status(500).json({ error: 'Server misconfiguration: KALSHI_API_SECRET is not set.' });
  }

  const baseUrl = getBaseUrl(environment);
  const path = getKalshiPath('/portfolio/balance');
  const timestamp = String(Date.now());

  try {
    const { data } = await axios.get(`${baseUrl}${path}`, {
      headers: getAuthHeaders(apiKeyId, privateKeyPem, 'GET', path, timestamp),
    });
    const token = jwt.sign(
      { apiKey: apiKeyId, environment },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    return res.json({ token, balance: data.balance });
  } catch (err) {
    const status = err.response?.status || 500;
    const message = err.response?.data?.message || err.response?.data?.error || err.message;
    return res.status(status).json({ error: message || 'Kalshi authentication failed.' });
  }
});

// POST /api/kalshi/order — place order via Kalshi (session token required)
app.post('/api/kalshi/order', async (req, res) => {
  const { token, action, market, count, environment: bodyEnv } = req.body || {};
  if (!token) {
    return res.status(401).json({ error: 'Session token is required.' });
  }

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session token.' });
  }

  const apiKeyId = payload.apiKey;
  const environment = bodyEnv || payload.environment || 'Demo';
  const privateKeyPem = process.env.KALSHI_API_SECRET;
  if (!privateKeyPem) {
    return res.status(500).json({ error: 'Server misconfiguration: KALSHI_API_SECRET is not set.' });
  }

  const baseUrl = getBaseUrl(environment);
  const path = getKalshiPath('/portfolio/orders');
  const timestamp = String(Date.now());

  const ticker = market || 'BTC-USD';
  const actionLower = (action || 'buy').toLowerCase();
  const orderBody = {
    ticker,
    action: actionLower,
    side: actionLower === 'buy' ? 'yes' : 'no',
    count: Math.max(1, parseInt(count, 10) || 1),
    type: 'limit',
    yes_price: 50,
    no_price: 50,
    client_order_id: `alpha-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
  };
  if (actionLower === 'buy') delete orderBody.no_price;
  else delete orderBody.yes_price;

  try {
    const { data } = await axios.post(`${baseUrl}${path}`, orderBody, {
      headers: getAuthHeaders(apiKeyId, privateKeyPem, 'POST', path, timestamp),
    });
    return res.json(data);
  } catch (err) {
    const status = err.response?.status || 500;
    const message = err.response?.data?.message || err.response?.data?.error || err.message;
    return res.status(status).json({ error: message || 'Order placement failed.' });
  }
});

// Serve built frontend when present (e.g. after npm run build for Railway)
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(publicDir, 'index.html'));
  });
}

// HTTP server (for Express + WebSocket upgrade)
const server = createServer(app);

// WebSocket proxy: browser -> our server -> Kalshi (avoids origin/1006 from direct Kalshi connection)
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const pathname = request.url?.split('?')[0] || '';
  if (pathname !== '/api/ws') {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (clientWs) => {
    wss.emit('connection', clientWs, request);
  });
});

function buildKalshiWsHeaders(apiKeyId, privateKeyPem) {
  // Kalshi WS auth: sign timestamp + "GET" + ws path (no query params)
  const timestamp = String(Date.now());
  const signature = signRequest(privateKeyPem, timestamp, 'GET', KALSHI_WS_PATH);
  return {
    'KALSHI-ACCESS-KEY': apiKeyId,
    'KALSHI-ACCESS-TIMESTAMP': timestamp,
    'KALSHI-ACCESS-SIGNATURE': signature,
  };
}

wss.on('connection', (clientWs, request) => {
  const url = new URL(request.url || '', `http://${request.headers.host || 'localhost'}`);
  const environment = url.searchParams.get('environment') || 'Demo';
  const kalshiUrl = environment === 'Live' ? KALSHI_WS_LIVE : KALSHI_WS_DEMO;

  // Extract session token from query string so we can sign the WS handshake
  const sessionToken = url.searchParams.get('token') || null;
  const apiKeyId = process.env.KALSHI_API_KEY;
  const privateKeyPem = process.env.KALSHI_API_SECRET;

  // Resolve API key: prefer token payload, fall back to env
  let resolvedApiKey = apiKeyId;
  if (sessionToken) {
    try {
      const payload = jwt.verify(sessionToken, JWT_SECRET);
      resolvedApiKey = payload.apiKey || apiKeyId;
    } catch (_) { /* use env fallback */ }
  }

  // Build auth headers for Kalshi WS handshake (required for private channels)
  let wsOptions = {};
  if (resolvedApiKey && privateKeyPem) {
    try {
      wsOptions.headers = buildKalshiWsHeaders(resolvedApiKey, privateKeyPem);
    } catch (e) {
      console.error('[WS] Failed to build Kalshi auth headers:', e.message);
    }
  }

  let kalshiWs = null;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  const MAX_RECONNECTS = 5;

  function connectToKalshi() {
    // Refresh timestamp for each (re)connect attempt
    if (resolvedApiKey && privateKeyPem) {
      try {
        wsOptions.headers = buildKalshiWsHeaders(resolvedApiKey, privateKeyPem);
      } catch (_) {}
    }

    kalshiWs = new WebSocket(kalshiUrl, wsOptions);

    kalshiWs.on('open', () => {
      reconnectAttempts = 0;
      console.log(`[WS] Connected to Kalshi (${environment})`);
    });

    kalshiWs.on('message', (data) => {
      if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data);
    });

    kalshiWs.on('close', (code, reason) => {
      console.log(`[WS] Kalshi disconnected: code=${code} reason=${reason}`);
      if (clientWs.readyState === WebSocket.OPEN && reconnectAttempts < MAX_RECONNECTS) {
        reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), 16000);
        console.log(`[WS] Reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECTS})...`);
        // Notify client of reconnect attempt
        try {
          clientWs.send(JSON.stringify({ type: 'system', msg: `Reconnecting to Kalshi... (attempt ${reconnectAttempts})` }));
        } catch (_) {}
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
