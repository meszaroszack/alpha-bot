import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage, setCreds, getCreds, clearCreds, hasCreds } from "./storage";
import { scanForBloat, placeBloatBet, testCredentials, getBalance, type BetMode } from "./kalshi";

// ─── Background scanner state ─────────────────────────────────────────────────

let scanTimer: ReturnType<typeof setInterval> | null = null;
let lastScanTime: Date | null = null;
let lastScanCount = 0;
let scanning = false;

async function runScan() {
  if (scanning) return;
  scanning = true;
  try {
    const settings = await storage.getSettings();
    lastScanTime = new Date();

    const candidates = await scanForBloat({
      minFavoriteProb: settings.minFavoriteProb,
      maxFavoriteProb: settings.maxFavoriteProb,
      minMinute: settings.minMinute,
    });
    lastScanCount = candidates.length;

    // Dedup against active signals
    const existing = await storage.getSignals();
    const activeTickers = new Set(
      existing.filter(s => s.status === "active" || s.status === "auto_traded").map(s => s.ticker)
    );

    for (const c of candidates) {
      if (activeTickers.has(c.ticker)) continue;

      // Auto-trade if bot is enabled and signal meets threshold
      const shouldAutoTrade =
        settings.botEnabled &&
        hasCreds() &&
        c.bloatScore >= settings.minBloatScore;

      if (shouldAutoTrade) {
        const creds = getCreds()!;
        try {
          const orders = await placeBloatBet(
            creds.apiKeyId,
            creds.privateKeyPem,
            c.ticker,
            settings.betMode as BetMode,
            settings.betAmountDollars,
            { drawPrice: c.drawPrice, yesPrice: c.yesPrice }
          );

          const orderIds = JSON.stringify(orders.map(o => o.orderId));
          const betSide = settings.betMode === "no_only" ? "no" : settings.betMode === "yes_only" ? "yes" : "both";
          const totalCost = orders.reduce((s, o) => s + o.cost, 0);

          await storage.createSignal({
            matchTitle: c.matchTitle,
            ticker: c.ticker,
            marketTitle: c.marketTitle,
            favoriteProb: c.favoriteProb,
            drawPrice: c.drawPrice ?? null,
            yesPrice: c.yesPrice ?? null,
            minuteEstimate: c.minuteEstimate ?? null,
            bloatScore: c.bloatScore,
            status: "auto_traded",
            betSide,
            betAmount: totalCost,
            orderIds,
            isAuto: true,
            tradedAt: new Date(),
          });

          console.log(`[BOT] Auto-traded ${c.ticker} — ${betSide} $${totalCost.toFixed(2)}`);
        } catch (err) {
          // Log the signal as error
          await storage.createSignal({
            matchTitle: c.matchTitle,
            ticker: c.ticker,
            marketTitle: c.marketTitle,
            favoriteProb: c.favoriteProb,
            drawPrice: c.drawPrice ?? null,
            yesPrice: c.yesPrice ?? null,
            minuteEstimate: c.minuteEstimate ?? null,
            bloatScore: c.bloatScore,
            status: "error",
            isAuto: true,
            errorMsg: err instanceof Error ? err.message : String(err),
          });
          console.error(`[BOT] Trade failed for ${c.ticker}:`, err);
        }
      } else {
        // Just log the signal for manual review
        await storage.createSignal({
          matchTitle: c.matchTitle,
          ticker: c.ticker,
          marketTitle: c.marketTitle,
          favoriteProb: c.favoriteProb,
          drawPrice: c.drawPrice ?? null,
          yesPrice: c.yesPrice ?? null,
          minuteEstimate: c.minuteEstimate ?? null,
          bloatScore: c.bloatScore,
          status: "active",
          isAuto: false,
        });
      }
    }
  } catch (e) {
    console.error("Scan error:", e);
  } finally {
    scanning = false;
  }
}

function startScanner(intervalSec: number) {
  if (scanTimer) clearInterval(scanTimer);
  scanTimer = setInterval(runScan, intervalSec * 1000);
  runScan();
}

