"use client";

import { PriceBadge } from "@/components/common/PriceBadge";
import { Button } from "@/components/ui/button";
import { useCandlesticks } from "@/hooks/useCandlesticks";
import { useMarketDetail } from "@/hooks/useMarketDetail";
import { useOrderBook } from "@/hooks/useOrderBook";
import { useTrades } from "@/hooks/useTrades";
import { parseDollars, parseFp } from "@/lib/kalshi/parse";
import { subscribeTradesForMarket } from "@/lib/kalshi/websocket";
import { useUiStore } from "@/store/uiStore";
import { format, formatDistanceToNow } from "date-fns";
import { ExternalLink, Maximize2, Minimize2, X } from "lucide-react";
import { useEffect } from "react";
import { LiquidityHeatmap } from "./LiquidityHeatmap";
import { OrderBook } from "./OrderBook";
import { PriceChart } from "./PriceChart";
import { RecentTrades } from "./RecentTrades";
import { VolumeProfile } from "./VolumeProfile";

export function MarketDetailPanel() {
  const ticker = useUiStore((s) => s.detailTicker);
  const full = useUiStore((s) => s.detailFullScreen);
  const close = useUiStore((s) => s.closeDetail);
  const setFull = useUiStore((s) => s.setDetailFullScreen);
  const timeframe = useUiStore((s) => s.timeframe);

  const { marketQ, eventQ } = useMarketDetail(ticker);
  const market = marketQ.data;
  const seriesTicker = eventQ.data?.event.series_ticker;

  const candles = useCandlesticks(seriesTicker ?? null, ticker, timeframe);
  const ob = useOrderBook(ticker);
  const trades = useTrades(ticker);

  useEffect(() => {
    if (!ticker) return;
    return subscribeTradesForMarket(ticker);
  }, [ticker]);

  if (!ticker) return null;

  const yesAsk = parseDollars(market?.yes_ask_dollars);
  const yesBid = parseDollars(market?.yes_bid_dollars);
  const spread =
    Number.isFinite(yesAsk) && Number.isFinite(yesBid) ? yesAsk - yesBid : NaN;

  const last = parseDollars(market?.last_price_dollars);
  const prev = parseDollars(market?.previous_price_dollars);
  const deltaAbs =
    Number.isFinite(last) && Number.isFinite(prev) ? last - prev : NaN;
  const deltaPct =
    Number.isFinite(last) && Number.isFinite(prev) && prev !== 0
      ? ((last - prev) / prev) * 100
      : NaN;

  const closeTime = market?.close_time
    ? new Date(market.close_time)
    : undefined;

  const shell = full
    ? "fixed inset-0 z-50 overflow-auto bg-[#0A0A0F] p-4"
    : "fixed right-0 top-0 z-40 h-full w-full max-w-[720px] overflow-auto border-l border-[#1E1E2E] bg-[#0A0A0F] p-4 shadow-2xl lg:max-w-[55%]";

  return (
    <div className={shell}>
      <div className="mb-4 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs uppercase text-[#6B6B8A]">
            {eventQ.data?.event.title}
          </div>
          <h2 className="text-lg font-semibold leading-tight text-[#E8E8F0]">
            {market?.title}
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-md border border-[#1E1E2E] bg-[#12121A] px-2 py-0.5 text-[#6B6B8A]">
              {eventQ.data?.event.category}
            </span>
            <span className="rounded-md border border-[#1E1E2E] bg-[#12121A] px-2 py-0.5 text-[#6B6B8A]">
              {market?.status}
            </span>
            {closeTime && (
              <span className="text-[#6B6B8A]">
                Closes {format(closeTime, "MMM d, yyyy HH:mm")} (
                {formatDistanceToNow(closeTime, { addSuffix: true })})
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => setFull(!full)}
            aria-label="Toggle full screen"
          >
            {full ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={close}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-4">
        <div>
          <div className="text-xs text-[#6B6B8A]">YES probability</div>
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-4xl tabular-nums text-[#E8E8F0]">
              {(last * 100).toFixed(1)}¢
            </span>
            <PriceBadge cents={last * 100} />
          </div>
        </div>
        <div className="text-sm">
          <span
            className={
              deltaAbs >= 0 ? "text-[#2ED573]" : "text-[#FF4757]"
            }
          >
            {Number.isFinite(deltaAbs)
              ? `${deltaAbs >= 0 ? "▲" : "▼"} ${(Math.abs(deltaAbs) * 100).toFixed(1)}¢`
              : "—"}
          </span>
          {Number.isFinite(deltaPct) && (
            <span className="ml-2 text-[#6B6B8A]">
              ({deltaPct >= 0 ? "+" : ""}
              {deltaPct.toFixed(1)}%)
            </span>
          )}
        </div>
      </div>

      <div className="mb-4">
        <PriceChart data={candles.data} loading={candles.isLoading} />
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <OrderBook
          data={ob.data}
          loading={ob.isLoading}
          marketSpreadDollars={spread}
        />
        <RecentTrades trades={trades.trades} />
        <div className="space-y-3">
          <div className="rounded-lg border border-[#1E1E2E] bg-[#12121A] p-3 text-sm text-[#E8E8F0]">
            <div className="text-xs font-semibold uppercase text-[#6B6B8A]">
              Rules
            </div>
            <p className="mt-2 line-clamp-3 text-[#6B6B8A]">
              {market?.rules_primary}
            </p>
            <div className="mt-3 space-y-1 text-xs text-[#6B6B8A]">
              <div>
                OI: {parseFp(market?.open_interest_fp).toLocaleString()}
              </div>
              <div>
                Vol: {parseFp(market?.volume_fp).toLocaleString()} · 24h:{" "}
                {parseFp(market?.volume_24h_fp).toLocaleString()}
              </div>
              <div>
                Mutually exclusive event:{" "}
                {eventQ.data?.event.mutually_exclusive ? "yes" : "no"}
              </div>
            </div>
            <a
              className="mt-3 inline-flex items-center gap-1 text-[#00D4AA] hover:underline"
              href={`https://kalshi.com/markets/${ticker}`}
              target="_blank"
              rel="noreferrer"
            >
              Open on Kalshi <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <LiquidityHeatmap data={ob.data} />
        </div>
      </div>

      <div className="mt-3">
        <VolumeProfile data={ob.data} />
      </div>
    </div>
  );
}
