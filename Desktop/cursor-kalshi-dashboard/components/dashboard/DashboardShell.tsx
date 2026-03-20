"use client";

import { MarketDetailPanel } from "@/components/dashboard/MarketDetailPanel";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { useMarkets } from "@/hooks/useMarkets";
import { useMarketsStore } from "@/store/marketsStore";
import { useUiStore } from "@/store/uiStore";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  useMarkets();
  const rows = useMarketsStore((s) => s.rows);
  const detailTicker = useUiStore((s) => s.detailTicker);
  const full = useUiStore((s) => s.detailFullScreen);
  const closeDetail = useUiStore((s) => s.closeDetail);

  return (
    <div className="flex min-h-screen bg-[#0A0A0F] text-[#E8E8F0]">
      <Sidebar rows={rows} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <div className="md:hidden border-b border-[#FFB300]/30 bg-[#FFB300]/10 px-4 py-2 text-center text-xs text-[#FFB300]">
          For the full dashboard experience, use a desktop browser.
        </div>
        <main className="relative flex-1 overflow-auto">{children}</main>
      </div>
      {detailTicker && !full && (
        <button
          type="button"
          className="fixed inset-0 z-30 hidden bg-black/50 lg:block"
          aria-label="Close detail"
          onClick={closeDetail}
        />
      )}
      {detailTicker && <MarketDetailPanel />}
    </div>
  );
}
