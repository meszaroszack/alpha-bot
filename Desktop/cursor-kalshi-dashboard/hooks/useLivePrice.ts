"use client";

import { useMarketsStore } from "@/store/marketsStore";
import { useMemo } from "react";

/** Merges Zustand WS overlay for a ticker with optional REST market snapshot. */
export function useLivePrice(ticker: string | null) {
  const snap = useMarketsStore((s) =>
    ticker ? s.marketsByTicker[ticker] : undefined
  );

  return useMemo(() => snap ?? null, [snap]);
}
