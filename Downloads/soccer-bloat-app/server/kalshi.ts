/**
 * Kalshi API — Auth, market scanning, and order placement
 *
 * Auth: RSA-PSS with SHA256
 * Headers: KALSHI-ACCESS-KEY, KALSHI-ACCESS-TIMESTAMP, KALSHI-ACCESS-SIGNATURE
 * Signature: base64(RSA-PSS-SHA256( timestamp + METHOD + path_without_query ))
 */

import crypto from "crypto";

const KALSHI_BASE = "https://api.elections.kalshi.com/trade-api/v2";

// ─── Auth helpers ─────────────────────────────────────────────────────────────

function signRequest(privateKeyPem: string, timestamp: string, method: string, path: string): string {
  // Strip query params before signing
  const pathWithoutQuery = path.split("?")[0];
  const message = `${timestamp}${method}${pathWithoutQuery}`;
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(message);
  sign.end();
  const signature = sign.sign({
    key: privateKeyPem,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
  });
  return signature.toString("base64");
}

function authHeaders(apiKeyId: string, privateKeyPem: string, method: string, path: string) {
  const timestamp = Date.now().toString();
  const signature = signRequest(privateKeyPem, timestamp, method, path);
  return {
    "KALSHI-ACCESS-KEY": apiKeyId,
    "KALSHI-ACCESS-TIMESTAMP": timestamp,
    "KALSHI-ACCESS-SIGNATURE": signature,
    "Content-Type": "application/json",
  };
}

