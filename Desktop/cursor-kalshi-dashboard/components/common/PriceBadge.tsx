import { cn } from "@/lib/utils";

export function PriceBadge({
  cents,
  className,
}: {
  cents: number;
  className?: string;
}) {
  const isHigh = cents >= 50;
  return (
    <span
      className={cn(
        "rounded-md px-2 py-0.5 font-mono text-sm tabular-nums",
        isHigh ? "bg-[#2ED573]/15 text-[#2ED573]" : "bg-[#FF4757]/15 text-[#FF4757]",
        className
      )}
    >
      {cents.toFixed(1)}¢
    </span>
  );
}
