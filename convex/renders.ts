import { v } from 'convex/values';
import { mutation, internalMutation, internalQuery, query, type MutationCtx } from './_generated/server';
import { internal } from './_generated/api';
import { requireProjectOwner, getProjectIfOwner } from './lib/auth';
import type { Id } from './_generated/dataModel';

const renderParams = v.object({
  voice: v.optional(v.string()),
  aspectRatio: v.optional(v.union(v.literal('16:9'), v.literal('9:16'))),
  musicGain: v.optional(v.number()),
});

export const getKickoffPayload = internalQuery({
  args: { renderId: v.id('renders') },
  handler: async (ctx, args) => {
    const render = await ctx.db.get(args.renderId);
    if (!render || render.status !== 'queued') {
      return null;
    }
    const project = await ctx.db.get(render.projectId);
    if (!project) {
      return null;
    }

    const clips = await ctx.db
      .query('timelineClips')
      .withIndex('by_project_and_order', (q) => q.eq('projectId', project._id))
      .order('asc')
      .take(100);

    const resolvedClips: Array<{
      order: number;
      startMs: number;
      endMs: number;
      narrationText: string;
      captionText: string;
      imageStorageId: Id<'_storage'>;
      imageUrl: string | null;
      bgStyle: string | undefined;
    }> = [];

    for (const c of clips) {
      const asset = await ctx.db.get(c.assetId);
      if (!asset) continue;
      const imageUrl = await ctx.storage.getUrl(asset.storageId);
      resolvedClips.push({
        order: c.order,
        startMs: c.startMs,
        endMs: c.endMs,
        narrationText: c.narrationText,
        captionText: c.captionText,
        imageStorageId: asset.storageId,
        imageUrl,
        bgStyle: c.bgStyle,
      });
    }

    const mode = resolvedClips.length === 0 ? ('initial' as const) : ('timeline' as const);

    let musicStorageId: Id<'_storage'> | undefined;
    let musicUrl: string | null = null;
    if (project.includeMusic && project.musicAssetId) {
      const m = await ctx.db.get(project.musicAssetId);
      if (m) {
        musicStorageId = m.storageId;
        musicUrl = await ctx.storage.getUrl(m.storageId);
      }
    }

    return {
      renderId: render._id,
      projectId: project._id,
      sourceUrl: project.sourceUrl,
      mode,
      clips: mode === 'timeline' ? resolvedClips : [],
      renderParams: render.params,
      musicStorageId,
      musicUrl,
      includeMusic: project.includeMusic && !!musicStorageId,
    };
  },
});

export const markRenderRendering = internalMutation({
  args: { renderId: v.id('renders') },
  handler: async (ctx, args) => {
    const render = await ctx.db.get(args.renderId);
    if (!render || render.status !== 'queued') {
      return;
    }
    await ctx.db.patch(args.renderId, { status: 'rendering', error: undefined });
    await ctx.db.patch(render.projectId, { status: 'rendering', error: undefined });
  },
});

export const markRenderFailed = internalMutation({
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

async function nextRenderVersion(ctx: MutationCtx, projectId: Id<'projects'>) {
  const existing = await ctx.db
    .query('renders')
    .withIndex('by_project', (q) => q.eq('projectId', projectId))
    .order('desc')
    .take(1);
  const maxV = existing[0]?.version ?? 0;
  return maxV + 1;
}

export const enqueue = mutation({
  args: {
    projectId: v.id('projects'),
    params: v.optional(renderParams),
  },
  handler: async (ctx, args) => {
    await requireProjectOwner(ctx, args.projectId);
    const version = await nextRenderVersion(ctx, args.projectId);
    const renderId = await ctx.db.insert('renders', {
      projectId: args.projectId,
      version,
      status: 'queued',
      params: args.params ?? {},
    });
    await ctx.db.patch(args.projectId, {
      status: 'queued',
      error: undefined,
      latestRenderId: renderId,
    });
    await ctx.scheduler.runAfter(0, internal.kickoff.kickoffWorker, { renderId });
    return renderId;
  },
});

export const listForProject = query({
  args: { projectId: v.id('projects'), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const project = await getProjectIfOwner(ctx, args.projectId);
    if (!project) {
      return [];
    }
    const lim = Math.min(args.limit ?? 20, 50);
    return await ctx.db
      .query('renders')
      .withIndex('by_project', (q) => q.eq('projectId', args.projectId))
      .order('desc')
      .take(lim);
  },
});

export const setExportOutput = mutation({
  args: {
    projectId: v.id('projects'),
    storageId: v.id('_storage'),
  },
  handler: async (ctx, args) => {
    const { project } = await requireProjectOwner(ctx, args.projectId);
    if (!project.latestRenderId) throw new Error('No render found');
    await ctx.db.patch(project.latestRenderId, { outputStorageId: args.storageId });
  },
});

export const getLatestOutput = query({
  args: { projectId: v.id('projects') },
  handler: async (ctx, args) => {
    const project = await getProjectIfOwner(ctx, args.projectId);
    if (!project) {
      return null;
    }
    const renders = await ctx.db
      .query('renders')
      .withIndex('by_project', (q) => q.eq('projectId', args.projectId))
      .order('desc')
      .take(30);
    const succeeded = renders.find((r) => r.status === 'succeeded' && r.outputStorageId);
    if (!succeeded?.outputStorageId) {
      return null;
    }
    const url = await ctx.storage.getUrl(succeeded.outputStorageId);
    return {
      url,
      renderId: succeeded._id,
      version: succeeded.version,
    };
  },
});
