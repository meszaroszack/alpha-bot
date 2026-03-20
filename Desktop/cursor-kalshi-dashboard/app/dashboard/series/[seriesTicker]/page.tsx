import { SeriesExplorer } from "@/components/dashboard/SeriesExplorer";

type Props = { params: { seriesTicker: string } };

export default function SeriesPage({ params }: Props) {
  const seriesTicker = decodeURIComponent(params.seriesTicker);
  return <SeriesExplorer seriesTicker={seriesTicker} />;
}
