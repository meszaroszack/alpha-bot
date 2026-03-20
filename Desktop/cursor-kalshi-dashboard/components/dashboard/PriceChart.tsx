"use client";

import { parseDollars, parseFp } from "@/lib/kalshi/parse";
import type { KalshiCandlesticksResponse } from "@/lib/kalshi/types";
import {
  ColorType,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef } from "react";

type Props = {
  data: KalshiCandlesticksResponse | undefined;
  loading?: boolean;
};

export function PriceChart({ data, loading }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const priceLineRef = useRef<ReturnType<
    ISeriesApi<"Candlestick">["createPriceLine"]
  > | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: "#0A0A0F" },
        textColor: "#E8E8F0",
      },
      grid: {
        vertLines: { color: "#1E1E2E" },
        horzLines: { color: "#1E1E2E" },
      },
      crosshair: {
        mode: 1,
      },
      rightPriceScale: {
        borderColor: "#1E1E2E",
        scaleMargins: { top: 0.08, bottom: 0.25 },
      },
      timeScale: {
        borderColor: "#1E1E2E",
        timeVisible: true,
        secondsVisible: false,
      },
      width: el.clientWidth,
      height: 420,
    });

    const candle = chart.addCandlestickSeries({
      upColor: "#2ED573",
      downColor: "#FF4757",
      borderVisible: false,
      wickUpColor: "#2ED573",
      wickDownColor: "#FF4757",
    });

    const volume = chart.addHistogramSeries({
      color: "#00D4AA",
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });

    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
    });

    chartRef.current = chart;
    seriesRef.current = candle;
    volRef.current = volume;

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: el.clientWidth });
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      volRef.current = null;
      priceLineRef.current = null;
    };
  }, []);

  useEffect(() => {
    const candle = seriesRef.current;
    const vol = volRef.current;
    const chart = chartRef.current;
    if (!candle || !vol || !chart || !data?.candlesticks?.length) {
      if (candle) candle.setData([]);
      if (vol) vol.setData([]);
      return;
    }

    const candles = data.candlesticks.map((c) => {
      const t = c.end_period_ts as UTCTimestamp;
      const o = parseDollars(c.yes_bid.open_dollars);
      const h = parseDollars(c.yes_bid.high_dollars);
      const l = parseDollars(c.yes_bid.low_dollars);
      const cl = parseDollars(c.yes_bid.close_dollars);
      const v = parseFp(c.volume_fp);
      return {
        time: t,
        open: o,
        high: h,
        low: l,
        close: cl,
        vol: v,
        color: cl >= o ? "#2ED57333" : "#FF475733",
      };
    });

    candle.setData(
      candles.map(({ time, open, high, low, close }) => ({
        time,
        open,
        high,
        low,
        close,
      }))
    );

    vol.setData(
      candles.map(({ time, vol: v, color }) => ({
        time,
        value: Number.isFinite(v) ? v : 0,
        color,
      }))
    );

    if (priceLineRef.current) {
      candle.removePriceLine(priceLineRef.current);
      priceLineRef.current = null;
    }
    priceLineRef.current = candle.createPriceLine({
      price: 0.5,
      color: "#FFB300",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: "50¢",
    });

    chart.timeScale().fitContent();
    chart.timeScale().scrollToRealTime();
  }, [data]);

  if (loading) {
    return (
      <div className="h-[420px] w-full animate-pulse rounded-md bg-[#12121A]" />
    );
  }

  if (!data?.candlesticks?.length) {
    return (
      <div className="flex h-[420px] w-full items-center justify-center rounded-md border border-dashed border-[#1E1E2E] bg-[#12121A]/80 text-sm text-[#6B6B8A]">
        No price history available for this range.
      </div>
    );
  }

  return <div ref={containerRef} className="w-full" />;
}
