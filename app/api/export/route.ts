import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { existsSync, unlinkSync } from 'fs';
import { readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import type { PromoVideoProps } from '@/remotion/PromoVideo';

// Cache the bundle URL across hot reloads (dev) and requests (prod)
let _bundleUrl: string | null = null;
let _bundling: Promise<string> | null = null;

async function getBundleUrl(): Promise<string> {
  if (_bundleUrl) return _bundleUrl;
  if (_bundling) return _bundling;
  _bundling = bundle({ entryPoint: resolve('./remotion/index.ts') }).then((url) => {
    _bundleUrl = url;
    _bundling = null;
    return url;
  });
  return _bundling;
}

function findChrome(): string | undefined {
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    process.env.CHROME_PATH,
  ];
  return candidates.find((p) => p && existsSync(p));
}

export const maxDuration = 300; // 5 min timeout for Vercel/Railway

export async function POST(req: Request) {
  let outPath: string | null = null;
  try {
    const { clips, aspectRatio = '16:9', musicUrl, musicVolume, musicTrimStartMs } = (await req.json()) as {
      clips: PromoVideoProps['clips'];
      aspectRatio?: '16:9' | '9:16';
      musicUrl?: string;
      musicVolume?: number;
      musicTrimStartMs?: number;
    };

    if (!Array.isArray(clips) || clips.length === 0) {
      return Response.json({ error: 'No clips provided' }, { status: 400 });
    }

    const compositionId = aspectRatio === '9:16' ? 'PromoVideo916' : 'PromoVideo';
    const inputProps: PromoVideoProps = {
      clips, aspectRatio,
      ...(musicUrl ? { musicUrl, musicVolume, musicTrimStartMs } : {}),
    };

    const serveUrl = await getBundleUrl();

    const chromePath = findChrome();

    const composition = await selectComposition({
      serveUrl,
      id: compositionId,
      inputProps,
      browserExecutable: chromePath,
    });

    outPath = join(tmpdir(), `remotion_export_${Date.now()}.mp4`);

    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      outputLocation: outPath,
      inputProps,
      browserExecutable: chromePath,
      timeoutInMilliseconds: 240_000,
    });

    const buffer = await readFile(outPath);
    return new Response(buffer, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Disposition': 'attachment; filename="promo.mp4"',
      },
    });
  } catch (err) {
    console.error('[export]', err);
    return Response.json(
      { error: err instanceof Error ? err.message : 'Render failed' },
      { status: 500 },
    );
  } finally {
    if (outPath && existsSync(outPath)) unlinkSync(outPath);
  }
}
