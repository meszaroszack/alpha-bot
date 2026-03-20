"use client";

type Props = {
  values: number[];
  stroke?: string;
};

/** Minimal SVG sparkline for movers panel (normalized 0–1). */
export function Sparkline({ values, stroke = "#00D4AA" }: Props) {
  if (values.length < 2) {
    return <div className="h-8 w-20 rounded bg-[#1E1E2E]/60" />;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * 100;
    const y = 100 - ((v - min) / span) * 100;
    return `${x},${y}`;
  });
  const d = `M ${pts.join(" L ")}`;

  return (
    <svg viewBox="0 0 100 100" className="h-8 w-24" preserveAspectRatio="none">
      <path
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth={3}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
