import { create } from "zustand";

export type Timeframe = "1m" | "1h" | "1D";

type UiState = {
  sidebarCollapsed: boolean;
  search: string;
  timeframe: Timeframe;
  categoryFilter: string | null;
  detailTicker: string | null;
  detailFullScreen: boolean;
  setSidebarCollapsed: (v: boolean) => void;
  setSearch: (v: string) => void;
  setTimeframe: (t: Timeframe) => void;
  setCategoryFilter: (c: string | null) => void;
  openDetail: (ticker: string, fullScreen?: boolean) => void;
  closeDetail: () => void;
  setDetailFullScreen: (v: boolean) => void;
};

export const useUiStore = create<UiState>((set) => ({
  sidebarCollapsed: false,
  search: "",
  timeframe: "1h",
  categoryFilter: null,
  detailTicker: null,
  detailFullScreen: false,
  setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
  setSearch: (v) => set({ search: v }),
  setTimeframe: (timeframe) => set({ timeframe }),
  setCategoryFilter: (categoryFilter) => set({ categoryFilter }),
  openDetail: (detailTicker, fullScreen) =>
    set({ detailTicker, detailFullScreen: fullScreen ?? false }),
  closeDetail: () => set({ detailTicker: null, detailFullScreen: false }),
  setDetailFullScreen: (detailFullScreen) => set({ detailFullScreen }),
}));
