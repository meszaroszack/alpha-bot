"use client";

import { fetchAllOpenEventsWithNestedMarkets } from "@/lib/kalshi/api";
import type { KalshiMarket, MarketRow } from "@/lib/kalshi/types";
import { useMarketsStore } from "@/store/marketsStore";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

function buildRows(events: import("@/lib/kalshi/types").KalshiEvent[]): MarketRow[] {
  const rows: MarketRow[] = [];
  for (const ev of events) {
    const markets = ev.markets ?? [];
    for (const m of markets) {
      if (m.status && m.status !== "active" && m.status !== "open") continue;
      rows.push({
        ticker: m.ticker,
        title: m.title,
        category: ev.category,
        eventTitle: ev.title,
        seriesTicker: ev.series_ticker,
        eventTicker: ev.event_ticker,
        market: m,
      });
    }
  }
  return rows;
}

export function useMarkets() {
  const setRows = useMarketsStore((s) => s.setRows);

  const q = useQuery({
    queryKey: ["markets", "open-events"],
    queryFn: async () => {
      const res = await fetchAllOpenEventsWithNestedMarkets();
      if (!res.ok) throw res.error;
      return buildRows(res.data);
    },
    staleTime: 15_000,
    refetchInterval: 15_000,
  });

  useEffect(() => {
    if (q.data) setRows(q.data);
  }, [q.data, setRows]);

  return q;
}