async function kalshiGet(apiKeyId: string, privateKeyPem: string, path: string) {
  const fullPath = `/trade-api/v2${path}`;
  const headers = authHeaders(apiKeyId, privateKeyPem, "GET", fullPath);
  const resp = await fetch(`${KALSHI_BASE}${path}`, { headers });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Kalshi GET ${path} failed ${resp.status}: ${body}`);
  }
  return resp.json();
}

async function kalshiPost(apiKeyId: string, privateKeyPem: string, path: string, body: object) {
  const fullPath = `/trade-api/v2${path}`;
  const headers = authHeaders(apiKeyId, privateKeyPem, "POST", fullPath);
  const resp = await fetch(`${KALSHI_BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Kalshi POST ${path} failed ${resp.status}: ${text}`);
  }
  return resp.json();
}

// ─── Public API (no auth needed) ─────────────────────────────────────────────

export interface KalshiMarket {
  ticker: string;
  event_ticker: string;
  title: string;
  yes_bid?: number;
  yes_ask?: number;
  no_bid?: number;
  no_ask?: number;
  volume?: number;
  status: string;
  close_time?: string;
  expiration_time?: string;
}

const SOCCER_KEYWORDS = [
  "soccer", "football", "premier league", "la liga", "bundesliga", "serie a",
  "ligue 1", "champions league", "europa league", "conference league", "mls",
  "world cup", "euro", "copa", "fa cup", "efl", "eredivisie", "primeira liga",
  "will win", "team win", "match winner", "full time result",
];

function isSoccerMarket(title: string, eventTicker: string): boolean {
  const combined = (title + " " + eventTicker).toLowerCase();
  return SOCCER_KEYWORDS.some(kw => combined.includes(kw));
}

function priceToProb(price?: number): number | null {
  if (price == null || price < 1 || price > 99) return null;
  return price / 100;
}

function estimateMinute(closeTime?: string): number | undefined {
  if (!closeTime) return undefined;
  const msLeft = new Date(closeTime).getTime() - Date.now();
  if (msLeft < 0 || msLeft > 120 * 60000) return undefined;
  const elapsed = 95 * 60000 - msLeft;
  if (elapsed < 0) return undefined;
  return Math.round(elapsed / 60000);
}

export function calculateBloatScore(favoriteProb: number, minuteEstimate?: number): number {
  if (favoriteProb < 0.50 || favoriteProb > 0.85) return 0;
  const base = (favoriteProb - 0.50) * 100;
  let minuteBonus = 0;
  if (minuteEstimate != null) {
    if (minuteEstimate >= 75) minuteBonus = 20;
    else if (minuteEstimate >= 65) minuteBonus = 10;
    else minuteBonus = -10;
  }
  return Math.min(100, Math.max(0, Math.round(base + minuteBonus)));
}

export async function fetchSoccerMarkets(): Promise<KalshiMarket[]> {
  try {
    const url = `${KALSHI_BASE}/markets?status=open&limit=200`;
    const resp = await fetch(url);
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data.markets ?? []).filter((m: KalshiMarket) =>
      m.status === "open" && isSoccerMarket(m.title, m.event_ticker || "")
    );
  } catch (e) {
    console.error("Kalshi public fetch error:", e);
    return [];
  }
}

export interface BloatCandidate {
  eventTicker: string;
  matchTitle: string;
  ticker: string;
  marketTitle: string;
  favoriteProb: number;
  drawProb?: number;
  drawPrice?: number;   // NO price in cents (1-99)
  yesPrice?: number;    // YES price in cents (1-99)
  minuteEstimate?: number;
  bloatScore: number;
}

export async function scanForBloat(config: {
  minFavoriteProb: number;
  maxFavoriteProb: number;
  minMinute?: number;
}): Promise<BloatCandidate[]> {
  const markets = await fetchSoccerMarkets();
  const candidates: BloatCandidate[] = [];

  for (const market of markets) {
    const yesProb = priceToProb(market.yes_bid);
    if (yesProb == null) continue;

    const favoriteProb = yesProb;
    if (favoriteProb < config.minFavoriteProb || favoriteProb > config.maxFavoriteProb) continue;

    const minuteEstimate = estimateMinute(market.close_time ?? market.expiration_time);
    if (config.minMinute && minuteEstimate != null && minuteEstimate < config.minMinute) continue;

    const bloatScore = calculateBloatScore(favoriteProb, minuteEstimate);
    if (bloatScore < 10) continue;

    const noProb = priceToProb(market.no_bid);

    candidates.push({
      eventTicker: market.event_ticker,
      matchTitle: market.event_ticker.replace(/-/g, " "),
      ticker: market.ticker,
      marketTitle: market.title,
      favoriteProb,
      drawProb: noProb ?? undefined,
      drawPrice: market.no_bid,
      yesPrice: market.yes_bid,
      minuteEstimate,
      bloatScore,
    });
  }

  return candidates.sort((a, b) => b.bloatScore - a.bloatScore);
}

// ─── Authenticated API calls ──────────────────────────────────────────────────

/** Fetch account balance in dollars */
export async function getBalance(apiKeyId: string, privateKeyPem: string): Promise<number> {
  const data = await kalshiGet(apiKeyId, privateKeyPem, "/portfolio/balance");
  // balance is in cents
  return (data.balance ?? 0) / 100;
}

/** Test credentials — returns balance or throws */
export async function testCredentials(apiKeyId: string, privateKeyPem: string): Promise<{ valid: boolean; balance?: number; error?: string }> {
  try {
    const balance = await getBalance(apiKeyId, privateKeyPem);
    return { valid: true, balance };
  } catch (e: unknown) {
    return { valid: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export type BetMode = "no_only" | "yes_only" | "both";

/**
 * Place a bet on a bloat signal.
 * - "no_only": buy NO (draw or upset wins) — the classic favorite-bloat play
 * - "yes_only": buy YES on the favorite — contrarian, only if you want to fade the bloat
 * - "both": place a small bet on both sides (hedge)
 *
 * Returns placed order(s).
 */
export async function placeBloatBet(
  apiKeyId: string,
  privateKeyPem: string,
  ticker: string,
  betMode: BetMode,
  betAmountDollars: number,
  market: { drawPrice?: number; yesPrice?: number }
): Promise<{ orderId: string; side: string; price: number; cost: number }[]> {
  const results: { orderId: string; side: string; price: number; cost: number }[] = [];

  // Helper: calculate contracts from dollar amount and price
  // price is in cents (1-99). Each contract costs price/100 dollars.
  function calcContracts(price: number, dollarBudget: number): number {
    const costPerContract = price / 100;
    return Math.max(1, Math.floor(dollarBudget / costPerContract));
  }

  async function placeOrder(side: "no" | "yes", price: number, budget: number) {
    const count = calcContracts(price, budget);
    const clientOrderId = `bloat-${Date.now()}-${side}`;

    const body: Record<string, unknown> = {
      ticker,
      side,
      action: "buy",
      client_order_id: clientOrderId,
      count,
      time_in_force: "fill_or_kill",
    };

    // Set price on the appropriate side
    if (side === "no") {
      body.no_price = price;
    } else {
      body.yes_price = price;
    }

    const resp = await kalshiPost(apiKeyId, privateKeyPem, "/portfolio/orders", body);
    const order = resp.order;
    results.push({
      orderId: order.order_id,
      side,
      price,
      cost: (price / 100) * count,
    });
  }

  if (betMode === "no_only" || betMode === "both") {
    const noPrice = market.drawPrice;
    if (!noPrice) throw new Error("No price not available for this market");
    const budget = betMode === "both" ? betAmountDollars / 2 : betAmountDollars;
    await placeOrder("no", noPrice, budget);
  }

  if (betMode === "yes_only" || betMode === "both") {
    const yesPrice = market.yesPrice;
    if (!yesPrice) throw new Error("Yes price not available for this market");
    const budget = betMode === "both" ? betAmountDollars / 2 : betAmountDollars;
    await placeOrder("yes", yesPrice, budget);
  }

  return results;
}
