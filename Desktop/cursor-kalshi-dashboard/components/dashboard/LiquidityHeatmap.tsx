"use client";

import { parseFp } from "@/lib/kalshi/parse";
import type { KalshiOrderBookResponse } from "@/lib/kalshi/types";

export function LiquidityHeatmap({
  data,
}: {
  data: KalshiOrderBookResponse | undefined;
}) {
  const ob = data?.orderbook_fp;
  const cells: { p: string; v: number }[] = [];
  for (const [p, s] of ob?.yes_dollars ?? []) {
    cells.push({ p, v: parseFp(s) });
  }
  const max = Math.max(...cells.map((c) => c.v), 1);

  return (
    <div className="rounded-lg border border-[#1E1E2E] bg-[#12121A] p-3">
      <div className="mb-2 text-xs font-semibold text-[#6B6B8A]">
        YES-side liquidity heat
      </div>
      <div className="flex flex-wrap gap-1">
        {cells.slice(0, 40).map((c) => (
          <div
            key={c.p}
            className="rounded px-1 py-0.5 text-[10px] text-[#0A0A0F]"
            style={{
              backgroundColor: `rgba(0, 212, 170, ${0.15 + (c.v / max) * 0.85})`,
            }}
            title={`${c.p} · ${c.v}`}
          >
            {(Number(c.p) * 100).toFixed(0)}
          </div>
        ))}
      </div>
    </div>
  );
}
