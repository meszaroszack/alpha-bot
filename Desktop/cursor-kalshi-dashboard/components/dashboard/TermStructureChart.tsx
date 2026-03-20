"use client";

import { ColorType, createChart, type UTCTimestamp } from "lightweight-charts";
import { useEffect, useRef } from "react";

type Pt = { t: number; price: number };

export function TermStructureChart({ points }: { points: Pt[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || points.length < 2) return;

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: "#0A0A0F" },
        textColor: "#E8E8F0",
      },
      grid: {
        vertLines: { color: "#1E1E2E" },
        horzLines: { color: "#1E1E2E" },
      },
      width: el.clientWidth,
      height: 280,
      rightPriceScale: { borderColor: "#1E1E2E" },
      timeScale: { borderColor: "#1E1E2E" },
    });

    const line = chart.addLineSeries({
      color: "#00D4AA",
      lineWidth: 2,
    });

    line.setData(
      points
        .filter((p) => Number.isFinite(p.price))
        .map((p) => ({
          time: p.t as UTCTimestamp,
          value: p.price,
        }))
    );

    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth }));
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [points]);

  if (points.length < 2) {
    return (
      <div className="flex h-[280px] items-center justify-center rounded-lg border border-dashed border-[#1E1E2E] text-sm text-[#6B6B8A]">
        Not enough dated events for a term structure.
      </div>
    );
  }

  return <div ref={ref} className="w-full" />;
}
