import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requireIdentity, getProjectIfOwner, requireProjectOwner } from './lib/auth';
function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('URL is required');
  }
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withProto);
  } catch {
    throw new Error('Invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http(s) URLs are allowed');
  }
  return url.toString();
}

export const listMine = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.tokenIdentifier) {
      return [];
    }
    const limit = Math.min(args.limit ?? 50, 100);
    return await ctx.db
      .query('projects')
      .withIndex('by_owner_token', (q) => q.eq('ownerTokenIdentifier', identity.tokenIdentifier))
      .order('desc')
      .take(limit);
  },
});

export const get = query({
  args: { projectId: v.id('projects') },
  handler: async (ctx, args) => {
    return await getProjectIfOwner(ctx, args.projectId);
  },
});

export const create = mutation({
  args: { sourceUrl: v.string(), title: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    const sourceUrl = normalizeUrl(args.sourceUrl);
    const projectId = await ctx.db.insert('projects', {
      ownerTokenIdentifier: identity.tokenIdentifier,
      sourceUrl,
      title: args.title,
      status: 'draft',
      includeMusic: false,
    });
    return projectId;
  },
});

export const deleteProject = mutation({
  args: { projectId: v.id('projects') },
  handler: async (ctx, args) => {
    const { project } = await requireProjectOwner(ctx, args.projectId);

    const clips = await ctx.db
      .query('timelineClips')
      .withIndex('by_project_and_order', (q) => q.eq('projectId', project._id))
      .take(500);
    for (const c of clips) {
      await ctx.db.delete(c._id);
    }

    const assets = await ctx.db
      .query('assets')
      .withIndex('by_project', (q) => q.eq('projectId', project._id))
      .take(500);
    for (const a of assets) {
      await ctx.db.delete(a._id);
    }

    const renders = await ctx.db
      .query('renders')
      .withIndex('by_project', (q) => q.eq('projectId', project._id))
      .take(200);
    for (const r of renders) {
      await ctx.db.delete(r._id);
    }

    await ctx.db.delete(project._id);
  },
});

export const setMusic = mutation({
  args: {
    projectId: v.id('projects'),
    musicAssetId: v.union(v.id('assets'), v.null()),
    includeMusic: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireProjectOwner(ctx, args.projectId);
    await ctx.db.patch(args.projectId, {
      musicAssetId: args.musicAssetId ?? undefined,
      includeMusic: args.includeMusic,
    });
  },
});

export const setMusicSettings = mutation({
  args: {
    projectId: v.id('projects'),
    gain: v.optional(v.number()),
    trimStartMs: v.optional(v.number()),
    includeMusic: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireProjectOwner(ctx, args.projectId);
    const patch: Record<string, unknown> = {};
    if (args.gain !== undefined) patch.musicGain = Math.max(0, Math.min(1, args.gain));
    if (args.trimStartMs !== undefined) patch.musicTrimStartMs = Math.max(0, args.trimStartMs);
    if (args.includeMusic !== undefined) patch.includeMusic = args.includeMusic;
    await ctx.db.patch(args.projectId, patch);
  },
});

export const getMusicData = query({
  args: { projectId: v.id('projects') },
  handler: async (ctx, args) => {
    const project = await getProjectIfOwner(ctx, args.projectId);
    if (!project?.includeMusic || !project.musicAssetId) return null;
    const asset = await ctx.db.get(project.musicAssetId);
    if (!asset) return null;
    const url = await ctx.storage.getUrl(asset.storageId);
    return {
      url,
      gain: project.musicGain ?? 0.3,
      trimStartMs: project.musicTrimStartMs ?? 0,
      label: asset.label ?? 'Music',
    };
  },
});

export const patchMeta = mutation({
  args: { projectId: v.id('projects'), title: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireProjectOwner(ctx, args.projectId);
    const patch: { title?: string } = {};
    if (args.title !== undefined) patch.title = args.title;
    if (Object.keys(patch).length) {
      await ctx.db.patch(args.projectId, patch);
    }
  },
});
