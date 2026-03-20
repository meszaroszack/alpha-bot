"use client";

import { parseFp } from "@/lib/kalshi/parse";
import type { MarketRow } from "@/lib/kalshi/types";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/store/uiStore";
import { useMemo } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, LayoutGrid, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";

function slugify(s: string) {
  return encodeURIComponent(s);
}

export function Sidebar({ rows }: { rows: MarketRow[] }) {
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const setCollapsed = useUiStore((s) => s.setSidebarCollapsed);

  const { categories, series } = useMemo(() => {
    const catMap = new Map<string, { n: number; vol: number }>();
    const serMap = new Map<string, { n: number; vol: number }>();
    for (const r of rows) {
      const c = r.category || "Other";
      const cc = catMap.get(c) ?? { n: 0, vol: 0 };
      cc.n += 1;
      cc.vol += parseFp(r.market.volume_24h_fp);
      catMap.set(c, cc);

      const s = r.seriesTicker;
      const sc = serMap.get(s) ?? { n: 0, vol: 0 };
      sc.n += 1;
      sc.vol += parseFp(r.market.volume_24h_fp);
      serMap.set(s, sc);
    }
    const categories = [...catMap.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.vol - a.vol);
    const series = [...serMap.entries()]
      .map(([ticker, v]) => ({ ticker, ...v }))
      .sort((a, b) => b.vol - a.vol)
      .slice(0, 20);
    return { categories, series };
  }, [rows]);

  const w = collapsed ? "w-[60px]" : "w-[240px]";

  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col border-r border-[#1E1E2E] bg-[#12121A] transition-[width]",
        w
      )}
    >
      <div className="flex h-12 items-center justify-between border-b border-[#1E1E2E] px-2">
        {!collapsed && (
          <Link href="/dashboard" className="text-sm font-semibold text-[#00D4AA]">
            Kalshi Lab
          </Link>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </Button>
      </div>
      <nav className="flex-1 space-y-4 overflow-y-auto p-2 text-sm">
        <div>
          {!collapsed && (
            <div className="mb-2 text-xs font-semibold uppercase text-[#6B6B8A]">
              Views
            </div>
          )}
          <Link
            href="/dashboard"
            className="flex items-center gap-2 rounded-md px-2 py-2 text-[#E8E8F0] hover:bg-[#0A0A0F]"
            title="Overview"
          >
            <LayoutGrid className="h-4 w-4 shrink-0 text-[#00D4AA]" />
            {!collapsed && "Overview"}
          </Link>
          <Link
            href="/dashboard/screener"
            className="mt-1 flex items-center gap-2 rounded-md px-2 py-2 text-[#E8E8F0] hover:bg-[#0A0A0F]"
            title="Screener"
          >
            <SlidersHorizontal className="h-4 w-4 shrink-0 text-[#00D4AA]" />
            {!collapsed && "Screener"}
          </Link>
        </div>

        <div>
          {!collapsed && (
            <div className="mb-2 text-xs font-semibold uppercase text-[#6B6B8A]">
              Categories
            </div>
          )}
          <ul className="space-y-1">
            {categories.map((c) => (
              <li key={c.name}>
                <Link
                  href={`/dashboard/category/${slugify(c.name)}`}
                  className="block truncate rounded-md px-2 py-1.5 text-[#6B6B8A] hover:bg-[#0A0A0F] hover:text-[#E8E8F0]"
                  title={`${c.name} · ${c.n} mkts · vol ${c.vol.toFixed(0)}`}
                >
                  {!collapsed ? (
                    <>
                      <span className="text-[#E8E8F0]">{c.name}</span>
                      <span className="ml-2 text-[11px] text-[#6B6B8A]">
                        {c.n} · {c.vol.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </span>
                    </>
                  ) : (
                    <span className="text-center text-[10px] text-[#6B6B8A]">
                      {c.name.slice(0, 2)}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          {!collapsed && (
            <div className="mb-2 text-xs font-semibold uppercase text-[#6B6B8A]">
              Series
            </div>
          )}
          <ul className="space-y-1">
            {series.map((s) => (
              <li key={s.ticker}>
                <Link
                  href={`/dashboard/series/${encodeURIComponent(s.ticker)}`}
                  className="block truncate rounded-md px-2 py-1.5 text-[#6B6B8A] hover:bg-[#0A0A0F] hover:text-[#E8E8F0]"
                  title={s.ticker}
                >
                  {!collapsed ? (
                    <>
                      <span className="font-mono text-xs text-[#E8E8F0]">
                        {s.ticker}
                      </span>
                      <span className="ml-2 text-[11px] text-[#6B6B8A]">
                        {s.n}
                      </span>
                    </>
                  ) : (
                    <span className="font-mono text-[10px] text-[#6B6B8A]">
                      {s.ticker.slice(0, 3)}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </nav>
    </aside>
  );
}
