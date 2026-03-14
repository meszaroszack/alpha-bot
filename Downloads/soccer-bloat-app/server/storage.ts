import { type Signal, type InsertSignal, type Settings, type InsertSettings } from "@shared/schema";
import { randomUUID } from "crypto";

// ─── Credentials (in-memory only, never persisted) ────────────────────────────

interface KalshiCreds {
  apiKeyId: string;
  privateKeyPem: string;
}

let _creds: KalshiCreds | null = null;

export function setCreds(creds: KalshiCreds) { _creds = creds; }
export function getCreds(): KalshiCreds | null { return _creds; }
export function clearCreds() { _creds = null; }
export function hasCreds(): boolean { return _creds !== null; }

// ─── Storage interface ────────────────────────────────────────────────────────

export interface IStorage {
  getSignals(): Promise<Signal[]>;
  getSignal(id: string): Promise<Signal | undefined>;
  createSignal(signal: InsertSignal): Promise<Signal>;
  updateSignal(id: string, updates: Partial<Signal>): Promise<Signal | undefined>;
  clearSignals(): Promise<void>;
  getSettings(): Promise<Settings>;
  updateSettings(s: Partial<InsertSettings>): Promise<Settings>;
}

export class MemStorage implements IStorage {
  private signals: Map<string, Signal> = new Map();
  private settingsData: Settings = {
    id: "singleton",
    minMinute: 65,
    maxFavoriteProb: 0.78,
    minFavoriteProb: 0.60,
    scanEnabled: true,
    scanIntervalSec: 60,
    botEnabled: false,
    betMode: "no_only",
    betAmountDollars: 2.00,
    minBloatScore: 40,
    updatedAt: new Date(),
  };

  async getSignals(): Promise<Signal[]> {
    return Array.from(this.signals.values()).sort(
      (a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime()
    );
  }

  async getSignal(id: string): Promise<Signal | undefined> {
    return this.signals.get(id);
  }

  async createSignal(signal: InsertSignal): Promise<Signal> {
    const id = randomUUID();
    const full: Signal = {
      id,
      detectedAt: new Date(),
      matchTitle: signal.matchTitle,
      ticker: signal.ticker,
      marketTitle: signal.marketTitle,
      favoriteProb: signal.favoriteProb,
      drawPrice: signal.drawPrice ?? null,
      yesPrice: signal.yesPrice ?? null,
      minuteEstimate: signal.minuteEstimate ?? null,
      bloatScore: signal.bloatScore,
      status: signal.status ?? "active",
      betSide: signal.betSide ?? null,
      betAmount: signal.betAmount ?? null,
      orderIds: signal.orderIds ?? null,
      outcome: signal.outcome ?? null,
      profit: signal.profit ?? null,
      isAuto: signal.isAuto ?? false,
      errorMsg: signal.errorMsg ?? null,
      tradedAt: signal.tradedAt ?? null,
    };
    this.signals.set(id, full);
    return full;
  }

  async updateSignal(id: string, updates: Partial<Signal>): Promise<Signal | undefined> {
    const s = this.signals.get(id);
    if (!s) return undefined;
    const updated = { ...s, ...updates };
    this.signals.set(id, updated);
    return updated;
  }

  async clearSignals(): Promise<void> {
    this.signals.clear();
  }

  async getSettings(): Promise<Settings> {
    return this.settingsData;
  }

  async updateSettings(s: Partial<InsertSettings>): Promise<Settings> {
    this.settingsData = { ...this.settingsData, ...s, updatedAt: new Date() };
    return this.settingsData;
  }
}

export const storage = new MemStorage();
