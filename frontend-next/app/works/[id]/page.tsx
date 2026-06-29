import { AppShell } from "../../../components/app-shell";
import { WorkDetail } from "../../../components/work-detail";

export default async function WorkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AppShell>
      <WorkDetail workId={id} />
    </AppShell>
  );
}
