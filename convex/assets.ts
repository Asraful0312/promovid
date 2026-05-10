import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requireProjectOwner, getProjectIfOwner } from './lib/auth';

export const generateUploadUrl = mutation({
  args: { projectId: v.id('projects') },
  handler: async (ctx, args) => {
    await requireProjectOwner(ctx, args.projectId);
    const uploadUrl = await ctx.storage.generateUploadUrl();
    return { uploadUrl };
  },
});

export const finalizeUpload = mutation({
  args: {
    projectId: v.id('projects'),
    storageId: v.id('_storage'),
    kind: v.union(v.literal('upload'), v.literal('music')),
    label: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireProjectOwner(ctx, args.projectId);
    return await ctx.db.insert('assets', {
      projectId: args.projectId,
      kind: args.kind,
      storageId: args.storageId,
      label: args.label,
    });
  },
});

export const listByProject = query({
  args: { projectId: v.id('projects') },
  handler: async (ctx, args) => {
    const project = await getProjectIfOwner(ctx, args.projectId);
    if (!project) {
      return null;
    }
    const assets = await ctx.db
      .query('assets')
      .withIndex('by_project', (q) => q.eq('projectId', args.projectId))
      .take(200);
    const out = [];
    for (const a of assets) {
      const url = await ctx.storage.getUrl(a.storageId);
      out.push({ ...a, url });
    }
    return out;
  },
});
