"use client";

import { fetchMarketCandlesticks } from "@/lib/kalshi/api";
import type { Timeframe } from "@/store/uiStore";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

function periodForTf(tf: Timeframe): 1 | 60 | 1440 {
  if (tf === "1m") return 1;
  if (tf === "1h") return 60;
  return 1440;
}

function rangeForTf(tf: Timeframe): { start: number; end: number } {
  const end = Math.floor(Date.now() / 1000);
  const day = 86400;
  if (tf === "1m") return { start: end - 2 * day, end };
  if (tf === "1h") return { start: end - 30 * day, end };
  return { start: end - 365 * day, end };
}

export function useCandlesticks(
  seriesTicker: string | null,
  ticker: string | null,
  timeframe: Timeframe
) {
  const { start, end } = useMemo(() => rangeForTf(timeframe), [timeframe]);
  const period = useMemo(() => periodForTf(timeframe), [timeframe]);

  return useQuery({
    queryKey: ["candles", seriesTicker, ticker, timeframe, start, end, period],
    queryFn: async () => {
      if (!seriesTicker || !ticker) throw new Error("missing series/ticker");
      const res = await fetchMarketCandlesticks({
        seriesTicker,
        ticker,
        startTs: start,
        endTs: end,
        periodInterval: period,
      });
      if (!res.ok) throw res.error;
      return res.data;
    },
    enabled: !!seriesTicker && !!ticker,
    staleTime: 60_000,
  });
}
