"use client";

import { fetchTradesPage } from "@/lib/kalshi/api";
import { useMarketsStore } from "@/store/marketsStore";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

export function useTrades(ticker: string | null) {
  const feed = useMarketsStore((s) => (ticker ? s.tradeFeed[ticker] : undefined));

  const q = useQuery({
    queryKey: ["trades", ticker],
    queryFn: async () => {
      if (!ticker) throw new Error("no ticker");
      const res = await fetchTradesPage({ ticker, limit: 50 });
      if (!res.ok) throw res.error;
      return res.data.trades;
    },
    enabled: !!ticker,
    staleTime: 10_000,
    refetchInterval: 10_000,
  });

  const merged = useMemo(() => {
    const rest = q.data ?? [];
    const ws = feed ?? [];
    const seen = new Set(ws.map((t) => t.trade_id));
    const out = [...ws];
    for (const t of rest) {
      if (!seen.has(t.trade_id)) out.push(t);
    }
    return out.slice(0, 50);
  }, [q.data, feed]);

  return { ...q, trades: merged };
}
