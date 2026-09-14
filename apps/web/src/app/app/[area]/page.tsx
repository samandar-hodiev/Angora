import { AreaView } from "@/components/layout/area-view";

/**
 * Fallback for app areas without a dedicated page yet: planned areas (AI Coach, IELTS,
 * Progress, ...) and skills served by the API (/app/speaking, /app/writing, ...).
 * A dedicated route folder added later (e.g. app/app/speaking) takes precedence.
 */
export default async function AreaPage({ params }: { params: Promise<{ area: string }> }) {
  const { area } = await params;
  return <AreaView slug={area} />;
}
