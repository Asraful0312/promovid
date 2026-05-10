import type { Id } from '@/convex/_generated/dataModel';
import { VideoEditorPage } from '@/components/project/VideoEditorPage';

export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <VideoEditorPage projectId={id as Id<'projects'>} />;
}
