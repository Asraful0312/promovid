import type { Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

export async function requireIdentity(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.tokenIdentifier) {
    throw new Error('Not authenticated');
  }
  return identity;
}

export async function requireProjectOwner(ctx: MutationCtx, projectId: Id<'projects'>) {
  const identity = await requireIdentity(ctx);
  const project = await ctx.db.get(projectId);
  if (!project || project.ownerTokenIdentifier !== identity.tokenIdentifier) {
    throw new Error('Not found');
  }
  return { project, identity };
}

export async function getProjectIfOwner(ctx: QueryCtx, projectId: Id<'projects'>) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.tokenIdentifier) {
    return null;
  }
  const project = await ctx.db.get(projectId);
  if (!project || project.ownerTokenIdentifier !== identity.tokenIdentifier) {
    return null;
  }
  return project;
}
