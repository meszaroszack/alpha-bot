/**
 * Browser WebSocket manager for Kalshi public channels (`ticker`, `trade`).
 * Private channels (e.g. `orderbook_delta`) require auth headers — use REST polling.
 */

import { emitWsData } from "@/lib/kalshi/ws-bus";
import { useMarketsStore } from "@/store/marketsStore";

function wsUrl(): string {
  const base =
    process.env.NEXT_PUBLIC_KALSHI_WS_URL ??
    "wss://api.elections.kalshi.com/trade-api/ws/v2";
  if (base.startsWith("wss://") || base.startsWith("ws://")) return base;
  return "wss://api.elections.kalshi.com/trade-api/ws/v2";
}

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
let messageId = 1;

function backoffMs(): number {
  return Math.min(30000, 1000 * Math.pow(2, reconnectAttempt));
}

function parseMsg(raw: string): {
  type?: string;
  msg?: Record<string, unknown>;
} {
  try {
    return JSON.parse(raw) as { type?: string; msg?: Record<string, unknown> };
  } catch {
    return {};
  }
}

export function disconnectKalshiWs(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectAttempt = 0;
  if (socket) {
    socket.onclose = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.close();
    socket = null;
  }
}

function handleMessage(data: string) {
  const j = parseMsg(data);
  emitWsData(j);
  const t = j.type;
  const msg = j.msg;
  if (!msg) return;
  if (t === "ticker") {
    useMarketsStore.getState().applyTickerWs(msg);
  }
  if (t === "trade") {
    useMarketsStore.getState().applyTradeWs(msg);
  }
}

export function connectKalshiWsPublic(): void {
  if (typeof window === "undefined") return;
  if (socket && socket.readyState === WebSocket.OPEN) return;

  disconnectKalshiWs();

  const ws = new WebSocket(wsUrl());
  socket = ws;

  ws.onopen = () => {
    reconnectAttempt = 0;
    ws.send(
      JSON.stringify({
        id: messageId++,
        cmd: "subscribe",
        params: { channels: ["ticker"] },
      })
    );
  };

  ws.onmessage = (ev) => {
    if (typeof ev.data === "string") handleMessage(ev.data);
  };

  ws.onerror = () => {
    /* reconnect via onclose */
  };

  ws.onclose = () => {
    socket = null;
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      connectKalshiWsPublic();
    }, backoffMs());
  };
}

export function subscribeTradesForMarket(ticker: string): () => void {
  if (typeof window === "undefined") return () => {};
  const ws = socket;
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return () => {};
  }
  const id = messageId++;
  ws.send(
    JSON.stringify({
      id,
      cmd: "subscribe",
      params: {
        channels: ["trade"],
        market_tickers: [ticker],
      },
    })
  );
  return () => {
    /* Unsubscribe requires sid from server ack; noop for simplicity */
  };
}

export function isWebSocketMode(): boolean {
  return typeof WebSocket !== "undefined";
}
