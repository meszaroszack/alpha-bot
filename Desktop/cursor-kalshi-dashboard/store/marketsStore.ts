import type { KalshiMarket, KalshiTrade, MarketRow } from "@/lib/kalshi/types";
import { parseDollars } from "@/lib/kalshi/parse";
import { create } from "zustand";

export type EnrichedMarket = KalshiMarket & {
  category: string;
  eventTitle: string;
  seriesTicker: string;
};

type State = {
  rows: MarketRow[];
  marketsByTicker: Record<string, EnrichedMarket>;
  lastUpdated: number | null;
  tradeFeed: Record<string, KalshiTrade[]>;
  setRows: (rows: MarketRow[]) => void;
  applyTickerWs: (msg: Record<string, unknown>) => void;
  applyTradeWs: (msg: Record<string, unknown>) => void;
  clearTradeFeed: (ticker: string) => void;
};

function asStr(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export const useMarketsStore = create<State>((set, get) => ({
  rows: [],
  marketsByTicker: {},
  lastUpdated: null,
  tradeFeed: {},

  setRows: (rows) => {
    const map: Record<string, EnrichedMarket> = {};
    for (const r of rows) {
      map[r.ticker] = {
        ...r.market,
        category: r.category,
        eventTitle: r.eventTitle,
        seriesTicker: r.seriesTicker,
      };
    }
    set({ rows, marketsByTicker: map, lastUpdated: Date.now() });
  },

  applyTickerWs: (msg) => {
    const ticker = asStr(msg.market_ticker);
    if (!ticker) return;
    const prev = get().marketsByTicker[ticker];
    if (!prev) return;
    const next: EnrichedMarket = { ...prev };
    const yb = asStr(msg.yes_bid_dollars);
    const ya = asStr(msg.yes_ask_dollars);
    const nb = asStr(msg.no_bid_dollars);
    const na = asStr(msg.no_ask_dollars);
    const lp = asStr(msg.last_price_dollars);
    if (yb !== undefined) next.yes_bid_dollars = yb;
    if (ya !== undefined) next.yes_ask_dollars = ya;
    if (nb !== undefined) next.no_bid_dollars = nb;
    if (na !== undefined) next.no_ask_dollars = na;
    if (lp !== undefined) next.last_price_dollars = lp;
    const v24 = asStr(msg.volume_24h_fp);
    if (v24 !== undefined) next.volume_24h_fp = v24;

    set((s) => ({
      marketsByTicker: { ...s.marketsByTicker, [ticker]: next },
      rows: s.rows.map((r) =>
        r.ticker === ticker
          ? {
              ...r,
              market: {
                ...r.market,
                yes_bid_dollars: next.yes_bid_dollars,
                yes_ask_dollars: next.yes_ask_dollars,
                no_bid_dollars: next.no_bid_dollars,
                no_ask_dollars: next.no_ask_dollars,
                last_price_dollars: next.last_price_dollars,
                volume_24h_fp: next.volume_24h_fp,
              },
            }
          : r
      ),
      lastUpdated: Date.now(),
    }));
  },

  applyTradeWs: (msg) => {
    const ticker = asStr(msg.market_ticker);
    if (!ticker) return;
    const trade: KalshiTrade = {
      trade_id: asStr(msg.trade_id) ?? `ws-${Date.now()}`,
      ticker,
      yes_price_dollars: asStr(msg.yes_price_dollars) ?? "0",
      no_price_dollars: asStr(msg.no_price_dollars) ?? "0",
      count_fp: asStr(msg.count_fp) ?? "0",
      taker_side: (msg.taker_side as "yes" | "no") ?? "yes",
      created_time: asStr(msg.created_time) ?? new Date().toISOString(),
    };
    set((s) => {
      const cur = s.tradeFeed[ticker] ?? [];
      return {
        tradeFeed: {
          ...s.tradeFeed,
          [ticker]: [trade, ...cur].slice(0, 100),
        },
      };
    });
  },

  clearTradeFeed: (ticker) =>
    set((s) => {
      const { [ticker]: _, ...rest } = s.tradeFeed;
      return { tradeFeed: rest };
    }),
}));

export function selectPctChange(row: MarketRow): number | null {
  const last = parseDollars(row.market.last_price_dollars);
  const prev = parseDollars(row.market.previous_price_dollars);
  if (!Number.isFinite(last) || !Number.isFinite(prev) || prev === 0) return null;
  return ((last - prev) / prev) * 100;
}
