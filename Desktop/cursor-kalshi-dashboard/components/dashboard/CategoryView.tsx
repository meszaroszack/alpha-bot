"use client";

import { DashboardHome } from "@/components/dashboard/DashboardHome";
import { useUiStore } from "@/store/uiStore";
import { useEffect } from "react";

export function CategoryView({ category }: { category: string }) {
  const setCat = useUiStore((s) => s.setCategoryFilter);

  useEffect(() => {
    setCat(category);
    return () => setCat(null);
  }, [category, setCat]);

  return <DashboardHome />;
}
