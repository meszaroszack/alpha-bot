"use client";

import { parseDollars } from "@/lib/kalshi/parse";
import type { MarketRow } from "@/lib/kalshi/types";
import { Sparkline } from "@/components/common/Sparkline";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMemo } from "react";

function pct(row: MarketRow): number {
  const last = parseDollars(row.market.last_price_dollars);
  const prev = parseDollars(row.market.previous_price_dollars);
  if (!Number.isFinite(last) || !Number.isFinite(prev) || prev === 0) return 0;
  return ((last - prev) / prev) * 100;
}

function sparkPoints(row: MarketRow): number[] {
  const last = parseDollars(row.market.last_price_dollars);
  const prev = parseDollars(row.market.previous_price_dollars);
  if (!Number.isFinite(last) || !Number.isFinite(prev))
    return [0.5, 0.5, 0.5];
  const mid = (prev + last) / 2;
  return [prev, prev * 0.98 + mid * 0.02, mid, last * 0.98 + mid * 0.02, last];
}

export function MoversPanel({ rows }: { rows: MarketRow[] }) {
  const { up, down } = useMemo(() => {
    const scored = rows
      .map((r) => ({ row: r, p: pct(r) }))
      .filter((x) => Number.isFinite(x.p));
    const up = [...scored].sort((a, b) => b.p - a.p).slice(0, 10);
    const down = [...scored].sort((a, b) => a.p - b.p).slice(0, 10);
    return { up, down };
  }, [rows]);

  return (
    <div className="flex h-[560px] flex-col rounded-lg border border-[#1E1E2E] bg-[#12121A]">
      <div className="border-b border-[#1E1E2E] px-3 py-2 text-sm font-semibold text-[#E8E8F0]">
        Movers
      </div>
      <Tabs defaultValue="up" className="flex flex-1 flex-col px-2 pb-2">
        <TabsList className="w-full">
          <TabsTrigger value="up" className="flex-1">
            📈 Up
          </TabsTrigger>
          <TabsTrigger value="down" className="flex-1">
            📉 Down
          </TabsTrigger>
        </TabsList>
        <TabsContent value="up" className="mt-2 flex-1 overflow-auto">
          <ul className="space-y-2">
            {up.map(({ row, p }) => (
              <li
                key={row.ticker}
                className="flex items-center justify-between gap-2 rounded-md border border-[#1E1E2E]/60 bg-[#0A0A0F]/60 px-2 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-[#E8E8F0]">
                    {row.title}
                  </div>
                  <div className="text-[11px] text-[#2ED573]">+{p.toFixed(1)}%</div>
                </div>
                <Sparkline values={sparkPoints(row)} stroke="#2ED573" />
              </li>
            ))}
          </ul>
        </TabsContent>
        <TabsContent value="down" className="mt-2 flex-1 overflow-auto">
          <ul className="space-y-2">
            {down.map(({ row, p }) => (
              <li
                key={row.ticker}
                className="flex items-center justify-between gap-2 rounded-md border border-[#1E1E2E]/60 bg-[#0A0A0F]/60 px-2 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-[#E8E8F0]">
                    {row.title}
                  </div>
                  <div className="text-[11px] text-[#FF4757]">{p.toFixed(1)}%</div>
                </div>
                <Sparkline values={sparkPoints(row)} stroke="#FF4757" />
              </li>
            ))}
          </ul>
        </TabsContent>
      </Tabs>
    </div>
  );
}
