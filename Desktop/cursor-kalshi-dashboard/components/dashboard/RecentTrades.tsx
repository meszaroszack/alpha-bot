"use client";

import { parseDollars, parseFp } from "@/lib/kalshi/parse";
import type { KalshiTrade } from "@/lib/kalshi/types";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

export function RecentTrades({ trades }: { trades: KalshiTrade[] }) {
  return (
    <div className="flex h-[360px] flex-col overflow-hidden rounded-lg border border-[#1E1E2E] bg-[#12121A]">
      <div className="border-b border-[#1E1E2E] px-3 py-2 text-xs font-semibold uppercase text-[#6B6B8A]">
        Recent trades
      </div>
      <div className="flex-1 overflow-auto">
        <table className="w-full text-left text-xs tabular-nums">
          <thead className="sticky top-0 bg-[#12121A] text-[10px] uppercase text-[#6B6B8A]">
            <tr>
              <th className="px-2 py-1">Time</th>
              <th className="px-2 py-1">Side</th>
              <th className="px-2 py-1">Price</th>
              <th className="px-2 py-1">Size</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((t) => {
              const side = t.taker_side;
              const isYes = side === "yes";
              const px = parseDollars(t.yes_price_dollars);
              const sz = parseFp(t.count_fp);
              const time = t.created_time
                ? format(new Date(t.created_time), "HH:mm:ss")
                : "—";
              return (
                <tr
                  key={t.trade_id}
                  className={cn(
                    "border-b border-[#1E1E2E]/40",
                    isYes ? "text-[#2ED573]" : "text-[#FF4757]"
                  )}
                >
                  <td className="px-2 py-1 text-[#6B6B8A]">{time}</td>
                  <td className="px-2 py-1 font-semibold uppercase">
                    {side}
                  </td>
                  <td className="px-2 py-1">{(px * 100).toFixed(1)}¢</td>
                  <td className="px-2 py-1">{sz.toFixed(0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {trades.length === 0 && (
          <div className="p-4 text-center text-xs text-[#6B6B8A]">
            No trades yet.
          </div>
        )}
      </div>
    </div>
  );
}
