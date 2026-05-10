import { v } from 'convex/values';
import { internalMutation, type MutationCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';

const clipValidator = v.object({
  order: v.number(),
  startMs: v.number(),
  endMs: v.number(),
  narrationText: v.string(),
  captionText: v.string(),
  imageStorageId: v.id('_storage'),
  audioStorageId: v.optional(v.id('_storage')),
  bgStyle: v.optional(v.string()),
});

async function findAssetByStorage(
  ctx: MutationCtx,
  projectId: Id<'projects'>,
  storageId: Id<'_storage'>,
) {
  const assets = await ctx.db
    .query('assets')
    .withIndex('by_project', (q) => q.eq('projectId', projectId))
    .take(500);
  return assets.find((a) => a.storageId === storageId) ?? null;
}

async function ensureImageAsset(
  ctx: MutationCtx,
  projectId: Id<'projects'>,
  storageId: Id<'_storage'>,
  kind: 'screenshot' | 'upload',
) {
  const existing = await findAssetByStorage(ctx, projectId, storageId);
  if (existing) {
    return existing._id;
  }
  return await ctx.db.insert('assets', {
    projectId,
    kind,
    storageId,
  });
}

export const issueUpload = internalMutation({
  args: {
    renderId: v.id('renders'),
    contentType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const render = await ctx.db.get(args.renderId);
    if (!render || render.status !== 'rendering') {
      throw new Error('Invalid render state');
    }
    const postUrl = await ctx.storage.generateUploadUrl();
    return { uploadUrl: postUrl };
  },
});

export const complete = internalMutation({
  args: {
    renderId: v.id('renders'),
    outputStorageId: v.optional(v.id('_storage')),
    clips: v.array(clipValidator),
  },
  handler: async (ctx, args) => {
    const render = await ctx.db.get(args.renderId);
    if (!render || render.status !== 'rendering') {
      throw new Error('Invalid render state');
    }
    const projectId = render.projectId;

    for (const clip of args.clips) {
      await ensureImageAsset(ctx, projectId, clip.imageStorageId, 'screenshot');
    }

    const oldClips = await ctx.db
      .query('timelineClips')
      .withIndex('by_project_and_order', (q) => q.eq('projectId', projectId))
      .take(500);
    for (const c of oldClips) {
      await ctx.db.delete(c._id);
    }

    for (const clip of args.clips) {
      const assetId = (await findAssetByStorage(ctx, projectId, clip.imageStorageId))?._id;
      if (!assetId) {
        throw new Error('Missing asset for clip');
      }
      await ctx.db.insert('timelineClips', {
        projectId,
        order: clip.order,
        startMs: clip.startMs,
        endMs: clip.endMs,
        narrationText: clip.narrationText,
        captionText: clip.captionText,
        assetId,
        audioStorageId: clip.audioStorageId,
        bgStyle: clip.bgStyle,
      });
    }

    await ctx.db.patch(args.renderId, {
      status: 'succeeded',
      outputStorageId: args.outputStorageId ?? undefined,
      error: undefined,
    });
    await ctx.db.patch(projectId, {
      status: 'ready',
      error: undefined,
      latestRenderId: args.renderId,
    });
  },
});

export const fail = internalMutation({
  args: { renderId: v.id('renders'), error: v.string() },
  handler: async (ctx, args) => {
    const render = await ctx.db.get(args.renderId);
    if (!render) {
      return;
    }
    await ctx.db.patch(args.renderId, {
      status: 'failed',
      error: args.error,
      log: args.error.slice(0, 2000),
    });
    await ctx.db.patch(render.projectId, {
      status: 'failed',
      error: args.error,
    });
  },
});
