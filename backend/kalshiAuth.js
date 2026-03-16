import crypto from 'crypto';

const DEMO_BASE = 'https://demo-api.kalshi.co';
const LIVE_BASE = 'https://api.kalshi.com';

/**
 * Create RSA-PSS SHA256 signature for Kalshi API.
 * Message format: timestamp + method + path (no query params).
 * @param {string} privateKeyPem - PEM string of RSA private key
 * @param {string} timestamp - milliseconds
 * @param {string} method - GET, POST, etc.
 * @param {string} path - e.g. /trade-api/v2/portfolio/balance
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

export function getKalshiPath(path) {
  return path.startsWith('/trade-api') ? path : `/trade-api/v2${path.startsWith('/') ? path : '/' + path}`;
}
