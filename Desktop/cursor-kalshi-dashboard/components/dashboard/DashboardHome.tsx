"use client";

import { CategorySummaryBar } from "@/components/dashboard/CategorySummary";
import { MarketHeatmap } from "@/components/dashboard/MarketHeatmap";
import { MarketTable } from "@/components/dashboard/MarketTable";
import { MoversPanel } from "@/components/dashboard/MoversPanel";
import { useMarkets } from "@/hooks/useMarkets";
import { parseDollars, parseFp } from "@/lib/kalshi/parse";
import { useMarketsStore } from "@/store/marketsStore";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function DashboardHome() {
  const q = useMarkets();
  const rows = useMarketsStore((s) => s.rows);
  const { isLoading, isError, error } = q;

  const kpis = (() => {
    let vol = 0;
    let best: { title: string; v: number } | null = null;
    let bestSpread: { title: string; s: number } | null = null;
    for (const r of rows) {
      const v = parseFp(r.market.volume_24h_fp);
      if (Number.isFinite(v)) vol += v;
      if (Number.isFinite(v) && (!best || v > best.v)) {
        best = { title: r.title, v };
      }
      const yb = parseDollars(r.market.yes_bid_dollars);
      const ya = parseDollars(r.market.yes_ask_dollars);
      if (Number.isFinite(yb) && Number.isFinite(ya)) {
        const sp = ya - yb;
        if (!bestSpread || sp > bestSpread.s) {
          bestSpread = { title: r.title, s: sp };
        }
      }
    }
    return {
      count: rows.length,
      vol,
      best,
      bestSpread,
    };
  })();

  if (isError) {
    return (
      <div className="p-6 text-sm text-[#FF4757]">
        Failed to load markets: {(error as Error).message}
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase text-[#6B6B8A]">Open markets</div>
            {isLoading ? (
              <Skeleton className="mt-2 h-8 w-24" />
            ) : (
              <div className="mt-2 font-mono text-2xl tabular-nums text-[#E8E8F0]">
                {kpis.count.toLocaleString()}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase text-[#6B6B8A]">24h volume (contracts)</div>
            {isLoading ? (
              <Skeleton className="mt-2 h-8 w-32" />
            ) : (
              <div className="mt-2 font-mono text-2xl tabular-nums text-[#E8E8F0]">
                {kpis.vol.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase text-[#6B6B8A]">Most active (24h)</div>
            {isLoading ? (
              <Skeleton className="mt-2 h-8 w-full" />
            ) : (
              <div className="mt-2 line-clamp-2 text-sm text-[#E8E8F0]">
                {kpis.best ? (
                  <>
                    <span className="font-medium">{kpis.best.title}</span>
                    <span className="ml-2 font-mono text-[#6B6B8A]">
                      {kpis.best.v.toLocaleString()}
                    </span>
                  </>
                ) : (
                  "—"
                )}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase text-[#6B6B8A]">Largest spread</div>
            {isLoading ? (
              <Skeleton className="mt-2 h-8 w-full" />
            ) : (
              <div className="mt-2 line-clamp-2 text-sm text-[#E8E8F0]">
                {kpis.bestSpread ? (
                  <>
                    <span className="font-medium">{kpis.bestSpread.title}</span>
                    <span className="ml-2 font-mono text-[#FFB300]">
                      {(kpis.bestSpread.s * 100).toFixed(1)}¢
                    </span>
                  </>
                ) : (
                  "—"
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <CategorySummaryBar rows={rows} />

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#6B6B8A]">
          Category heatmap
        </h2>
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <MarketHeatmap rows={rows} />
        )}
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#6B6B8A]">
            Markets
          </h2>
          {isLoading ? (
            <Skeleton className="h-[560px] w-full" />
          ) : rows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[#1E1E2E] p-8 text-center text-sm text-[#6B6B8A]">
              No open markets available right now.
            </div>
          ) : (
            <MarketTable rows={rows} />
          )}
        </div>
        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#6B6B8A]">
            Movers
          </h2>
          {isLoading ? (
            <Skeleton className="h-[560px] w-full" />
          ) : (
            <MoversPanel rows={rows} />
          )}
        </div>
      </section>
    </div>
  );
}
