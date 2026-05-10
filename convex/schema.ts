import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

const projectStatus = v.union(
  v.literal('draft'),
  v.literal('queued'),
  v.literal('rendering'),
  v.literal('ready'),
  v.literal('failed'),
);

const renderStatus = v.union(
  v.literal('queued'),
  v.literal('rendering'),
  v.literal('succeeded'),
  v.literal('failed'),
);

const assetKind = v.union(
  v.literal('screenshot'),
  v.literal('upload'),
  v.literal('audio'),
  v.literal('music'),
  v.literal('render'),
);

const renderParams = v.object({
  voice: v.optional(v.string()),
  aspectRatio: v.optional(v.union(v.literal('16:9'), v.literal('9:16'))),
  musicGain: v.optional(v.number()),
});

export default defineSchema({
  projects: defineTable({
    ownerTokenIdentifier: v.string(),
    sourceUrl: v.string(),
    title: v.optional(v.string()),
    status: projectStatus,
    error: v.optional(v.string()),
    latestRenderId: v.optional(v.id('renders')),
    musicAssetId: v.optional(v.id('assets')),
    includeMusic: v.boolean(),
    musicGain: v.optional(v.number()),
    musicTrimStartMs: v.optional(v.number()),
  }).index('by_owner_token', ['ownerTokenIdentifier']),

  renders: defineTable({
    projectId: v.id('projects'),
    version: v.number(),
    status: renderStatus,
    params: renderParams,
    outputStorageId: v.optional(v.id('_storage')),
    error: v.optional(v.string()),
    log: v.optional(v.string()),
  })
    .index('by_project', ['projectId'])
    .index('by_project_and_version', ['projectId', 'version']),

  assets: defineTable({
    projectId: v.id('projects'),
    kind: assetKind,
    storageId: v.id('_storage'),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    label: v.optional(v.string()),
    sourceOrder: v.optional(v.number()),
  }).index('by_project', ['projectId']),

  timelineClips: defineTable({
    projectId: v.id('projects'),
    order: v.number(),
    startMs: v.number(),
    endMs: v.number(),
    narrationText: v.string(),
    captionText: v.string(),
    assetId: v.id('assets'),
    audioStorageId: v.optional(v.id('_storage')),
    transition: v.optional(v.string()),
    bgStyle: v.optional(v.string()),
    layoutVariant: v.optional(v.string()),
    // Element bounds as percentages (0–100) of the composition dimensions
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
  }).index('by_project_and_order', ['projectId', 'order']),
});
