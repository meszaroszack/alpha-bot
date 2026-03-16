# Kalshi BTC Alpha Trading Bot

Full-stack trading bot interface for the [Kalshi API](https://docs.kalshi.com/). The backend holds API secrets and proxies authenticated requests so the browser never sees your private key.

**Repo:** [github.com/meszaroszack/alpha-bot](https://github.com/meszaroszack/alpha-bot)

---

## Project structure

| Folder      | Stack |
|------------|--------|
| `/frontend` | Vite, React, Tailwind, lucide-react |
| `/backend`  | Node.js, Express (Kalshi auth + order proxy) |

---

## Local development

### 1. Install dependencies

From the project root:

```bash
npm run install:all
```

Or step by step: `npm install`, then `cd backend && npm install`, then `cd ../frontend && npm install`.

### 2. Configure backend (optional for local)

For local runs, copy `backend/.env.example` to `backend/.env` and set:

- **`KALSHI_API_KEY`** — Your Kalshi API Key ID (or enter it in the UI).
- **`KALSHI_API_SECRET`** — Your Kalshi **private key** (full PEM from your `.key` file). Never commit this.

### 3. Run the app

```bash
npm run dev
```

- Backend: http://localhost:3001  
- Frontend: http://localhost:5173 (Vite proxies `/api` to the backend)

Open http://localhost:5173, enter your **Kalshi API Key** (Key ID), choose **Demo** or **Live**, and click **Connect**.

---

## Deploy to Railway

Single-service deploy: one app serves both the API and the built frontend.

### 1. Create a Railway project

1. Go to [railway.app](https://railway.app) and sign in.
2. **New Project** → **Deploy from GitHub repo**.
3. Connect GitHub and select **meszaroszack/alpha-bot** (or your fork). Railway will clone the repo.

### 2. Configure build and start

In the Railway service **Settings** (or **Variables**):

- **Root Directory:** leave blank (repo root).
- **Build Command:**  
  ```bash
  npm run build
  ```
  This installs all dependencies, builds the frontend, and copies `frontend/dist` to `backend/public`.

- **Start Command:**  
  ```bash
  npm run start
  ```
  This runs `cd backend && node server.js` (serves API + static frontend).

- **Watch Paths:** leave default so pushes to the repo trigger deploys.

### 3. Set environment variables

In the same service, open **Variables** and add:

| Variable | Required | Description |
|----------|----------|-------------|
| `KALSHI_API_SECRET` | **Yes** | Your Kalshi **private key** (full PEM string from the `.key` file). Create at [demo.kalshi.com](https://demo.kalshi.com) or [kalshi.com](https://kalshi.com) → Account → API Keys. |
| `KALSHI_API_KEY` | No | Your Kalshi API Key ID. If not set, users must enter it in the UI. |
| `JWT_SECRET` | Recommended | A random string for signing session tokens (e.g. `openssl rand -hex 32`). If unset, a default is used. |

Do **not** commit `.env` or put secrets in the repo.

### 4. Deploy

- **Deploy** (or push to the connected branch). Railway runs `npm run build` then `npm run start`.
- Open the generated URL (e.g. `https://your-app.up.railway.app`). You should see the bot UI; same origin so `/api` works without CORS.

### 5. Demo vs Live

- Use **Demo** in the UI + demo API keys (from [demo.kalshi.com](https://demo.kalshi.com)) for testing.
- Use **Live** + production keys for real trading. Same env vars; the app chooses the Kalshi host from the environment dropdown.

---

## Backend API

- **POST `/api/kalshi/auth`** — Body: `{ "apiKey", "environment" }`. Backend signs a balance check with `KALSHI_API_SECRET` and returns a session token.
- **POST `/api/kalshi/order`** — Body: `{ "token", "action", "market", "count", "environment" }`. Places the order with Kalshi using the session token and stored secret.

---

## Scripts reference

| Command | Description |
|--------|-------------|
| `npm run dev` | Run backend + frontend locally (concurrently). |
| `npm run build` | Install all deps, build frontend, copy to `backend/public`. |
| `npm run start` | Run backend only (serves API + static if `backend/public` exists). |
| `npm run install:all` | Install root, backend, and frontend dependencies. |
