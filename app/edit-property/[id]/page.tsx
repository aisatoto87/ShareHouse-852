import EditPropertyPageClient from "./EditPropertyPageClient";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditPropertyPage({ params }: PageProps) {
  const { id } = await params;
  return <EditPropertyPageClient propertyId={id} />;
}
