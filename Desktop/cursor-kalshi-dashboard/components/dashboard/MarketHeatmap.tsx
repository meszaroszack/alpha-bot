"use client";

import { parseDollars, parseFp } from "@/lib/kalshi/parse";
import type { MarketRow } from "@/lib/kalshi/types";
import { useUiStore } from "@/store/uiStore";
import { useMemo } from "react";

type CatAgg = {
  category: string;
  count: number;
  vol24: number;
  avgYes: number;
  topEvent: string;
};

function heatColor(avgYes: number): string {
  // 0 -> red, 0.5 -> gray, 1 -> green
  const t = Math.max(0, Math.min(1, avgYes));
  if (t < 0.5) {
    const k = t / 0.5;
    const r = Math.round(255 - k * (255 - 107));
    const g = Math.round(71 + k * (107 - 71));
    const b = Math.round(87 + k * (138 - 87));
    return `rgb(${r},${g},${b})`;
  }
  const k = (t - 0.5) / 0.5;
  const r = Math.round(107 - k * (107 - 46));
  const g = Math.round(107 + k * (213 - 107));
  const b = Math.round(138 + k * (115 - 138));
  return `rgb(${r},${g},${b})`;
}

export function MarketHeatmap({ rows }: { rows: MarketRow[] }) {
  const setCategory = useUiStore((s) => s.setCategoryFilter);

  const categories = useMemo(() => {
    const map = new Map<string, { sum: number; n: number; vol: number; events: Map<string, number> }>();
    for (const r of rows) {
      const cat = r.category || "Other";
      const last = parseDollars(r.market.last_price_dollars);
      const v = parseFp(r.market.volume_24h_fp);
      if (!map.has(cat)) {
        map.set(cat, { sum: 0, n: 0, vol: 0, events: new Map() });
      }
      const a = map.get(cat)!;
      if (Number.isFinite(last)) {
        a.sum += last;
        a.n += 1;
      }
      a.vol += Number.isFinite(v) ? v : 0;
      a.events.set(r.eventTitle, (a.events.get(r.eventTitle) ?? 0) + v);
    }
    const out: CatAgg[] = [];
    for (const [category, v] of Array.from(map.entries())) {
      const avgYes = v.n ? v.sum / v.n : 0.5;
      let topEvent = "";
      let maxV = 0;
      for (const [e, vol] of Array.from(v.events.entries())) {
        if (vol > maxV) {
          maxV = vol;
          topEvent = e;
        }
      }
      out.push({
        category,
        count: rows.filter((x) => (x.category || "Other") === category).length,
        vol24: v.vol,
        avgYes,
        topEvent: topEvent || "—",
      });
    }
    return out.sort((a, b) => b.vol24 - a.vol24);
  }, [rows]);

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {categories.map((c) => (
        <button
          key={c.category}
          type="button"
          onClick={() => setCategory(c.category)}
          className="rounded-lg border border-[#1E1E2E] p-4 text-left transition hover:ring-2 hover:ring-[#00D4AA]/40"
          style={{ backgroundColor: heatColor(c.avgYes) }}
        >
          <div className="text-sm font-semibold text-[#0A0A0F] drop-shadow-sm">
            {c.category}
          </div>
          <div className="mt-1 text-xs text-[#0A0A0F]/90">
            {c.count} mkts · Vol {c.vol24.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </div>
          <div className="mt-2 line-clamp-2 text-[11px] text-[#0A0A0F]/80">
            Active: {c.topEvent}
          </div>
        </button>
      ))}
    </div>
  );
}
