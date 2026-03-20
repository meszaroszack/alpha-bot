"use client";

import { parseDollars, parseFp } from "@/lib/kalshi/parse";
import type { MarketRow } from "@/lib/kalshi/types";
import { useUiStore } from "@/store/uiStore";

export function CategorySummaryBar({ rows }: { rows: MarketRow[] }) {
  const cat = useUiStore((s) => s.categoryFilter);
  const clear = () => useUiStore.getState().setCategoryFilter(null);

  const subset = cat ? rows.filter((r) => r.category === cat) : rows;
  const vol = subset.reduce(
    (s, r) => s + parseFp(r.market.volume_24h_fp),
    0
  );
  const avg =
    subset.reduce((s, r) => s + parseDollars(r.market.last_price_dollars), 0) /
    Math.max(1, subset.length);

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[#1E1E2E] bg-[#12121A] px-4 py-3 text-sm text-[#E8E8F0]">
      {cat ? (
        <>
          <span className="font-semibold text-[#00D4AA]">Filtered: {cat}</span>
          <button
            type="button"
            className="text-xs text-[#6B6B8A] underline"
            onClick={clear}
          >
            Clear
          </button>
        </>
      ) : (
        <span className="text-[#6B6B8A]">All categories</span>
      )}
      <span className="text-[#6B6B8A]">
        Markets:{" "}
        <span className="tabular-nums text-[#E8E8F0]">{subset.length}</span>
      </span>
      <span className="text-[#6B6B8A]">
        24h vol:{" "}
        <span className="tabular-nums text-[#E8E8F0]">
          {vol.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </span>
      </span>
      <span className="text-[#6B6B8A]">
        Avg YES:{" "}
        <span className="tabular-nums text-[#E8E8F0]">
          {(avg * 100).toFixed(1)}¢
        </span>
      </span>
    </div>
  );
}
