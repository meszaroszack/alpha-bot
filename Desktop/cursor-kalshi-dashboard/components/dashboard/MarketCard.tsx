"use client";

import { parseDollars, parseFp } from "@/lib/kalshi/parse";
import type { KalshiMarket } from "@/lib/kalshi/types";
import { cn } from "@/lib/utils";

export function MarketCard({
  title,
  market,
  onClick,
}: {
  title: string;
  market: KalshiMarket;
  onClick?: () => void;
}) {
  const yb = parseDollars(market.yes_bid_dollars);
  const ya = parseDollars(market.yes_ask_dollars);
  const sp = Number.isFinite(ya) && Number.isFinite(yb) ? ya - yb : NaN;
  const v = parseFp(market.volume_24h_fp);
  const oi = parseFp(market.open_interest_fp);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full rounded-lg border border-[#1E1E2E] bg-[#12121A] p-3 text-left transition hover:border-[#00D4AA]/50 hover:shadow-[0_0_0_1px_rgba(0,212,170,0.25)]"
      )}
    >
      <div className="line-clamp-2 text-sm font-medium text-[#E8E8F0]">
        {title}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-[#6B6B8A]">
        <div>
          Spread{" "}
          <span className="tabular-nums text-[#E8E8F0]">
            {Number.isFinite(sp) ? `${(sp * 100).toFixed(1)}¢` : "—"}
          </span>
        </div>
        <div>
          Vol24h{" "}
          <span className="tabular-nums text-[#E8E8F0]">
            {v.toLocaleString()}
          </span>
        </div>
        <div>
          OI{" "}
          <span className="tabular-nums text-[#E8E8F0]">
            {oi.toLocaleString()}
          </span>
        </div>
        <div>
          Last{" "}
          <span className="tabular-nums text-[#E8E8F0]">
            {(parseDollars(market.last_price_dollars) * 100).toFixed(1)}¢
          </span>
        </div>
      </div>
    </button>
  );
}
