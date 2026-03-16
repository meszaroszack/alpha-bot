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
const KALSHI_WS_LIVE = 'wss://api.elections.kalshi.com/trade-api/ws/v2';
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

wss.on('connection', (clientWs, request) => {
  const url = new URL(request.url || '', `http://${request.headers.host || 'localhost'}`);
  const environment = url.searchParams.get('environment') || 'Demo';
  const kalshiUrl = environment === 'Live' ? KALSHI_WS_LIVE : KALSHI_WS_DEMO;

  const kalshiWs = new WebSocket(kalshiUrl);

  kalshiWs.on('message', (data) => {
    if (clientWs.readyState === 1) clientWs.send(data);
  });

  kalshiWs.on('close', () => {
    if (clientWs.readyState === 1) clientWs.close();
  });

  kalshiWs.on('error', () => {
    if (clientWs.readyState === 1) clientWs.close();
  });

  clientWs.on('message', (data) => {
    if (kalshiWs.readyState === 1) kalshiWs.send(data);
  });

  clientWs.on('close', () => {
    kalshiWs.close();
  });
});

server.listen(PORT, () => {
  console.log(`Alpha Bot backend running at http://localhost:${PORT}`);
});
