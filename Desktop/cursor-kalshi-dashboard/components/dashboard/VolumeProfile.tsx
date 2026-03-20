"use client";

import { parseFp } from "@/lib/kalshi/parse";
import type { KalshiOrderBookResponse } from "@/lib/kalshi/types";

/** Simple volume-at-price bars from combined YES/NO ladders. */
export function VolumeProfile({ data }: { data: KalshiOrderBookResponse | undefined }) {
  const ob = data?.orderbook_fp;
  const levels: { price: number; vol: number }[] = [];
  for (const [p, s] of ob?.yes_dollars ?? []) {
    levels.push({ price: Number(p), vol: parseFp(s) });
  }
  for (const [p, s] of ob?.no_dollars ?? []) {
    levels.push({ price: Number(p), vol: parseFp(s) });
  }
  const max = Math.max(...levels.map((l) => l.vol), 1);

  return (
    <div className="h-[360px] rounded-lg border border-[#1E1E2E] bg-[#12121A] p-3">
      <div className="mb-2 text-xs font-semibold text-[#6B6B8A]">
        Volume profile (book)
      </div>
      <div className="flex max-h-[300px] flex-col gap-1 overflow-auto">
        {levels
          .sort((a, b) => b.vol - a.vol)
          .slice(0, 24)
          .map((l) => (
            <div key={`${l.price}`} className="flex items-center gap-2 text-xs">
              <div className="w-12 tabular-nums text-[#6B6B8A]">
                {(l.price * 100).toFixed(0)}¢
              </div>
              <div className="h-2 flex-1 rounded bg-[#0A0A0F]">
                <div
                  className="h-2 rounded bg-[#00D4AA]/40"
                  style={{ width: `${(l.vol / max) * 100}%` }}
                />
              </div>
              <div className="w-14 text-right tabular-nums text-[#E8E8F0]">
                {l.vol.toFixed(0)}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
