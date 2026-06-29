import { CanvasWorkspace } from "../../../components/canvas-workspace";

export default async function WorkspacePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <CanvasWorkspace projectId={projectId} />;
}
