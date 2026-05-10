import type { Id } from '@/convex/_generated/dataModel';
import { ProjectPageClient } from '@/components/project/ProjectPageClient';

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProjectPageClient projectId={id as Id<'projects'>} />;
}
