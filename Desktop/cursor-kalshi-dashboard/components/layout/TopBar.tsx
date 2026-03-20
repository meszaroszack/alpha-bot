"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUiStore, type Timeframe } from "@/store/uiStore";
import { useIsFetching } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { KalshiCredentialsDialog } from "@/components/auth/KalshiCredentialsDialog";

const TF: Timeframe[] = ["1m", "1h", "1D"];

export function TopBar() {
  const search = useUiStore((s) => s.search);
  const setSearch = useUiStore((s) => s.setSearch);
  const tf = useUiStore((s) => s.timeframe);
  const setTf = useUiStore((s) => s.setTimeframe);

  const fetching = useIsFetching({ queryKey: ["markets"] }) > 0;

  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-[#1E1E2E] bg-[#0A0A0F]/90 px-4 py-3 backdrop-blur">
      <div className="relative min-w-[200px] flex-1 max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B6B8A]" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search markets…"
          className="pl-9"
        />
      </div>
      <div className="flex items-center gap-1 rounded-md border border-[#1E1E2E] bg-[#12121A] p-1">
        {TF.map((t) => (
          <Button
            key={t}
            type="button"
            variant={tf === t ? "accent" : "ghost"}
            size="sm"
            className="h-8 w-20"
            onClick={() => setTf(t)}
          >
            {t}
          </Button>
        ))}
      </div>
      <div className="flex items-center gap-2 text-xs text-[#6B6B8A]">
        <span
          className={`inline-block h-2 w-2 rounded-full ${
            fetching ? "animate-pulse bg-[#FFB300]" : "bg-[#00D4AA]"
          }`}
        />
        {fetching ? "Updating…" : "Live"}
      </div>
      <KalshiCredentialsDialog />
    </header>
  );
}
