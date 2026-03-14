# Bloat Scout — Kalshi Soccer Auto-Trader

Detects **favorite bloat** in late-game tied soccer matches and auto-trades on Kalshi.

**Concept:** When a match hits 65'+ still tied, prediction markets often over-price the pre-game favorite (60–78%). The draw/upset (NO) is undervalued. This app scans Kalshi soccer markets, scores each signal, and places bets automatically.

## Bet Modes

| Mode | Description |
|------|-------------|
| `NO only` | Bet draw or upset wins — classic bloat play, best hit rate |
| `YES only` | Bet the underdog scores a late winner — higher payout |
| `Both` | Split 50/50 between NO and YES — hedge |

## Deploy to Railway

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "Bloat Scout v2 — Kalshi auto-trader"
git remote add origin https://github.com/YOUR_USERNAME/soccer-bloat-app.git
git push -u origin main
```

### 2. Deploy on Railway

1. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub repo
2. Select this repo
3. Railway will auto-detect Node.js via Nixpacks and run `npm run build && npm start`
4. No environment variables required — API keys are stored in-memory via the UI

### 3. Use the App

1. Open your Railway URL
2. Paste your Kalshi API Key ID + Private Key (.pem) — stored in memory only, never written to disk
3. Enable **Bot Auto-Trade**
4. Choose bet mode (NO / YES / Both)
5. Set bet amount and min bloat score threshold

## Local Development

```bash
npm install
npm run dev
```

Server runs on `http://localhost:5000`.

## Stack

- **Backend:** Express + TypeScript
- **Frontend:** React + Vite + Tailwind + shadcn/ui
- **Auth:** Kalshi RSA-PSS (SHA256) — keys in-memory only
- **Build:** `npm run build` → `dist/index.cjs` + `dist/public/`
