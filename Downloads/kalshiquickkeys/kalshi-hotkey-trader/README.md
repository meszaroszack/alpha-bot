# Kalshi Manual Hotkey Scalper

This is a lightweight manual trading interface configured to trade 15-minute BTC markets on Kalshi instantly using your keyboard arrow keys.

## Features
- **Node.js Express Backend:** Serves the frontend securely, using Kalshi API Keys to completely bypass 2FA issues.
- **Frontend UI:** Single page, dark mode interface (Tailwind CSS) that loads your current active market automatically.
- **Hotkeys:** Pressing `Up Arrow` executes a `BUY`. Pressing `Down Arrow` executes a `SELL`. Parameters are pulled directly from the UI input fields.

## How to Deploy on Railway

1. **Upload to GitHub:**
   - Create a new repository on GitHub.
   - Push these files (`package.json`, `server.js`, `public/index.html`, `railway.toml`) to your repository. 

2. **Deploy on Railway:**
   - Go to [Railway.app](https://railway.app) and click **"New Project"**.
   - Select **"Deploy from GitHub repo"** and choose your new repository.

3. **Configure Environment Variables:**
   - On the Railway dashboard for your newly deployed service, go to the **Variables** tab.
   - Add the following environment variables:
     - `KALSHI_KEY_ID`: Your Kalshi API Key ID.
     - `KALSHI_PRIVATE_KEY`: Your Kalshi Private Key string (include the `-----BEGIN RSA PRIVATE KEY-----` wrapper).
     - `BTC_SERIES_TICKER`: (Optional) Defaults to `KXBTC15M`. 

4. **Access your App:**
   - Go to the **Settings** tab in Railway, scroll down to **Networking**, and click **Generate Domain**.
