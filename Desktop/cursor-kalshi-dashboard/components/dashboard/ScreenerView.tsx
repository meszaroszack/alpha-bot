"use client";

import { MarketTable } from "@/components/dashboard/MarketTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMarkets } from "@/hooks/useMarkets";
import { parseDollars, parseFp } from "@/lib/kalshi/parse";
import type { MarketRow } from "@/lib/kalshi/types";
import { useMarketsStore } from "@/store/marketsStore";
import { useUiStore } from "@/store/uiStore";
import { useEffect, useMemo, useState } from "react";

function downloadCsv(rows: MarketRow[]) {
  const headers = [
    "ticker",
    "title",
    "category",
    "yes_bid",
    "yes_ask",
    "last",
    "vol24h",
    "oi",
    "close_time",
  ];
  const lines = [headers.join(",")];
  for (const r of rows) {
    const m = r.market;
    lines.push(
      [
        r.ticker,
        JSON.stringify(r.title),
        JSON.stringify(r.category),
        m.yes_bid_dollars,
        m.yes_ask_dollars,
        m.last_price_dollars,
        m.volume_24h_fp,
        m.open_interest_fp,
        m.close_time,
      ].join(",")
    );
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "kalshi-markets.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export function ScreenerView() {
  useMarkets();
  const rows = useMarketsStore((s) => s.rows);
  const clearCat = useUiStore((s) => s.setCategoryFilter);

  useEffect(() => {
    clearCat(null);
  }, [clearCat]);

  const [cats, setCats] = useState<string[]>([]);
  const [minYes, setMinYes] = useState(0);
  const [maxYes, setMaxYes] = useState(1);
  const [minVol, setMinVol] = useState(0);
  const [minOi, setMinOi] = useState(0);
  const [maxSpread, setMaxSpread] = useState(1);
  const [expiry, setExpiry] = useState<"any" | "24h" | "7d" | "30d">("any");

  const categories = useMemo(
    () => [...new Set(rows.map((r) => r.category))].sort(),
    [rows]
  );

  const filtered = useMemo(() => {
    const now = Date.now();
    const within = (t: string | undefined) => {
      if (!t || expiry === "any") return true;
      const ms = new Date(t).getTime() - now;
      if (expiry === "24h") return ms >= 0 && ms <= 86400000;
      if (expiry === "7d") return ms >= 0 && ms <= 7 * 86400000;
      if (expiry === "30d") return ms >= 0 && ms <= 30 * 86400000;
      return true;
    };

    return rows.filter((r) => {
      if (cats.length && !cats.includes(r.category)) return false;
      const yb = parseDollars(r.market.yes_bid_dollars);
      if (!Number.isFinite(yb) || yb < minYes || yb > maxYes) return false;
      const vol = parseFp(r.market.volume_24h_fp);
      if (vol < minVol) return false;
      const oi = parseFp(r.market.open_interest_fp);
      if (oi < minOi) return false;
      const ya = parseDollars(r.market.yes_ask_dollars);
      const sp = Number.isFinite(ya) && Number.isFinite(yb) ? ya - yb : NaN;
      if (Number.isFinite(sp) && sp > maxSpread) return false;
      if (!within(r.market.close_time)) return false;
      return true;
    });
  }, [rows, cats, minYes, maxYes, minVol, minOi, maxSpread, expiry]);

  const toggleCat = (c: string) => {
    setCats((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]
    );
  };

  return (
    <div className="space-y-6 p-4">
      <div>
        <h1 className="text-2xl font-semibold text-[#E8E8F0]">Screener</h1>
        <p className="text-sm text-[#6B6B8A]">
          Filter open markets and export results.
        </p>
      </div>

      <div className="grid gap-4 rounded-lg border border-[#1E1E2E] bg-[#12121A] p-4 lg:grid-cols-2">
        <div>
          <div className="mb-2 text-xs font-semibold uppercase text-[#6B6B8A]">
            Categories
          </div>
          <div className="flex max-h-36 flex-wrap gap-2 overflow-auto">
            {categories.map((c) => (
              <label
                key={c}
                className="flex cursor-pointer items-center gap-2 text-xs text-[#E8E8F0]"
              >
                <input
                  type="checkbox"
                  checked={cats.includes(c)}
                  onChange={() => toggleCat(c)}
                  className="accent-[#00D4AA]"
                />
                {c}
              </label>
            ))}
          </div>
        </div>
        <div className="space-y-3">
          <div>
            <div className="mb-1 text-xs text-[#6B6B8A]">YES bid range ($)</div>
            <div className="flex gap-2">
              <Input
                type="number"
                step={0.01}
                value={minYes}
                onChange={(e) => setMinYes(Number(e.target.value))}
              />
              <Input
                type="number"
                step={0.01}
                value={maxYes}
                onChange={(e) => setMaxYes(Number(e.target.value))}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="mb-1 text-xs text-[#6B6B8A]">Min vol 24h</div>
              <Input
                type="number"
                value={minVol}
                onChange={(e) => setMinVol(Number(e.target.value))}
              />
            </div>
            <div>
              <div className="mb-1 text-xs text-[#6B6B8A]">Min OI</div>
              <Input
                type="number"
                value={minOi}
                onChange={(e) => setMinOi(Number(e.target.value))}
              />
            </div>
          </div>
          <div>
            <div className="mb-1 text-xs text-[#6B6B8A]">Max spread ($)</div>
            <Input
              type="number"
              step={0.01}
              value={maxSpread}
              onChange={(e) => setMaxSpread(Number(e.target.value))}
            />
          </div>
          <div>
            <div className="mb-1 text-xs text-[#6B6B8A]">Time to expiration</div>
            <select
              className="h-9 w-full rounded-md border border-[#1E1E2E] bg-[#12121A] px-2 text-sm text-[#E8E8F0]"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value as typeof expiry)}
            >
              <option value="any">Any</option>
              <option value="24h">Within 24h</option>
              <option value="7d">Within 7d</option>
              <option value="30d">Within 30d</option>
            </select>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="text-sm text-[#6B6B8A]">
          {filtered.length} markets match
        </div>
        <Button type="button" variant="accent" onClick={() => downloadCsv(filtered)}>
          Export CSV
        </Button>
      </div>

      <MarketTable rows={filtered} />
    </div>
  );
}
