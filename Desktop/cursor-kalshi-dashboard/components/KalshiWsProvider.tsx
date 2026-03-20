"use client";

import { connectKalshiWsPublic, disconnectKalshiWs } from "@/lib/kalshi/websocket";
import { useEffect } from "react";

export function KalshiWsProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_KALSHI_DISABLE_WS === "true") return;
    connectKalshiWsPublic();
    return () => disconnectKalshiWs();
  }, []);

  return <>{children}</>;
}
