# Kalshi Markets Research Dashboard

Read-only research UI for [Kalshi](https://kalshi.com) prediction markets: market overview, category heatmap, virtualized market table, movers, a TradingView-style market detail panel (Lightweight Charts candlesticks, order book, trades, term-structure series view, and a screener with CSV export).

## Stack

- Next.js 14 (App Router), TypeScript (strict), Tailwind CSS, Radix-based UI primitives
- TanStack Query v5, Zustand
- [Lightweight Charts](https://github.com/tradingview/lightweight-charts) v4 for OHLC + volume
- Native `WebSocket` for public `ticker` / `trade` streams (optional; falls back to REST polling)

## Setup

```bash
npm install
cp .env.local.example .env.local   # optional
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — you are redirected to `/dashboard`.

## Kalshi API key (optional)

REST market data used here is **public** (no key required).

If you want API keys for other integrations (or a future **server-side** WebSocket bridge for private channels such as `orderbook_delta`), create keys in [Kalshi → Settings → API](https://kalshi.com/settings/api).

This app’s default **browser** WebSocket connects to **public** channels only (no signing). Order book updates use **REST polling** every 5 seconds unless you add your own signed proxy.

## Environment

See `.env.local.example`. Common options:

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_KALSHI_BASE_URL` | REST base URL (default: production trade API v2) |
| `NEXT_PUBLIC_KALSHI_WS_URL` | WebSocket URL for public streams |
| `NEXT_PUBLIC_KALSHI_DISABLE_WS` | Set to `true` to disable WebSocket entirely |
| `NEXT_PUBLIC_DEBUG_API` | Verbose dev logging for REST |

## Views

| Route | Description |
|-------|-------------|
| `/dashboard` | KPIs, category heatmap, sortable virtualized market table, movers |
| `/dashboard/[category]` | Same overview with category filter from the URL |
| `/dashboard/series/[seriesTicker]` | Series metadata, term-structure line chart (YES vs close), expandable events/markets |
| `/dashboard/screener` | Filters (category, YES bid range, volume, OI, spread, expiry) + CSV export |

Click a market row to open the **detail drawer** (order book, trades, rules, Kalshi link). Use the expand control for full-screen detail.

## Rate limiting

All HTTP calls go through a small queue (`lib/kalshi/throttle.ts`) to stay near the documented **~20 reads/s** public tier. `429` responses are retried with backoff (capped).

## Scripts

- `npm run dev` — development server  
- `npm run build` — production build  
- `npm run start` — run production build  
- `npm run lint` — ESLint  

## License

MIT (project code). Kalshi and Lightweight Charts are subject to their respective terms.
