require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Force no-cache on all routes so Railway/Browser never serve 304s
app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    next();
});

// Kalshi API Configuration
const KALSHI_API_BASE = (process.env.KALSHI_API_BASE || 'https://trading-api.kalshi.com').replace(/\/$/, '');

// API Keys
const KEY_ID = process.env.KALSHI_KEY_ID;
let PRIVATE_KEY = process.env.KALSHI_PRIVATE_KEY;

// Auto-fix mangled private keys from Railway
if (PRIVATE_KEY) {
    PRIVATE_KEY = PRIVATE_KEY.replace(/\\n/g, '\n');
    if (!PRIVATE_KEY.includes('\n')) {
        PRIVATE_KEY = PRIVATE_KEY.replace('-----BEGIN RSA PRIVATE KEY-----', '-----BEGIN RSA PRIVATE KEY-----\n');
        PRIVATE_KEY = PRIVATE_KEY.replace('-----END RSA PRIVATE KEY-----', '\n-----END RSA PRIVATE KEY-----');
        const parts = PRIVATE_KEY.split('\n');
        if (parts.length === 3) {
            const base64Body = parts[1].replace(/ /g, '\n');
            PRIVATE_KEY = `${parts[0]}\n${base64Body}\n${parts[2]}`;
        }
    }
}

// Helper function to generate RSA signed headers for Kalshi API V2
function getAuthHeaders(method, requestPath) {
    if (!KEY_ID || !PRIVATE_KEY) {
        throw new Error("Missing KALSHI_KEY_ID or KALSHI_PRIVATE_KEY in Railway Variables.");
    }
    
    const timestamp = Date.now().toString();
    const msgString = timestamp + method + requestPath;
    
    try {
        const sign = crypto.createSign('RSA-SHA256');
        sign.update(msgString);
        sign.end();
        
        const signature = sign.sign(PRIVATE_KEY, 'base64');
        
        return {
            'KALSHI-ACCESS-KEY': KEY_ID,
            'KALSHI-ACCESS-SIGNATURE': signature,
            'KALSHI-ACCESS-TIMESTAMP': timestamp,
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        };
    } catch (err) {
        console.error("Crypto Sign Error:", err.message);
        throw new Error("Invalid RSA Private Key format. Please check your Railway variables.");
    }
}

// ==========================================
// STRICT API ROUTER - NO HTML ALLOWED HERE
// ==========================================
const apiRouter = express.Router();

// Endpoint: Fetch the active 15m BTC Market
apiRouter.get('/market', async (req, res) => {
    try {
        const seriesTicker = process.env.BTC_SERIES_TICKER || 'KXBTC15M'; 
        const requestPath = `/trade-api/v2/markets?limit=5&series_ticker=${seriesTicker}&status=open`;
        
        const headers = getAuthHeaders('GET', requestPath);
        const marketRes = await axios.get(`${KALSHI_API_BASE}${requestPath}`, { headers });

        if (marketRes.data && marketRes.data.markets && marketRes.data.markets.length > 0) {
            const sortedMarkets = marketRes.data.markets.sort((a, b) => new Date(a.close_time) - new Date(b.close_time));
            return res.json({ market: sortedMarkets[0] });
        } else {
            return res.status(404).json({ error: `No open markets found for ticker: ${seriesTicker}` });
        }
    } catch (error) {
        console.error('Market Fetch Error:', error.response?.data || error.message);
        const errorMsg = error.response?.data?.error?.message || error.message || "Failed to connect to Kalshi";
        return res.status(500).json({ error: errorMsg });
    }
});

// Endpoint: Receive frontend hotkey trigger and execute order
apiRouter.post('/order', async (req, res) => {
    const { action, side, count, max_price, ticker } = req.body;
    
    if (!ticker) {
        return res.status(400).json({ error: 'No active market ticker specified.' });
    }

    try {
        const orderPayload = {
            ticker: ticker,
            action: action.toLowerCase(), 
            side: side.toLowerCase(),     
            count: parseInt(count),
            type: 'limit',
            client_order_id: crypto.randomUUID() 
        };

        if (side.toLowerCase() === 'yes') {
            orderPayload.yes_price = parseInt(max_price);
        } else {
            orderPayload.no_price = parseInt(max_price);
        }

        const requestPath = '/trade-api/v2/portfolio/orders';
        const headers = getAuthHeaders('POST', requestPath);

        console.log(`Executing ${action.toUpperCase()} for ${count} ${side.toUpperCase()} contracts on ${ticker} at ${max_price}c`);

        const orderRes = await axios.post(`${KALSHI_API_BASE}${requestPath}`, orderPayload, { headers });

        return res.json({ success: true, order: orderRes.data.order });
    } catch (error) {
        console.error('Order Error:', error.response?.data || error.message);
        const errMsg = error.response?.data?.error?.message || error.message || 'Failed to place order';
        return res.status(500).json({ error: errMsg });
    }
});

// CATCH-ALL FOR API: Force JSON error if a bad API path is hit
apiRouter.all('*', (req, res) => {
    return res.status(404).json({ error: `API Endpoint not found: ${req.originalUrl}` });
});

// Mount the strictly isolated API router
app.use('/api', apiRouter);

// ==========================================
// FRONTEND / STATIC FILES ROUTER
// ==========================================
app.use(express.static(path.join(__dirname, 'public')));

// Fallback to serve the HTML app for any non-API routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Kalshi Hotkey Trader strictly listening on port ${PORT}`);
});
