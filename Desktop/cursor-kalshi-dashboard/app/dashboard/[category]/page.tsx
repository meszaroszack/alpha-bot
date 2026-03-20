import { CategoryView } from "@/components/dashboard/CategoryView";

type Props = { params: { category: string } };

export default function CategoryPage({ params }: Props) {
  const category = decodeURIComponent(params.category);
  return <CategoryView category={category} />;
}
