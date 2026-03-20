"use client";

import { parseDollars, parseFp } from "@/lib/kalshi/parse";
import type { MarketRow } from "@/lib/kalshi/types";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/store/uiStore";
import { useVirtualizer } from "@tanstack/react-virtual";
import { format } from "date-fns";
import { useMemo, useRef, useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type SortKey =
  | "title"
  | "category"
  | "yesBid"
  | "yesAsk"
  | "spread"
  | "last"
  | "delta"
  | "vol24"
  | "oi"
  | "close";

function fmtCents(n: number) {
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(1)}¢`;
}

function pctChange(row: MarketRow): string {
  const last = parseDollars(row.market.last_price_dollars);
  const prev = parseDollars(row.market.previous_price_dollars);
  if (!Number.isFinite(last) || !Number.isFinite(prev) || prev === 0) return "—";
  const p = ((last - prev) / prev) * 100;
  return `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`;
}

export function MarketTable({ rows }: { rows: MarketRow[] }) {
  const search = useUiStore((s) => s.search);
  const categoryFilter = useUiStore((s) => s.categoryFilter);
  const openDetail = useUiStore((s) => s.openDetail);

  const [sortKey, setSortKey] = useState<SortKey>("vol24");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (categoryFilter && r.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        r.title.toLowerCase().includes(q) ||
        r.ticker.toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q)
      );
    });
  }, [rows, search, categoryFilter]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    const dir = sortDir === "asc" ? 1 : -1;
    copy.sort((a, b) => {
      const ma = a.market;
      const mb = b.market;
      const yb = (m: typeof ma) => parseDollars(m.yes_bid_dollars);
      const ya = (m: typeof ma) => parseDollars(m.yes_ask_dollars);
      const sp = (m: typeof ma) =>
        Number.isFinite(ya(m)) && Number.isFinite(yb(m))
          ? ya(m) - yb(m)
          : NaN;
      const last = (m: typeof ma) => parseDollars(m.last_price_dollars);
      const prev = (m: typeof ma) => parseDollars(m.previous_price_dollars);
      const delta = (m: typeof ma) =>
        Number.isFinite(last(m)) && Number.isFinite(prev(m)) && prev(m) !== 0
          ? ((last(m) - prev(m)) / prev(m)) * 100
          : NaN;
      const vol = (m: typeof ma) => parseFp(m.volume_24h_fp);
      const oi = (m: typeof ma) => parseFp(m.open_interest_fp);
      const closeTs = (m: typeof ma) =>
        m.close_time ? new Date(m.close_time).getTime() : 0;

      switch (sortKey) {
        case "title":
          return a.title.localeCompare(b.title) * dir;
        case "category":
          return a.category.localeCompare(b.category) * dir;
        case "yesBid":
          return (yb(ma) - yb(mb)) * dir;
        case "yesAsk":
          return (ya(ma) - ya(mb)) * dir;
        case "spread":
          return (sp(ma) - sp(mb)) * dir;
        case "last":
          return (last(ma) - last(mb)) * dir;
        case "delta":
          return (delta(ma) - delta(mb)) * dir;
        case "vol24":
          return (vol(ma) - vol(mb)) * dir;
        case "oi":
          return (oi(ma) - oi(mb)) * dir;
        case "close":
          return (closeTs(ma) - closeTs(mb)) * dir;
        default:
          return 0;
      }
    });
    return copy;
  }, [filtered, sortKey, sortDir]);

  const toggleHeader = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir("desc");
    }
  };

  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44,
    overscan: 12,
  });

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-[560px] flex-col overflow-hidden rounded-lg border border-[#1E1E2E] bg-[#12121A]">
        <div className="grid grid-cols-[minmax(0,2fr)_100px_72px_72px_72px_72px_72px_88px_88px_120px] gap-2 border-b border-[#1E1E2E] px-3 py-2 text-xs font-medium uppercase tracking-wide text-[#6B6B8A]">
          <button
            type="button"
            className="text-left hover:text-[#E8E8F0]"
            onClick={() => toggleHeader("title")}
          >
            Market
          </button>
          <button type="button" onClick={() => toggleHeader("category")}>
            Cat
          </button>
          <button type="button" onClick={() => toggleHeader("yesBid")}>
            YBid
          </button>
          <button type="button" onClick={() => toggleHeader("yesAsk")}>
            YAsk
          </button>
          <button type="button" onClick={() => toggleHeader("spread")}>
            Sprd
          </button>
          <button type="button" onClick={() => toggleHeader("last")}>
            Last
          </button>
          <button type="button" onClick={() => toggleHeader("delta")}>
            Δ24h
          </button>
          <button type="button" onClick={() => toggleHeader("vol24")}>
            Vol24h
          </button>
          <button type="button" onClick={() => toggleHeader("oi")}>
            OI
          </button>
          <button type="button" onClick={() => toggleHeader("close")}>
            Closes
          </button>
        </div>
        <div ref={parentRef} className="flex-1 overflow-auto">
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              position: "relative",
              width: "100%",
            }}
          >
            {rowVirtualizer.getVirtualItems().map((v) => {
              const row = sorted[v.index];
              const m = row.market;
              const yb = parseDollars(m.yes_bid_dollars);
              const ya = parseDollars(m.yes_ask_dollars);
              const sp =
                Number.isFinite(ya) && Number.isFinite(yb) ? ya - yb : NaN;
              const last = parseDollars(m.last_price_dollars);
              const close = m.close_time
                ? format(new Date(m.close_time), "MMM d HH:mm")
                : "—";

              return (
                <div
                  key={row.ticker}
                  className="absolute left-0 top-0 grid w-full grid-cols-[minmax(0,2fr)_100px_72px_72px_72px_72px_72px_88px_88px_120px] gap-2 border-b border-[#1E1E2E]/60 px-3 py-2 text-sm tabular-nums text-[#E8E8F0] hover:bg-[#0A0A0F]/80"
                  style={{
                    transform: `translateY(${v.start}px)`,
                  }}
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="truncate text-left font-medium text-[#E8E8F0] hover:text-[#00D4AA]"
                        onClick={() => openDetail(row.ticker)}
                      >
                        {row.title}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[420px]">
                      {row.title}
                    </TooltipContent>
                  </Tooltip>
                  <span className="truncate text-xs text-[#6B6B8A]">
                    {row.category}
                  </span>
                  <span>{fmtCents(yb)}</span>
                  <span>{fmtCents(ya)}</span>
                  <span>{fmtCents(sp)}</span>
                  <span>{fmtCents(last)}</span>
                  <span
                    className={cn(
                      pctChange(row).startsWith("+")
                        ? "text-[#2ED573]"
                        : pctChange(row).startsWith("-")
                          ? "text-[#FF4757]"
                          : "text-[#6B6B8A]"
                    )}
                  >
                    {pctChange(row)}
                  </span>
                  <span>{parseFp(m.volume_24h_fp).toLocaleString()}</span>
                  <span>{parseFp(m.open_interest_fp).toLocaleString()}</span>
                  <span className="text-xs text-[#6B6B8A]">{close}</span>
                </div>
              );
            })}
          </div>
        </div>
        {sorted.length === 0 && (
          <div className="p-8 text-center text-sm text-[#6B6B8A]">
            No markets match your filters.
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
