"use client";

import { fetchEventsForSeries, fetchSeriesByTicker } from "@/lib/kalshi/api";
import { parseDollars, parseFp } from "@/lib/kalshi/parse";
import type { KalshiEvent, KalshiMarket } from "@/lib/kalshi/types";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/store/uiStore";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { TermStructureChart } from "./TermStructureChart";
import { Sparkline } from "@/components/common/Sparkline";
import { Card, CardContent } from "@/components/ui/card";

function vwap(markets: KalshiMarket[]): number {
  let vol = 0;
  let px = 0;
  for (const m of markets) {
    const v = parseFp(m.volume_fp);
    const p = parseDollars(m.last_price_dollars);
    if (Number.isFinite(v) && v > 0 && Number.isFinite(p)) {
      vol += v;
      px += p * v;
    }
  }
  return vol > 0 ? px / vol : NaN;
}

export function SeriesExplorer({ seriesTicker }: { seriesTicker: string }) {
  const openDetail = useUiStore((s) => s.openDetail);

  const q = useQuery({
    queryKey: ["series", seriesTicker, "events"],
    queryFn: async () => {
      const [meta, ev] = await Promise.all([
        fetchSeriesByTicker(seriesTicker),
        fetchEventsForSeries(seriesTicker),
      ]);
      if (!meta.ok) throw meta.error;
      if (!ev.ok) throw ev.error;
      return { series: meta.data.series, events: ev.data };
    },
  });

  const sorted = useMemo(() => {
    const events = q.data?.events ?? [];
    return [...events].sort((a, b) => {
      const ca = a.markets?.[0]?.close_time;
      const cb = b.markets?.[0]?.close_time;
      const ta = ca ? new Date(ca).getTime() : 0;
      const tb = cb ? new Date(cb).getTime() : 0;
      return ta - tb;
    });
  }, [q.data?.events]);

  const termStructure = useMemo(() => {
    const pts: { t: number; price: number }[] = [];
    for (const e of sorted) {
      const m0 = e.markets?.[0];
      if (!m0?.close_time) continue;
      const t = Math.floor(new Date(m0.close_time).getTime() / 1000);
      const p = parseDollars(m0.last_price_dollars);
      if (Number.isFinite(t) && Number.isFinite(p)) pts.push({ t, price: p });
    }
    return pts.sort((a, b) => a.t - b.t);
  }, [sorted]);

  return (
    <div className="space-y-6 p-4">
      <div>
        <div className="text-xs uppercase text-[#6B6B8A]">Series</div>
        <h1 className="text-2xl font-semibold text-[#E8E8F0]">
          {q.data?.series.title ?? seriesTicker}
        </h1>
        <p className="mt-1 text-sm text-[#6B6B8A]">
          {q.data?.series.category} · {seriesTicker}
        </p>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="mb-2 text-center text-xs font-semibold uppercase text-[#6B6B8A]">
            Term structure (YES price vs close)
          </div>
          <TermStructureChart points={termStructure} />
        </CardContent>
      </Card>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[#6B6B8A]">
          Events
        </h2>
        {q.isLoading && <div className="text-sm text-[#6B6B8A]">Loading…</div>}
        {q.isError && (
          <div className="text-sm text-[#FF4757]">Failed to load series.</div>
        )}
        {sorted.map((ev) => (
          <EventRow key={ev.event_ticker} ev={ev} onOpen={openDetail} />
        ))}
      </div>
    </div>
  );
}

function EventRow({
  ev,
  onOpen,
}: {
  ev: KalshiEvent;
  onOpen: (t: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const markets = ev.markets ?? [];
  const w = vwap(markets);

  return (
    <div className="rounded-lg border border-[#1E1E2E] bg-[#12121A]">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-3 text-left"
        onClick={() => setOpen(!open)}
      >
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-[#6B6B8A]" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-[#6B6B8A]" />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-[#E8E8F0]">{ev.title}</div>
          <div className="text-xs text-[#6B6B8A]">
            {ev.event_ticker}
            {markets[0]?.close_time && (
              <> · closes {format(new Date(markets[0].close_time!), "MMM d")}</>
            )}
          </div>
        </div>
        <div className="text-right text-xs text-[#6B6B8A]">
          VWAP{" "}
          <span className="font-mono text-[#00D4AA]">
            {Number.isFinite(w) ? `${(w * 100).toFixed(1)}¢` : "—"}
          </span>
        </div>
      </button>
      {open && (
        <div className="border-t border-[#1E1E2E] px-3 py-2">
          <div className="grid gap-2 sm:grid-cols-2">
            {markets.map((m) => (
              <button
                key={m.ticker}
                type="button"
                onClick={() => onOpen(m.ticker)}
                className={cn(
                  "flex items-center justify-between rounded-md border border-[#1E1E2E] bg-[#0A0A0F] px-3 py-2 text-left hover:border-[#00D4AA]/40"
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-[#E8E8F0]">
                    {m.title}
                  </div>
                  <div className="font-mono text-[10px] text-[#6B6B8A]">
                    {m.ticker}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Sparkline
                    values={[
                      parseDollars(m.previous_price_dollars),
                      parseDollars(m.last_price_dollars),
                    ]}
                  />
                  <span className="font-mono text-sm text-[#00D4AA]">
                    {(parseDollars(m.last_price_dollars) * 100).toFixed(1)}¢
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