function stopScanner() {
  if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  const settings = await storage.getSettings();
  if (settings.scanEnabled) startScanner(settings.scanIntervalSec);

  // ── Credentials ──────────────────────────────────────────────────────────────

  // POST /api/credentials — set API key (in-memory only)
  app.post("/api/credentials", async (req, res) => {
    const { apiKeyId, privateKeyPem } = req.body;
    if (!apiKeyId || !privateKeyPem) {
      return res.status(400).json({ error: "apiKeyId and privateKeyPem are required" });
    }
    // Validate immediately
    const result = await testCredentials(apiKeyId, privateKeyPem);
    if (!result.valid) {
      return res.status(401).json({ error: result.error ?? "Invalid credentials" });
    }
    setCreds({ apiKeyId, privateKeyPem });
    res.json({ ok: true, balance: result.balance, message: "Credentials verified and stored in memory" });
  });

  // DELETE /api/credentials — clear creds
  app.delete("/api/credentials", (_req, res) => {
    clearCreds();
    res.json({ ok: true });
  });

  // GET /api/credentials/status — are creds loaded?
  app.get("/api/credentials/status", (_req, res) => {
    res.json({ connected: hasCreds() });
  });

  // GET /api/balance
  app.get("/api/balance", async (_req, res) => {
    const creds = getCreds();
    if (!creds) return res.status(401).json({ error: "No credentials loaded" });
    try {
      const balance = await getBalance(creds.apiKeyId, creds.privateKeyPem);
      res.json({ balance });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  // ── Signals ───────────────────────────────────────────────────────────────────

  app.get("/api/signals", async (_req, res) => {
    res.json(await storage.getSignals());
  });

  // PATCH /api/signals/:id — manual trade / outcome log
  app.patch("/api/signals/:id", async (req, res) => {
    const updated = await storage.updateSignal(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  });

  // POST /api/signals/:id/trade — manually place bet on a signal
  app.post("/api/signals/:id/trade", async (req, res) => {
    const creds = getCreds();
    if (!creds) return res.status(401).json({ error: "No credentials loaded" });

    const signal = await storage.getSignal(req.params.id);
    if (!signal) return res.status(404).json({ error: "Signal not found" });

    const settings = await storage.getSettings();
    const betMode = (req.body.betMode ?? settings.betMode) as BetMode;
    const betAmount = req.body.betAmount ?? settings.betAmountDollars;

    try {
      const orders = await placeBloatBet(
        creds.apiKeyId,
        creds.privateKeyPem,
        signal.ticker,
        betMode,
        betAmount,
        { drawPrice: signal.drawPrice ?? undefined, yesPrice: signal.yesPrice ?? undefined }
      );
      const betSide = betMode === "no_only" ? "no" : betMode === "yes_only" ? "yes" : "both";
      const totalCost = orders.reduce((s, o) => s + o.cost, 0);

      const updated = await storage.updateSignal(signal.id, {
        status: "manually_traded",
        betSide,
        betAmount: totalCost,
        orderIds: JSON.stringify(orders.map(o => o.orderId)),
        tradedAt: new Date(),
      });
      res.json({ ok: true, orders, signal: updated });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.delete("/api/signals", async (_req, res) => {
    await storage.clearSignals();
    res.json({ ok: true });
  });

  // ── Settings ──────────────────────────────────────────────────────────────────

  app.get("/api/settings", async (_req, res) => {
    res.json(await storage.getSettings());
  });

  app.patch("/api/settings", async (req, res) => {
    const updated = await storage.updateSettings(req.body);
    if (updated.scanEnabled) startScanner(updated.scanIntervalSec);
    else stopScanner();
    res.json(updated);
  });

  // ── Scanner ───────────────────────────────────────────────────────────────────

  app.post("/api/scan", async (_req, res) => {
    await runScan();
    const signals = await storage.getSignals();
    res.json({ ok: true, found: lastScanCount, scannedAt: lastScanTime, signals });
  });

  app.get("/api/status", async (_req, res) => {
    const settings = await storage.getSettings();
    res.json({
      scanEnabled: settings.scanEnabled,
      botEnabled: settings.botEnabled,
      credentialsLoaded: hasCreds(),
      scanning,
      lastScanTime,
      lastScanCount,
      scanInterval: settings.scanIntervalSec,
    });
  });

  // ── Stats ─────────────────────────────────────────────────────────────────────

  app.get("/api/stats", async (_req, res) => {
    const signals = await storage.getSignals();
    const traded = signals.filter(s => ["auto_traded", "manually_traded"].includes(s.status) && s.outcome);
    const wins = traded.filter(s => s.outcome === "won");
    const losses = traded.filter(s => s.outcome === "lost");
    const totalProfit = traded.reduce((sum, s) => sum + (s.profit ?? 0), 0);
    const totalBet = signals.filter(s => s.betAmount).reduce((sum, s) => sum + (s.betAmount ?? 0), 0);
    res.json({
      totalSignals: signals.length,
      activeSignals: signals.filter(s => s.status === "active").length,
      autoTraded: signals.filter(s => s.status === "auto_traded").length,
      manuallyTraded: signals.filter(s => s.status === "manually_traded").length,
      wins: wins.length,
      losses: losses.length,
      winRate: traded.length > 0 ? wins.length / traded.length : null,
      totalProfit,
      totalBet,
      roi: totalBet > 0 ? totalProfit / totalBet : null,
    });
  });

  // ── Test signal (dev only) ────────────────────────────────────────────────────
  app.post("/api/signals/test", async (_req, res) => {
    const demo = await storage.createSignal({
      matchTitle: "KXSOC-CHELSEA-ARSENAL-TEST",
      ticker: `KXSOC-TEST-${Date.now()}`,
      marketTitle: "Will Chelsea win vs Arsenal? (74th min, 0-0)",
      favoriteProb: 0.71,
      drawPrice: 29,
      yesPrice: 71,
      minuteEstimate: 74,
      bloatScore: 72,
      status: "active",
      isAuto: false,
    });
    res.json(demo);
  });

  return httpServer;
}
