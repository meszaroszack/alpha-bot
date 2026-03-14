import { pgTable, text, integer, real, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { sql } from "drizzle-orm";

// ─── Signals ─────────────────────────────────────────────────────────────────

export const signals = pgTable("signals", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  matchTitle: text("match_title").notNull(),
  ticker: text("ticker").notNull(),
  marketTitle: text("market_title").notNull(),
  favoriteProb: real("favorite_prob").notNull(),
  drawPrice: real("draw_price"),      // NO price in cents
  yesPrice: real("yes_price"),        // YES price in cents
  minuteEstimate: integer("minute_estimate"),
  bloatScore: integer("bloat_score").notNull(),
  // "active" | "auto_traded" | "manually_traded" | "skipped" | "error"
  status: text("status").notNull().default("active"),
  // Sides actually bet: "no" | "yes" | "both"
  betSide: text("bet_side"),
  // Amount bet in dollars
  betAmount: real("bet_amount"),
  // Kalshi order ID(s) (JSON array string)
  orderIds: text("order_ids"),
  // Outcome tracking
  outcome: text("outcome"), // "won" | "lost" | "push"
  profit: real("profit"),
  // Auto vs manual
  isAuto: boolean("is_auto").notNull().default(false),
  // Error message if placement failed
  errorMsg: text("error_msg"),
  detectedAt: timestamp("detected_at").notNull().defaultNow(),
  tradedAt: timestamp("traded_at"),
});

export const insertSignalSchema = createInsertSchema(signals).omit({ id: true, detectedAt: true });
export type InsertSignal = z.infer<typeof insertSignalSchema>;
export type Signal = typeof signals.$inferSelect;

// ─── Settings ─────────────────────────────────────────────────────────────────

export const settings = pgTable("settings", {
  id: text("id").primaryKey().default("singleton"),
  // Detection thresholds
  minMinute: integer("min_minute").notNull().default(65),
  maxFavoriteProb: real("max_favorite_prob").notNull().default(0.78),
  minFavoriteProb: real("min_favorite_prob").notNull().default(0.60),
  // Scanning
  scanEnabled: boolean("scan_enabled").notNull().default(true),
  scanIntervalSec: integer("scan_interval_sec").notNull().default(60),
  // Bot
  botEnabled: boolean("bot_enabled").notNull().default(false),
  // "no_only" | "yes_only" | "both"
  betMode: text("bet_mode").notNull().default("no_only"),
  betAmountDollars: real("bet_amount_dollars").notNull().default(2.00),
  // Min bloat score to auto-trade (0-100)
  minBloatScore: integer("min_bloat_score").notNull().default(40),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertSettingsSchema = createInsertSchema(settings).omit({ id: true, updatedAt: true });
export type InsertSettings = z.infer<typeof insertSettingsSchema>;
export type Settings = typeof settings.$inferSelect;
