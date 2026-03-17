/**
 * supabase.js — Supabase write-only client for alpha-bot.
 *
 * alpha-bot is a trusted server-side process. We use the service role key
 * so RLS is bypassed and we can write on behalf of BOT_USER_ID without
 * needing a JWT cookie or auth session.
 *
 * All helpers are fire-and-forget: they log failures locally but NEVER
 * throw — a Supabase write error must never crash the trading loop.
 *
 * Tables written to (defined in compd-trader/shared/schema.ts):
 *   bot_runs        — one row per trading session
 *   trades          — one row per placed order, updated on settle
 *   signals         — one row per indicator evaluation
 *   bot_logs        — granular event stream (price ticks, errors, reconcile)
 */

import { createClient } from '@supabase/supabase-js';

// ── Config ─────────────────────────────────────────────────────────────────
const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const BOT_USER_ID          = process.env.BOT_USER_ID;
// Trader Retro model ID seeded in migration 00002
export const BOT_MODEL_ID  = process.env.BOT_RUN_MODEL_ID
  || 'a0000000-0000-4000-8000-000000000001';

// ── Client (lazy — only initialised if env vars are present) ───────────────
let _supabase = null;

function getClient() {
  if (_supabase) return _supabase;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.warn('[Supabase] SUPABASE_URL or SUPABASE_SERVICE_KEY not set — persistence disabled');
    return null;
  }
  // Validate URL format before passing to createClient — a malformed URL throws
  // synchronously inside the Supabase constructor and would crash the process.
  try {
    new URL(SUPABASE_URL); // throws if malformed
  } catch {
    console.warn(`[Supabase] SUPABASE_URL is malformed: "${SUPABASE_URL}" — persistence disabled. Make sure it starts with https://.`);
    return null;
  }
  try {
    _supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    console.log('[Supabase] Client initialised');
  } catch (e) {
    console.warn('[Supabase] createClient threw — persistence disabled:', e.message);
    return null;
  }
  return _supabase;
}

// ── Internal safe-insert helper ────────────────────────────────────────────
async function safeInsert(table, row) {
  const sb = getClient();
  if (!sb) return null;
  try {
    const { data, error } = await sb.from(table).insert(row).select().single();
    if (error) { console.warn(`[Supabase] insert ${table} failed:`, error.message); return null; }
    return data;
  } catch (e) {
    console.warn(`[Supabase] insert ${table} threw:`, e.message);
    return null;
  }
}

async function safeUpdate(table, id, patch) {
  const sb = getClient();
  if (!sb) return null;
  try {
    const { data, error } = await sb.from(table).update(patch).eq('id', id).select().single();
    if (error) { console.warn(`[Supabase] update ${table} failed:`, error.message); return null; }
    return data;
  } catch (e) {
    console.warn(`[Supabase] update ${table} threw:`, e.message);
    return null;
  }
}

// ── Bot run helpers ────────────────────────────────────────────────────────

/**
 * Open a new bot_run row. Returns the run's UUID (store this in botEngine
 * state so subsequent inserts can reference it).
 */
export async function openBotRun(configSnapshot = {}) {
  try {
    if (!BOT_USER_ID) {
      console.warn('[Supabase] BOT_USER_ID not set — bot_run not opened (trading continues without Supabase)');
      return null;
    }
    const row = {
      user_id:         BOT_USER_ID,
      model_id:        BOT_MODEL_ID,
      status:          'running',
      started_at:      new Date().toISOString(),
      config_snapshot: configSnapshot,
      start_balance:   null,
    };
    const data = await safeInsert('bot_runs', row);
    if (data?.id) console.log(`[Supabase] bot_run opened: ${data.id}`);
    return data?.id ?? null;
  } catch (e) {
    console.warn('[Supabase] openBotRun threw (non-fatal) — trading continues:', e.message);
    return null;
  }
}

/**
 * Close the current bot_run (status = stopped | error).
 * Stamps end time, final balance, total P&L, fees, and trade count.
 */
export async function closeBotRun(runId, { status = 'stopped', finalBalance, totalPnl, totalFees, tradeCount } = {}) {
  if (!runId) return;
  await safeUpdate('bot_runs', runId, {
    status,
    ended_at:     new Date().toISOString(),
    end_balance:  finalBalance ?? null,
    total_pnl:    totalPnl ?? null,
    total_fees:   totalFees ?? null,
    trade_count:  tradeCount ?? null,
  });
  console.log(`[Supabase] bot_run closed: ${runId} (${status})`);
}

/**
 * Stamp start_balance on the run (called on first successful balance fetch).
 */
export async function setRunStartBalance(runId, balance) {
  if (!runId) return;
  await safeUpdate('bot_runs', runId, { start_balance: balance });
}

// ── Signal helper ──────────────────────────────────────────────────────────

