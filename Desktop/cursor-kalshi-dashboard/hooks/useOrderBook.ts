"use client";

import { fetchOrderBook } from "@/lib/kalshi/api";
import { useQuery } from "@tanstack/react-query";

export function useOrderBook(ticker: string | null) {
  return useQuery({
    queryKey: ["orderbook", ticker],
    queryFn: async () => {
      if (!ticker) throw new Error("no ticker");
      const res = await fetchOrderBook(ticker);
      if (!res.ok) throw res.error;
      return res.data;
    },
    enabled: !!ticker,
    staleTime: 5000,
    refetchInterval: 5000,
  });
}
