import { AppShell } from "../../../components/app-shell";
import { AuthorProfilePanel } from "../../../components/author-profile-panel";

export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AppShell>
      <AuthorProfilePanel userId={id} />
    </AppShell>
  );
}
