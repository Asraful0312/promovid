import { v } from 'convex/values';
import { internalAction } from './_generated/server';
import { internal } from './_generated/api';

export const kickoffWorker = internalAction({
  args: { renderId: v.id('renders') },
  handler: async (ctx, args) => {
    const secret = process.env.WORKER_SHARED_SECRET;
    const workerUrl = process.env.WORKER_URL;
    const convexSiteUrl = process.env.CONVEX_SITE_URL ?? '';

    if (!secret || !workerUrl) {
      await ctx.runMutation(internal.renders.markRenderFailed, {
        renderId: args.renderId,
        error: 'Server misconfigured: set WORKER_URL and WORKER_SHARED_SECRET on Convex',
      });
      return;
    }

    const payload = await ctx.runQuery(internal.renders.getKickoffPayload, {
      renderId: args.renderId,
    });

    if (!payload) {
      return;
    }

    await ctx.runMutation(internal.renders.markRenderRendering, { renderId: args.renderId });

    const body = {
      ...payload,
      convexSiteUrl,
    };

    try {
      const res = await fetch(`${workerUrl.replace(/\/$/, '')}/jobs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${secret}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        await ctx.runMutation(internal.renders.markRenderFailed, {
          renderId: args.renderId,
          error: `Worker HTTP ${res.status}: ${text.slice(0, 400)}`,
        });
      }
    } catch (e) {
      await ctx.runMutation(internal.renders.markRenderFailed, {
        renderId: args.renderId,
        error: e instanceof Error ? e.message : 'Worker fetch failed',
      });
    }
  },
});
