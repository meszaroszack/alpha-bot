"use client";

import { parseDollars, parseFp } from "@/lib/kalshi/parse";
import type { KalshiOrderBookResponse } from "@/lib/kalshi/types";
function topLevels(side: [string, string][] | undefined, take: number) {
  if (!side?.length) return [];
  const sorted = [...side].sort(
    (a, b) => parseDollars(b[0]) - parseDollars(a[0])
  );
  return sorted.slice(0, take);
}

export function OrderBook({
  data,
  loading,
  marketSpreadDollars,
}: {
  data: KalshiOrderBookResponse | undefined;
  loading?: boolean;
  /** yes_ask - yes_bid from market snapshot */
  marketSpreadDollars?: number;
}) {
  const ob = data?.orderbook_fp;
  const yes = topLevels(ob?.yes_dollars, 10);
  const no = topLevels(ob?.no_dollars, 10);

  const maxSz = Math.max(
    ...[...yes, ...no].map((x) => parseFp(x[1])),
    1
  );

  const spread =
    marketSpreadDollars != null && Number.isFinite(marketSpreadDollars)
      ? `${(marketSpreadDollars * 100).toFixed(1)}¢`
      : "—";

  if (loading) {
    return (
      <div className="h-[360px] animate-pulse rounded-lg bg-[#12121A]" />
    );
  }

  return (
    <div className="grid h-[360px] grid-cols-[1fr_auto_1fr] gap-2 rounded-lg border border-[#1E1E2E] bg-[#12121A] p-3">
      <div>
        <div className="mb-2 text-center text-xs font-semibold text-[#2ED573]">
          YES bids
        </div>
        <div className="space-y-1">
          {yes.map(([p, sz]) => {
            const w = Math.max(8, (parseFp(sz) / maxSz) * 100);
            return (
              <div key={`y-${p}`} className="relative h-6 overflow-hidden rounded bg-[#0A0A0F]">
                <div
                  className="absolute inset-y-0 left-0 bg-[#2ED573]/25"
                  style={{ width: `${w}%` }}
                />
                <div className="relative flex h-full items-center justify-between px-2 text-xs tabular-nums">
                  <span className="text-[#E8E8F0]">
                    {(parseDollars(p) * 100).toFixed(1)}¢
                  </span>
                  <span className="text-[#6B6B8A]">{parseFp(sz).toFixed(0)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex flex-col items-center justify-center px-2 text-center">
        <div className="text-[10px] uppercase text-[#6B6B8A]">Spread</div>
        <div className="text-lg font-semibold text-[#FFB300]">{spread}</div>
      </div>
      <div>
        <div className="mb-2 text-center text-xs font-semibold text-[#FF4757]">
          NO bids
        </div>
        <div className="space-y-1">
          {no.map(([p, sz]) => {
            const w = Math.max(8, (parseFp(sz) / maxSz) * 100);
            return (
              <div key={`n-${p}`} className="relative h-6 overflow-hidden rounded bg-[#0A0A0F]">
                <div
                  className="absolute inset-y-0 right-0 bg-[#FF4757]/25"
                  style={{ width: `${w}%` }}
                />
                <div className="relative flex h-full items-center justify-between px-2 text-xs tabular-nums">
                  <span className="text-[#E8E8F0]">
                    {(parseDollars(p) * 100).toFixed(1)}¢
                  </span>
                  <span className="text-[#6B6B8A]">{parseFp(sz).toFixed(0)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
