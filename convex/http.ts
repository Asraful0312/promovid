import { httpRouter } from 'convex/server';
import { httpAction } from './_generated/server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';

const MAX_SKEW_MS = 5 * 60 * 1000;

function hexFromBuffer(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function verifyWorkerSignature(req: Request, rawBody: string): Promise<boolean> {
  const secret = process.env.WORKER_SHARED_SECRET;
  if (!secret) {
    return false;
  }
  const ts = req.headers.get('X-Worker-Timestamp');
  const sig = req.headers.get('X-Worker-Signature');
  if (!ts || !sig) {
    return false;
  }
  const t = Number(ts);
  if (!Number.isFinite(t) || Math.abs(Date.now() - t) > MAX_SKEW_MS) {
    return false;
  }
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(`${ts}.${rawBody}`));
  return hexFromBuffer(mac) === sig;
}

const http = httpRouter();

http.route({
  path: '/worker/issue-upload',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const rawBody = await request.text();
    if (!(await verifyWorkerSignature(request, rawBody))) {
      return new Response('Unauthorized', { status: 401 });
    }
    let body: { renderId?: string };
    try {
      body = JSON.parse(rawBody) as { renderId?: string };
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }
    if (!body.renderId) {
      return new Response('renderId required', { status: 400 });
    }
    try {
      const result: { uploadUrl: string } = await ctx.runMutation(internal.worker.issueUpload, {
        renderId: body.renderId as Id<'renders'>,
        contentType: undefined,
      });
      return Response.json(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Bad request';
      return new Response(msg, { status: 400 });
    }
  }),
});

http.route({
  path: '/worker/complete',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const rawBody = await request.text();
    if (!(await verifyWorkerSignature(request, rawBody))) {
      return new Response('Unauthorized', { status: 401 });
    }
    let body: {
      renderId?: string;
      outputStorageId?: string;
      clips?: Array<{
        order: number;
        startMs: number;
        endMs: number;
        narrationText: string;
        captionText: string;
        imageStorageId: string;
        audioStorageId?: string;
        bgStyle?: string;
      }>;
    };
    try {
      body = JSON.parse(rawBody);
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }
    if (!body.renderId || !Array.isArray(body.clips)) {
      return new Response('Invalid body', { status: 400 });
    }
    try {
      await ctx.runMutation(internal.worker.complete, {
        renderId: body.renderId as Id<'renders'>,
        outputStorageId: body.outputStorageId as Id<'_storage'> | undefined,
        clips: body.clips as Array<{
          order: number;
          startMs: number;
          endMs: number;
          narrationText: string;
          captionText: string;
          imageStorageId: Id<'_storage'>;
          audioStorageId?: Id<'_storage'>;
          bgStyle?: string;
        }>,
      });
      return new Response(null, { status: 204 });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Bad request';
      return new Response(msg, { status: 400 });
    }
  }),
});

http.route({
  path: '/worker/fail',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const rawBody = await request.text();
    if (!(await verifyWorkerSignature(request, rawBody))) {
      return new Response('Unauthorized', { status: 401 });
    }
    let body: { renderId?: string; error?: string };
    try {
      body = JSON.parse(rawBody);
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }
    if (!body.renderId || typeof body.error !== 'string') {
      return new Response('Invalid body', { status: 400 });
    }
    try {
      await ctx.runMutation(internal.worker.fail, {
        renderId: body.renderId as Id<'renders'>,
        error: body.error,
      });
      return new Response(null, { status: 204 });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Bad request';
      return new Response(msg, { status: 400 });
    }
  }),
});

export default http;
