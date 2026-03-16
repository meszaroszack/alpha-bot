import crypto from 'crypto';

export const DEMO_BASE = 'https://demo-api.kalshi.co';
export const LIVE_BASE = 'https://api.elections.kalshi.com';

export const KALSHI_WS_DEMO = 'wss://demo-api.kalshi.co/trade-api/ws/v2';
export const KALSHI_WS_LIVE = 'wss://api.elections.kalshi.com/trade-api/ws/v2';
export const KALSHI_WS_PATH = '/trade-api/ws/v2';

/**
 * RSA-PSS SHA256 signature for Kalshi API.
 * Message: timestamp + method + path (no query params)
 */
export function signRequest(privateKeyPem, timestamp, method, path) {
  const pathNoQuery = path.split('?')[0];
  const message = `${timestamp}${method}${pathNoQuery}`;
  const key = crypto.createPrivateKey(privateKeyPem);
  const signature = crypto.sign('sha256', Buffer.from(message, 'utf8'), {
    key,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
  });
  return signature.toString('base64');
}

export function getBaseUrl(environment) {
  return environment === 'Live' ? LIVE_BASE : DEMO_BASE;
}

export function getKalshiPath(p) {
  return p.startsWith('/trade-api') ? p : `/trade-api/v2${p.startsWith('/') ? p : '/' + p}`;
}

export function getAuthHeaders(apiKeyId, privateKeyPem, method, path, timestamp) {
  const ts = timestamp || String(Date.now());
  const sig = signRequest(privateKeyPem, ts, method, path);
  return {
    'KALSHI-ACCESS-KEY': apiKeyId,
    'KALSHI-ACCESS-TIMESTAMP': ts,
    'KALSHI-ACCESS-SIGNATURE': sig,
    'Content-Type': 'application/json',
  };
}

export function buildWsHeaders(apiKeyId, privateKeyPem) {
  const ts = String(Date.now());
  const sig = signRequest(privateKeyPem, ts, 'GET', KALSHI_WS_PATH);
  return {
    'KALSHI-ACCESS-KEY': apiKeyId,
    'KALSHI-ACCESS-TIMESTAMP': ts,
    'KALSHI-ACCESS-SIGNATURE': sig,
  };
}

/**
 * Kalshi fee formula (taker): ceil(0.07 * C * P * (1-P) * 100) / 100
 * Maker: same with 0.0175 multiplier
 */
export function calcFee(contracts, priceDollars, maker = false) {
  const mult = maker ? 0.0175 : 0.07;
  const p = Math.max(0.01, Math.min(0.99, priceDollars));
  return Math.ceil(mult * contracts * p * (1 - p) * 100) / 100;
}
