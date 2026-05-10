'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { Timeline } from './Timeline';
import { ClipEditor } from './ClipEditor';
import { RenderControls } from './RenderControls';
import type { PromoVideoProps, LayoutVariant } from '@/remotion/PromoVideo';
import { PromoVideo as PromoVideoComp } from '@/remotion/PromoVideo';

// Remotion Player expects ComponentType<Record<string, unknown>>
const PromoVideo = PromoVideoComp as React.ComponentType<Record<string, unknown>>;

// Player is browser-only (no SSR)
const Player = dynamic(
  () => import('@remotion/player').then((m) => ({ default: m.Player })),
  { ssr: false },
);

const FPS = 30;

function totalFrames(clips: PromoVideoProps['clips']): number {
  const ms = clips.reduce((s, c) => s + Math.max(1000, c.endMs - c.startMs), 0);
  return Math.max(FPS, Math.round(ms / 1000 * FPS));
}

export function ProjectPageClient({ projectId }: { projectId: Id<'projects'> }) {
  const project = useQuery(api.projects.get, { projectId });
  const clips = useQuery(api.timeline.listClips, { projectId });
  const assets = useQuery(api.assets.listByProject, { projectId });
  const latestOutput = useQuery(api.renders.getLatestOutput, { projectId });
  const musicData = useQuery(api.projects.getMusicData, { projectId });

  const [selectedClipId, setSelectedClipId] = useState<Id<'timelineClips'> | null>(null);
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16'>('16:9');
  const [exporting, setExporting] = useState(false);
  const [exportUrl, setExportUrl] = useState<string | null>(null);

  const genUpload = useMutation(api.assets.generateUploadUrl);
  const setExportOutput = useMutation(api.renders.setExportOutput);

  if (project === undefined) {
    return <PageShell><p className="text-slate-500 text-sm">Loading…</p></PageShell>;
  }
  if (project === null) {
    return (
      <PageShell>
        <p className="text-slate-500">Project not found.</p>
        <Link href="/" className="underline text-sm">← Back</Link>
      </PageShell>
    );
  }

  // Map Convex clips to Remotion PromoClip shape
  const remotionClips: PromoVideoProps['clips'] = (clips ?? []).map((c) => ({
    _id: c._id,
    startMs: c.startMs,
    endMs: c.endMs,
    narrationText: c.narrationText,
    captionText: c.captionText,
    imageUrl: c.imageUrl,
    audioUrl: c.audioUrl,
    bgStyle: c.bgStyle,
    layoutVariant: c.layoutVariant as LayoutVariant | undefined,
    textX: c.textX, textY: c.textY, textW: c.textW, textH: c.textH,
    imageX: c.imageX, imageY: c.imageY, imageW: c.imageW, imageH: c.imageH,
    subtitleX: c.subtitleX, subtitleY: c.subtitleY, subtitleW: c.subtitleW, subtitleH: c.subtitleH,
  }));

  const selectedClip = clips?.find((c) => c._id === selectedClipId) ?? null;
  const hasClips = remotionClips.length > 0;
  const duration = hasClips ? totalFrames(remotionClips) : FPS;
  const [compW, compH] = aspectRatio === '9:16' ? [1080, 1920] : [1920, 1080];

  async function handleExport() {
    if (!hasClips) return;
    setExporting(true);
    setExportUrl(null);
    try {
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clips: remotionClips, aspectRatio }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error((err as { error?: string }).error ?? 'Export failed');
      }
      const blob = await res.blob();

      // Upload the rendered MP4 to Convex storage
      const { uploadUrl } = await genUpload({ projectId });
      const uploadRes = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'video/mp4' },
        body: blob,
      });
      const { storageId } = (await uploadRes.json()) as { storageId: Id<'_storage'> };
      await setExportOutput({ projectId, storageId });

      // Also give the user a local download link
      setExportUrl(URL.createObjectURL(blob));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  return (
    <PageShell>
      <div className="flex items-center gap-3 mb-2">
        <Link href="/" className="text-slate-500 hover:text-foreground text-sm">← Back</Link>
        <h1 className="text-lg font-semibold truncate flex-1">
          {project.title ?? project.sourceUrl}
        </h1>
        <StatusBadge status={project.status} />
        {project.status === 'ready' && (
          <Link
            href={`/project/${projectId}/edit`}
            className="text-xs px-3 py-1 rounded bg-foreground text-background font-medium hover:opacity-90"
          >
            Edit
          </Link>
        )}
      </div>

      <p className="text-xs text-slate-500 truncate">{project.sourceUrl}</p>

      {(project.status === 'draft' || project.status === 'failed') && (
        <>
          {project.status === 'failed' && project.error && (
            <div className="rounded-md bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-700 dark:text-red-300">
              {project.error}
            </div>
          )}
          <RenderControls
            projectId={projectId}
            includeMusic={project.includeMusic}
            musicAssetId={project.musicAssetId}
            label={project.status === 'failed' ? 'Retry generation' : 'Generate video'}
          />
        </>
      )}

      {(project.status === 'queued' || project.status === 'rendering') && (
        <div className="flex items-center gap-3 py-8 justify-center">
          <Spinner />
          <span className="text-slate-500 text-sm capitalize">{project.status}…</span>
        </div>
      )}

      {project.status === 'ready' && (
        <div className="flex flex-col gap-6">
          {/* Live Remotion preview */}
          {hasClips && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-slate-500">Preview</span>
                <div className="flex gap-1 ml-auto">
                  {(['16:9', '9:16'] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setAspectRatio(r)}
                      className={`text-xs px-2 py-0.5 rounded border ${
                        aspectRatio === r
                          ? 'border-foreground bg-foreground text-background'
                          : 'border-slate-300 dark:border-slate-700 text-slate-500'
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              <div
                className="w-full rounded-xl overflow-hidden shadow-lg bg-black"
                style={{ aspectRatio: aspectRatio === '9:16' ? '9/16' : '16/9' }}
              >
                <Player
                  component={PromoVideo}
                  inputProps={{
                    clips: remotionClips,
                    aspectRatio,
                    ...(musicData?.url ? { musicUrl: musicData.url, musicVolume: musicData.gain, musicTrimStartMs: musicData.trimStartMs } : {}),
                  }}
                  durationInFrames={duration}
                  fps={FPS}
                  compositionWidth={compW}
                  compositionHeight={compH}
                  style={{ width: '100%', height: '100%' }}
                  controls
                  loop
                />
              </div>

              {/* Export button */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleExport}
                  disabled={exporting}
                  className="rounded-md bg-foreground text-background px-4 py-2 text-sm font-medium disabled:opacity-50 hover:opacity-90 flex items-center gap-2"
                >
                  {exporting && <Spinner />}
                  {exporting ? 'Exporting…' : 'Export MP4'}
                </button>
                {exportUrl && (
                  <a
                    href={exportUrl}
                    download="promo.mp4"
                    className="text-sm underline text-slate-500 hover:text-foreground"
                  >
                    Download
                  </a>
                )}
                {latestOutput?.url && !exportUrl && (
                  <a
                    href={latestOutput.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm underline text-slate-500 hover:text-foreground"
                  >
                    Previous export
                  </a>
                )}
              </div>
            </div>
          )}

          {clips && clips.length > 0 && (
            <Timeline
              clips={clips}
              projectId={projectId}
              selectedId={selectedClipId}
              onSelect={(id) => setSelectedClipId((prev) => (prev === id ? null : id))}
            />
          )}

          {selectedClip && assets && (
            <ClipEditor
              clip={selectedClip}
              projectId={projectId}
              assets={assets}
              onClose={() => setSelectedClipId(null)}
            />
          )}

          <RenderControls
            projectId={projectId}
            includeMusic={project.includeMusic}
            musicAssetId={project.musicAssetId}
            label="Re-generate (re-scrape + new TTS)"
          />
        </div>
      )}
    </PageShell>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-slate-200 dark:border-slate-800 px-4 py-3">
        <span className="font-semibold tracking-tight">PromoVid</span>
      </header>
      <main className="p-6 md:p-10 max-w-3xl mx-auto flex flex-col gap-6">
        {children}
      </main>
    </>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    draft: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
    queued: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
    rendering: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
    ready: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
    failed: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  };
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full uppercase tracking-wide ${colors[status] ?? ''}`}>
      {status}
    </span>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4 text-current" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
    </svg>
  );
}