/**
 * Record a signal evaluation (every tick, whether traded or not).
 * Returns the signal row UUID (unused for now but useful for linking trades).
 */
export async function insertSignal({
  runId, direction, confidence, btcPrice,
  marketTicker, marketYesPrice, rsi, macd, macdSignal, reasoning, traded,
}) {
  if (!BOT_USER_ID) return null;
  return await safeInsert('signals', {
    user_id:          BOT_USER_ID,
    model_id:         BOT_MODEL_ID,
    run_id:           runId ?? null,
    direction:        direction ?? 'neutral',
    confidence:       confidence ?? 0,
    btc_price:        btcPrice ?? 0,
    market_ticker:    marketTicker ?? null,
    market_yes_price: marketYesPrice ?? null,
    rsi:              rsi ?? null,
    macd:             macd ?? null,
    macd_signal:      macdSignal ?? null,
    reasoning:        reasoning ?? null,
    traded:           traded ?? false,
  });
}

// ── Trade helpers ──────────────────────────────────────────────────────────

/**
 * Record a newly placed order. Returns the trade row UUID — store it so you
 * can call updateTrade() when the position settles.
 */
export async function insertTrade({
  runId, orderId, ticker, side, action, count,
  pricePerContract, totalCost, feeDollars,
  signalReason, btcPriceAtTrade, marketTitle,
}) {
  if (!BOT_USER_ID) return null;
  const row = {
    user_id:            BOT_USER_ID,
    model_id:           BOT_MODEL_ID,
    run_id:             runId ?? null,
    order_id:           orderId ?? null,
    ticker:             ticker,
    side:               side,
    action:             action,
    count:              count,
    price_per_contract: pricePerContract,
    total_cost:         totalCost,
    fee_dollars:        feeDollars ?? null,
    status:             'open',
    signal_reason:      signalReason ?? null,
    btc_price_at_trade: btcPriceAtTrade ?? null,
    market_title:       marketTitle ?? null,
  };
  const data = await safeInsert('trades', row);
  return data?.id ?? null;
}

/**
 * Update a trade after settlement/exit.
 * pnl = net P&L in dollars AFTER fees (what you actually made or lost).
 * reconciledPnl = the number pulled directly from Kalshi's settled positions API.
 */
export async function updateTrade(supabaseTradeId, {
  status, pnl, reconciledPnl, feeDollarsExit, signalReason, resolvedAt,
}) {
  if (!supabaseTradeId) return null;
  return await safeUpdate('trades', supabaseTradeId, {
    status:            status ?? 'settled',
    pnl:               pnl ?? null,
    reconciled_pnl:    reconciledPnl ?? null,
    fee_dollars_exit:  feeDollarsExit ?? null,
    signal_reason:     signalReason ?? null,
    resolved_at:       resolvedAt ?? new Date().toISOString(),
  });
}

// ── Bot config upsert ──────────────────────────────────────────────────────

/**
 * Persist bot config changes to bot_configs so compd-trader can display them.
 * Uses upsert on (user_id, model_id).
 */
export async function upsertBotConfig(config = {}) {
  const sb = getClient();
  if (!sb || !BOT_USER_ID) return;
  try {
    const { error } = await sb.from('bot_configs').upsert({
      user_id:      BOT_USER_ID,
      model_id:     BOT_MODEL_ID,
      enabled:      config.botEnabled ?? false,
      risk_percent: config.riskPct ?? 25,
      strategy:     config.strategy ?? 'algo',
      min_confidence: config.minConfidence ?? 65,
      updated_at:   new Date().toISOString(),
    }, { onConflict: 'user_id,model_id' });
    if (error) console.warn('[Supabase] upsertBotConfig failed:', error.message);
  } catch (e) {
    console.warn('[Supabase] upsertBotConfig threw:', e.message);
  }
}

// ── Bot log helper ─────────────────────────────────────────────────────────

/**
 * Write a granular log event to bot_logs.
 * level: 'info' | 'warn' | 'error' | 'trade' | 'signal' | 'reconcile'
 * This is the "every thought" layer — too noisy for trades/signals tables.
 */
export async function insertLog(level, message, payload = {}, runId = null) {
  // Don't await — true fire-and-forget, never block the trading loop
  safeInsert('bot_logs', {
    user_id:   BOT_USER_ID ?? null,
    model_id:  BOT_MODEL_ID,
    run_id:    runId ?? null,
    level,
    message,
    payload:   Object.keys(payload).length > 0 ? payload : null,
    created_at: new Date().toISOString(),
  }).catch(() => {}); // swallow — this is truly best-effort
}

// ── Health check ───────────────────────────────────────────────────────────
export function isSupabaseEnabled() {
  return !!(SUPABASE_URL && SUPABASE_SERVICE_KEY && BOT_USER_ID);
}
