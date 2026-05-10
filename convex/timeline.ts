import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { getProjectIfOwner, requireProjectOwner } from './lib/auth';
import type { Id } from './_generated/dataModel';

export const listClips = query({
  args: { projectId: v.id('projects') },
  handler: async (ctx, args) => {
    const project = await getProjectIfOwner(ctx, args.projectId);
    if (!project) {
      return null;
    }
    const clips = await ctx.db
      .query('timelineClips')
      .withIndex('by_project_and_order', (q) => q.eq('projectId', args.projectId))
      .order('asc')
      .take(100);

    const result: Array<{
      _id: Id<'timelineClips'>;
      order: number;
      startMs: number;
      endMs: number;
      narrationText: string;
      captionText: string;
      assetId: Id<'assets'>;
      imageUrl: string | null;
      audioUrl: string | null;
      bgStyle: string | undefined;
      layoutVariant: string | undefined;
      textX: number | undefined;
      textY: number | undefined;
      textW: number | undefined;
      textH: number | undefined;
      imageX: number | undefined;
      imageY: number | undefined;
      imageW: number | undefined;
      imageH: number | undefined;
      subtitleX: number | undefined;
      subtitleY: number | undefined;
      subtitleW: number | undefined;
      subtitleH: number | undefined;
    }> = [];

    for (const c of clips) {
      const asset = await ctx.db.get(c.assetId);
      const imageUrl = asset ? await ctx.storage.getUrl(asset.storageId) : null;
      const audioUrl = c.audioStorageId ? await ctx.storage.getUrl(c.audioStorageId) : null;
      result.push({
        _id: c._id,
        order: c.order,
        startMs: c.startMs,
        endMs: c.endMs,
        narrationText: c.narrationText,
        captionText: c.captionText,
        assetId: c.assetId,
        imageUrl,
        audioUrl,
        bgStyle: c.bgStyle,
        layoutVariant: c.layoutVariant,
        textX: c.textX,
        textY: c.textY,
        textW: c.textW,
        textH: c.textH,
        imageX: c.imageX,
        imageY: c.imageY,
        imageW: c.imageW,
        imageH: c.imageH,
        subtitleX: c.subtitleX,
        subtitleY: c.subtitleY,
        subtitleW: c.subtitleW,
        subtitleH: c.subtitleH,
      });
    }
    return result;
  },
});

export const updateClip = mutation({
  args: {
    projectId: v.id('projects'),
    clipId: v.id('timelineClips'),
    narrationText: v.optional(v.string()),
    captionText: v.optional(v.string()),
    startMs: v.optional(v.number()),
    endMs: v.optional(v.number()),
    assetId: v.optional(v.id('assets')),
    bgStyle: v.optional(v.string()),
    layoutVariant: v.optional(v.string()),
    textX: v.optional(v.number()),
    textY: v.optional(v.number()),
    textW: v.optional(v.number()),
    textH: v.optional(v.number()),
    imageX: v.optional(v.number()),
    imageY: v.optional(v.number()),
    imageW: v.optional(v.number()),
    imageH: v.optional(v.number()),
    subtitleX: v.optional(v.number()),
    subtitleY: v.optional(v.number()),
    subtitleW: v.optional(v.number()),
    subtitleH: v.optional(v.number()),
    resetPositions: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireProjectOwner(ctx, args.projectId);
    const clip = await ctx.db.get(args.clipId);
    if (!clip || clip.projectId !== args.projectId) {
      throw new Error('Not found');
    }
    const patch: Partial<typeof clip> = {};
    if (args.narrationText !== undefined) patch.narrationText = args.narrationText;
    if (args.captionText !== undefined) patch.captionText = args.captionText;
    if (args.startMs !== undefined) patch.startMs = args.startMs;
    if (args.endMs !== undefined) patch.endMs = args.endMs;
    if (args.assetId !== undefined) {
      const asset = await ctx.db.get(args.assetId);
      if (!asset || asset.projectId !== args.projectId) {
        throw new Error('Invalid asset');
      }
      patch.assetId = args.assetId;
    }
    if (args.bgStyle !== undefined) patch.bgStyle = args.bgStyle;
    if (args.layoutVariant !== undefined) patch.layoutVariant = args.layoutVariant;
    if (args.resetPositions) {
      patch.textX = undefined; patch.textY = undefined; patch.textW = undefined; patch.textH = undefined;
      patch.imageX = undefined; patch.imageY = undefined; patch.imageW = undefined; patch.imageH = undefined;
      patch.subtitleX = undefined; patch.subtitleY = undefined; patch.subtitleW = undefined; patch.subtitleH = undefined;
    } else {
      if (args.textX !== undefined) patch.textX = args.textX;
      if (args.textY !== undefined) patch.textY = args.textY;
      if (args.textW !== undefined) patch.textW = args.textW;
      if (args.textH !== undefined) patch.textH = args.textH;
      if (args.imageX !== undefined) patch.imageX = args.imageX;
      if (args.imageY !== undefined) patch.imageY = args.imageY;
      if (args.imageW !== undefined) patch.imageW = args.imageW;
      if (args.imageH !== undefined) patch.imageH = args.imageH;
      if (args.subtitleX !== undefined) patch.subtitleX = args.subtitleX;
      if (args.subtitleY !== undefined) patch.subtitleY = args.subtitleY;
      if (args.subtitleW !== undefined) patch.subtitleW = args.subtitleW;
      if (args.subtitleH !== undefined) patch.subtitleH = args.subtitleH;
    }
    const nextStart = patch.startMs ?? clip.startMs;
    const nextEnd = patch.endMs ?? clip.endMs;
    if (nextEnd <= nextStart) {
      throw new Error('endMs must be greater than startMs');
    }
    await ctx.db.patch(args.clipId, patch);
  },
});

export const reorderClips = mutation({
  args: {
    projectId: v.id('projects'),
    orderedClipIds: v.array(v.id('timelineClips')),
  },
  handler: async (ctx, args) => {
    await requireProjectOwner(ctx, args.projectId);
    const clips = await ctx.db
      .query('timelineClips')
      .withIndex('by_project_and_order', (q) => q.eq('projectId', args.projectId))
      .take(100);
    const idSet = new Set(clips.map((c) => c._id));
    if (args.orderedClipIds.length !== idSet.size) {
      throw new Error('Clip set mismatch');
    }
    for (const id of args.orderedClipIds) {
      if (!idSet.has(id)) {
        throw new Error('Unknown clip');
      }
    }
    for (let i = 0; i < args.orderedClipIds.length; i++) {
      await ctx.db.patch(args.orderedClipIds[i], { order: i });
    }
  },
});

export const deleteClip = mutation({
  args: { projectId: v.id('projects'), clipId: v.id('timelineClips') },
  handler: async (ctx, args) => {
    await requireProjectOwner(ctx, args.projectId);
    const clip = await ctx.db.get(args.clipId);
    if (!clip || clip.projectId !== args.projectId) {
      throw new Error('Not found');
    }
    await ctx.db.delete(args.clipId);
    const remaining = await ctx.db
      .query('timelineClips')
      .withIndex('by_project_and_order', (q) => q.eq('projectId', args.projectId))
      .order('asc')
      .take(100);
    for (let i = 0; i < remaining.length; i++) {
      if (remaining[i].order !== i) {
        await ctx.db.patch(remaining[i]._id, { order: i });
      }
    }
  },
});
