/**
 * Kalshi Trade API v2 — typed REST helpers.
 * Base URL defaults to `NEXT_PUBLIC_KALSHI_BASE_URL` or production elections host.
 */

import { err, KalshiError, ok, type Result } from "./errors";
import { enqueueRequest } from "./throttle";
import type {
  KalshiCandlesticksResponse,
  KalshiEventResponse,
  KalshiEventsResponse,
  KalshiMarketResponse,
  KalshiMarketsResponse,
  KalshiOrderBookResponse,
  KalshiSeries,
  KalshiSeriesListResponse,
  KalshiTradesResponse,
} from "./types";

function getBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_KALSHI_BASE_URL ??
    "https://api.elections.kalshi.com/trade-api/v2"
  ).replace(/\/$/, "");
}

function debugLog(...args: unknown[]) {
  if (
    process.env.NODE_ENV === "development" &&
    process.env.NEXT_PUBLIC_DEBUG_API === "true"
  ) {
    console.debug("[kalshi]", ...args);
  }
}

function devError(...args: unknown[]) {
  if (process.env.NODE_ENV === "development") {
    console.error("[kalshi]", ...args);
  }
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * Low-level JSON fetch with throttling, typed Result, and 429 retry.
 */
export async function kalshiFetchJson<T>(
  path: string,
  init?: RequestInit,
  attempt = 0
): Promise<Result<T>> {
  const url = `${getBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  const exec = async (): Promise<Result<T>> => {
    try {
      const res = await fetch(url, {
        ...init,
        headers: {
          Accept: "application/json",
          ...(init?.headers ?? {}),
        },
        cache: "no-store",
      });
      if (res.status === 429 && attempt < 5) {
        const retryAfter = res.headers.get("retry-after");
        const seconds = retryAfter ? Number(retryAfter) : NaN;
        const waitMs = Number.isFinite(seconds) ? seconds * 1000 : 2000;
        devError("429 rate limit", url, "retry in", waitMs);
        await sleep(waitMs);
        return kalshiFetchJson<T>(path, init, attempt + 1);
      }
      const text = await res.text();
      if (!res.ok) {
        return err(
          new KalshiError(`HTTP ${res.status}: ${text.slice(0, 200)}`, "http", {
            status: res.status,
            body: text,
          })
        );
      }
      try {
        return ok(JSON.parse(text) as T);
      } catch (e) {
        return err(
          new KalshiError("Failed to parse JSON", "parse", { cause: e, body: text })
        );
      }
    } catch (e) {
      return err(
        new KalshiError(
          e instanceof Error ? e.message : "Network error",
          "network",
          { cause: e }
        )
      );
    }
  };
  return enqueueRequest(exec);
}

/**
 * `GET /series` — list series (paginated).
 * @param cursor Pagination cursor from previous response.
 */
export async function fetchSeriesPage(
  cursor?: string
): Promise<Result<KalshiSeriesListResponse>> {
  const q = new URLSearchParams();
  if (cursor) q.set("cursor", cursor);
  q.set("limit", "200");
  debugLog("fetchSeriesPage", q.toString());
  return kalshiFetchJson<KalshiSeriesListResponse>(`/series?${q.toString()}`);
}

/**
 * Fetch all series pages until cursor is empty.
 */
export async function fetchAllSeries(): Promise<
  Result<KalshiSeriesListResponse["series"]>
> {
  const all: KalshiSeriesListResponse["series"] = [];
  let cursor: string | undefined;
  for (;;) {
    const res = await fetchSeriesPage(cursor);
    if (!res.ok) return res;
    all.push(...res.data.series);
    cursor = res.data.cursor;
    if (!cursor) break;
  }
  return ok(all);
}

/**
 * `GET /events` — list events; use `with_nested_markets=true` for markets on each event.
 * @param params.status e.g. `open`
 */
export async function fetchEventsPage(params: {
  status?: string;
  with_nested_markets?: boolean;
  cursor?: string;
  limit?: number;
  series_ticker?: string;
}): Promise<Result<KalshiEventsResponse>> {
  const q = new URLSearchParams();
  if (params.status) q.set("status", params.status);
  if (params.with_nested_markets) q.set("with_nested_markets", "true");
  if (params.cursor) q.set("cursor", params.cursor);
  if (params.series_ticker) q.set("series_ticker", params.series_ticker);
  q.set("limit", String(params.limit ?? 200));
  debugLog("fetchEventsPage", q.toString());
  return kalshiFetchJson<KalshiEventsResponse>(`/events?${q.toString()}`);
}

/**
 * Paginate all open events with nested markets.
 */
export async function fetchAllOpenEventsWithNestedMarkets(): Promise<
  Result<KalshiEventsResponse["events"]>
> {
  const all: KalshiEventsResponse["events"] = [];
  let cursor: string | undefined;
  for (;;) {
    const res = await fetchEventsPage({
      status: "open",
      with_nested_markets: true,
      cursor,
      limit: 200,
    });
    if (!res.ok) return res;
    all.push(...res.data.events);
    cursor = res.data.cursor;
    if (!cursor) break;
  }
  return ok(all);
}

/**
 * `GET /markets` — paginated list of markets.
 */
export async function fetchMarketsPage(params: {
  status?: string;
  cursor?: string;
  limit?: number;
}): Promise<Result<KalshiMarketsResponse>> {
  const q = new URLSearchParams();
  if (params.status) q.set("status", params.status);
  if (params.cursor) q.set("cursor", params.cursor);
  q.set("limit", String(params.limit ?? 200));
  debugLog("fetchMarketsPage", q.toString());
  return kalshiFetchJson<KalshiMarketsResponse>(`/markets?${q.toString()}`);
}

/**
 * Fetch all open markets (paginated).
 */
export async function fetchAllOpenMarkets(): Promise<
  Result<KalshiMarketsResponse["markets"]>
> {
  const all: KalshiMarketsResponse["markets"] = [];
  let cursor: string | undefined;
  for (;;) {
    const res = await fetchMarketsPage({
      status: "open",
      cursor,
      limit: 200,
    });
    if (!res.ok) return res;
    all.push(...res.data.markets);
    cursor = res.data.cursor;
    if (!cursor) break;
  }
  return ok(all);
}

/**
 * `GET /markets/{ticker}` — single market detail.
 */
export async function fetchMarket(
  ticker: string
): Promise<Result<KalshiMarketResponse>> {
  const enc = encodeURIComponent(ticker);
  return kalshiFetchJson<KalshiMarketResponse>(`/markets/${enc}`);
}

/**
 * `GET /markets/{ticker}/orderbook` — full order book (yes/no bids and asks in fp).
 */
export async function fetchOrderBook(
  ticker: string
): Promise<Result<KalshiOrderBookResponse>> {
  const enc = encodeURIComponent(ticker);
  return kalshiFetchJson<KalshiOrderBookResponse>(`/markets/${enc}/orderbook`);
}

/**
 * `GET /series/{series_ticker}/markets/{ticker}/candlesticks
 * OHLC for YES bid / ask / etc. Use `yes_bid` for candlestick chart per spec.
 */
export async function fetchMarketCandlesticks(params: {
  seriesTicker: string;
  ticker: string;
  startTs: number;
  endTs: number;
  periodInterval: 1 | 60 | 1440;
}): Promise<Result<KalshiCandlesticksResponse>> {
  const st = encodeURIComponent(params.seriesTicker);
  const tk = encodeURIComponent(params.ticker);
  const q = new URLSearchParams({
    start_ts: String(params.startTs),
    end_ts: String(params.endTs),
    period_interval: String(params.periodInterval),
  });
  return kalshiFetchJson<KalshiCandlesticksResponse>(
    `/series/${st}/markets/${tk}/candlesticks?${q.toString()}`
  );
}

/**
 * `GET /markets/trades` — recent trades; filter with `ticker` query.
 */
export async function fetchTradesPage(params: {
  ticker: string;
  limit?: number;
  cursor?: string;
}): Promise<Result<KalshiTradesResponse>> {
  const q = new URLSearchParams();
  q.set("ticker", params.ticker);
  q.set("limit", String(params.limit ?? 100));
  if (params.cursor) q.set("cursor", params.cursor);
  return kalshiFetchJson<KalshiTradesResponse>(
    `/markets/trades?${q.toString()}`
  );
}

/**
 * `GET /events/{event_ticker}` — event + markets (includes `series_ticker` on event).
 */
export async function fetchEvent(
  eventTicker: string
): Promise<Result<KalshiEventResponse>> {
  const enc = encodeURIComponent(eventTicker);
  return kalshiFetchJson<KalshiEventResponse>(`/events/${enc}`);
}

/**
 * `GET /series/{series_ticker}` — series metadata.
 */
export async function fetchSeriesByTicker(
  seriesTicker: string
): Promise<Result<{ series: KalshiSeries }>> {
  const enc = encodeURIComponent(seriesTicker);
  return kalshiFetchJson<{ series: KalshiSeries }>(`/series/${enc}`);
}

/**
 * `GET /events` — list events for a series (paginated).
 */
export async function fetchEventsForSeries(
  seriesTicker: string
): Promise<Result<KalshiEventsResponse["events"]>> {
  const all: KalshiEventsResponse["events"] = [];
  let cursor: string | undefined;
  for (;;) {
    const res = await fetchEventsPage({
      series_ticker: seriesTicker,
      with_nested_markets: true,
      cursor,
      limit: 200,
    });
    if (!res.ok) return res;
    all.push(...res.data.events);
    cursor = res.data.cursor;
    if (!cursor) break;
  }
  return ok(all);
}
