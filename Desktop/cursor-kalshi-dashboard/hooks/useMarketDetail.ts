"use client";

import { fetchEvent, fetchMarket } from "@/lib/kalshi/api";
import { useQuery } from "@tanstack/react-query";

export function useMarketDetail(ticker: string | null) {
  const marketQ = useQuery({
    queryKey: ["market", ticker],
    queryFn: async () => {
      if (!ticker) throw new Error("no ticker");
      const res = await fetchMarket(ticker);
      if (!res.ok) throw res.error;
      return res.data.market;
    },
    enabled: !!ticker,
    staleTime: 15_000,
  });

  const eventTicker = marketQ.data?.event_ticker;

  const eventQ = useQuery({
    queryKey: ["event", eventTicker],
    queryFn: async () => {
      if (!eventTicker) throw new Error("no event");
      const res = await fetchEvent(eventTicker);
      if (!res.ok) throw res.error;
      return res.data;
    },
    enabled: !!eventTicker,
    staleTime: 60_000,
  });

  return { marketQ, eventQ };
}
