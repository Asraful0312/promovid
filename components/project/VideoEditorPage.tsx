'use client';

import { useCallback, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { PromoVideo as PromoVideoComp, BG_PRESETS, type PromoVideoProps, type LayoutVariant } from '@/remotion/PromoVideo';
import { CanvaEditor, type LiveOverride } from './CanvaEditor';
import React from 'react';

// Player dynamically imported (SSR disabled); cast to `any` to allow callback ref
const Player = dynamic(
  () => import('@remotion/player').then((m) => ({ default: m.Player })),
  { ssr: false },
) as any; // eslint-disable-line @typescript-eslint/no-explicit-any

const PromoVideo = PromoVideoComp as React.ComponentType<Record<string, unknown>>;

const FPS = 30;
const VOICES = [
  { value: 'en-US-AriaNeural', label: 'Aria (US F)' },
  { value: 'en-US-GuyNeural', label: 'Guy (US M)' },
  { value: 'en-GB-SoniaNeural', label: 'Sonia (UK F)' },
  { value: 'en-AU-NatashaNeural', label: 'Natasha (AU F)' },
];

type ClipFromQuery = NonNullable<ReturnType<typeof useQuery<typeof api.timeline.listClips>>>[number];
type LivePos = Record<string, LiveOverride>;

function totalFrames(clips: PromoVideoProps['clips']): number {
  const ms = clips.reduce((s, c) => s + Math.max(1000, c.endMs - c.startMs), 0);
  return Math.max(FPS, Math.round(ms / 1000 * FPS));
}

export function VideoEditorPage({ projectId }: { projectId: Id<'projects'> }) {
  const project = useQuery(api.projects.get, { projectId });
  const clips = useQuery(api.timeline.listClips, { projectId });
  const assets = useQuery(api.assets.listByProject, { projectId });
  const musicData = useQuery(api.projects.getMusicData, { projectId });

  const [selectedId, setSelectedId] = useState<Id<'timelineClips'> | null>(null);
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16'>('16:9');
  const [voice, setVoice] = useState('en-US-AriaNeural');
  const [exporting, setExporting] = useState(false);
  // Live overrides during canvas editing — cleared after each Convex commit
  const [livePos, setLivePos] = useState<LivePos>({});

  const genUpload = useMutation(api.assets.generateUploadUrl);
  const setExportOutput = useMutation(api.renders.setExportOutput);
  const setMusic = useMutation(api.projects.setMusic);
  const enqueue = useMutation(api.renders.enqueue);
  const musicFileRef = useRef<HTMLInputElement>(null);
  const genUploadAsset = useMutation(api.assets.generateUploadUrl);
  const finalizeUpload = useMutation(api.assets.finalizeUpload);

  // Keep a mutable ref to always-current clips for the player frame callback
  const remotionClipsRef = useRef<PromoVideoProps['clips']>([]);

  // Auto-select clip sidebar when playback passes into a new clip
  const playerRefCallback = useCallback((player: unknown) => {
    if (!player) return;
    const p = player as { addEventListener: (e: string, h: (d: any) => void) => void };
    let playing = false;
    p.addEventListener('play', () => { playing = true; });
    p.addEventListener('pause', () => { playing = false; });
    p.addEventListener('frameupdate', (e: { detail: { frame: number } }) => {
      if (!playing) return;
      const frame = e.detail.frame;
      let f = 0;
      for (const clip of remotionClipsRef.current) {
        const frames = Math.max(1, Math.round(Math.max(1000, clip.endMs - clip.startMs) / 1000 * FPS));
        if (frame >= f && frame < f + frames) {
          setSelectedId((prev) => prev === clip._id ? prev : clip._id as Id<'timelineClips'>);
          break;
        }
        f += frames;
      }
    });
  }, []);

  if (!project || !clips) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#111]">
        <span className="text-slate-400 text-sm">Loading…</span>
      </div>
    );
  }

  // Build remotionClips merging stored values with live canvas overrides
  const remotionClips: PromoVideoProps['clips'] = clips.map((c) => {
    const ov = livePos[c._id] ?? {};
    return {
      _id: c._id,
      startMs: c.startMs, endMs: c.endMs,
      narrationText: c.narrationText, captionText: c.captionText,
      imageUrl: c.imageUrl, audioUrl: c.audioUrl,
      bgStyle: c.bgStyle, layoutVariant: c.layoutVariant as LayoutVariant | undefined,
      textX: ov.text?.x ?? c.textX, textY: ov.text?.y ?? c.textY,
      textW: ov.text?.w ?? c.textW, textH: ov.text?.h ?? c.textH,
      imageX: ov.image?.x ?? c.imageX, imageY: ov.image?.y ?? c.imageY,
      imageW: ov.image?.w ?? c.imageW, imageH: ov.image?.h ?? c.imageH,
      subtitleX: ov.subtitle?.x ?? c.subtitleX, subtitleY: ov.subtitle?.y ?? c.subtitleY,
      subtitleW: ov.subtitle?.w ?? c.subtitleW, subtitleH: ov.subtitle?.h ?? c.subtitleH,
    };
  });
  remotionClipsRef.current = remotionClips; // keep ref current for player callback

  const selectedClip = clips.find((c) => c._id === selectedId) ?? null;
  const selectedLiveOverride: LiveOverride = selectedId ? (livePos[selectedId] ?? {}) : {};
  const duration = totalFrames(remotionClips);
  const [compW, compH] = aspectRatio === '9:16' ? [1080, 1920] : [1920, 1080];

  const musicAsset = assets?.find((a) => a._id === project.musicAssetId) as
    | { _id: Id<'assets'>; url: string | null; kind: string; label?: string } | undefined;

  const playerInputProps: Record<string, unknown> = {
    clips: remotionClips, aspectRatio,
    ...(musicData?.url ? { musicUrl: musicData.url, musicVolume: musicData.gain, musicTrimStartMs: musicData.trimStartMs } : {}),
  };

  async function handleExport() {
    setExporting(true);
    try {
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clips: remotionClips, aspectRatio,
          ...(musicData?.url ? { musicUrl: musicData.url, musicVolume: musicData.gain, musicTrimStartMs: musicData.trimStartMs } : {}),
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Export failed');
      const blob = await res.blob();
      const { uploadUrl } = await genUpload({ projectId });
      const up = await fetch(uploadUrl, { method: 'POST', headers: { 'Content-Type': 'video/mp4' }, body: blob });
      const { storageId } = (await up.json()) as { storageId: Id<'_storage'> };
      await setExportOutput({ projectId, storageId });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'promo.mp4';
      a.click();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  async function handleMusicUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const { uploadUrl } = await genUploadAsset({ projectId });
    const res = await fetch(uploadUrl, { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
    const { storageId } = (await res.json()) as { storageId: Id<'_storage'> };
    const assetId = await finalizeUpload({ projectId, storageId, kind: 'music', label: file.name });
    await setMusic({ projectId, musicAssetId: assetId, includeMusic: true });
  }

  return (
    <div className="flex flex-col h-screen bg-[#111] text-white overflow-hidden">
      {/* ── Top Bar ── */}
      <div className="flex items-center gap-3 px-4 h-12 border-b border-white/10 bg-[#1a1a1a] shrink-0">
        <Link href={`/project/${projectId}`} className="text-slate-400 hover:text-white text-sm">← Back</Link>
        <span className="text-white font-semibold text-sm truncate max-w-[220px]">
          {project.title ?? project.sourceUrl}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex gap-1">
            {(['16:9', '9:16'] as const).map((r) => (
              <button key={r} type="button" onClick={() => setAspectRatio(r)}
                className={`text-xs px-2 py-1 rounded border transition-colors ${aspectRatio === r ? 'border-white bg-white text-black font-semibold' : 'border-white/20 text-slate-400 hover:border-white/50'}`}>
                {r}
              </button>
            ))}
          </div>
          <select value={voice} onChange={(e) => setVoice(e.target.value)}
            className="text-xs bg-[#2a2a2a] border border-white/20 rounded px-2 py-1 text-slate-300">
            {VOICES.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
          </select>
          <button type="button" onClick={() => musicFileRef.current?.click()}
            className="text-xs px-2 py-1 rounded border border-white/20 text-slate-400 hover:border-white/50 hover:text-white">
            + Music
          </button>
          <input ref={musicFileRef} type="file" accept="audio/*" className="hidden" onChange={handleMusicUpload} />
          <button type="button" onClick={() => enqueue({ projectId, params: { voice, aspectRatio } })}
            className="text-xs px-3 py-1 rounded border border-white/20 text-slate-400 hover:text-white hover:border-white/50">
            Re-generate
          </button>
          <button type="button" onClick={handleExport} disabled={exporting || remotionClips.length === 0}
            className="text-xs px-4 py-1.5 rounded bg-white text-black font-semibold hover:bg-slate-200 disabled:opacity-50 flex items-center gap-1.5">
            {exporting && <Spinner />}
            {exporting ? 'Exporting…' : 'Export MP4'}
          </button>
        </div>
      </div>

      {/* ── Main Area ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── Left: Clip List ── */}
        <div className="w-52 shrink-0 bg-[#161616] border-r border-white/10 flex flex-col overflow-hidden">
          <div className="px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wider border-b border-white/10">
            Clips — {clips.length}
          </div>
          <div className="flex-1 overflow-y-auto py-1">
            {clips.map((clip, idx) => (
              <button key={clip._id} type="button" onClick={() => setSelectedId(clip._id)}
                className={`w-full text-left px-2 py-2 flex gap-2 items-start hover:bg-white/5 transition-colors ${selectedId === clip._id ? 'bg-white/10' : ''}`}>
                <div className="w-14 h-9 rounded overflow-hidden shrink-0" style={{
                  background: `linear-gradient(135deg, ${(BG_PRESETS[clip.bgStyle ?? 'ocean'] ?? BG_PRESETS.ocean)[0]}, ${(BG_PRESETS[clip.bgStyle ?? 'ocean'] ?? BG_PRESETS.ocean)[1]})`,
                }}>
                  {clip.imageUrl && <img src={clip.imageUrl} alt="" className="w-full h-full object-cover object-top opacity-80" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] text-slate-500">{idx + 1} · {((clip.endMs - clip.startMs) / 1000).toFixed(1)}s</div>
                  <div className="text-[11px] text-slate-300 line-clamp-2 leading-snug mt-0.5">
                    {clip.captionText || clip.narrationText}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* ── Center: Player + Canvas Editor ── */}
        <div className="flex-1 flex flex-col items-center justify-center bg-[#111] overflow-hidden p-4 gap-2">
          {selectedClip && (
            <div className="flex items-center gap-3 text-[11px] text-slate-500 self-start px-1">
              <span className="text-slate-600">Click element to select · Drag to move · Drag corner to resize · Double-click text to edit</span>
            </div>
          )}
          <div className="relative w-full rounded-xl overflow-hidden shadow-2xl bg-black"
            style={{ maxWidth: aspectRatio === '9:16' ? 360 : '100%', aspectRatio: aspectRatio === '9:16' ? '9/16' : '16/9' }}>
            {remotionClips.length > 0 ? (
              <Player
                ref={playerRefCallback}
                component={PromoVideo}
                inputProps={playerInputProps}
                durationInFrames={duration}
                fps={FPS}
                compositionWidth={compW}
                compositionHeight={compH}
                style={{ width: '100%', height: '100%' }}
                controls
                loop
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-slate-500 text-sm">
                No clips yet — generate a video first
              </div>
            )}

            {selectedClip && remotionClips.length > 0 && (
              <CanvaEditor
                clip={selectedClip}
                projectId={projectId}
                liveOverride={selectedLiveOverride}
                onLiveChange={(override) => setLivePos((prev) => ({ ...prev, [selectedClip._id]: override }))}
                onCommit={() => setLivePos((prev) => { const n = { ...prev }; delete n[selectedClip._id]; return n; })}
              />
            )}
          </div>
        </div>

        {/* ── Right: Properties + Music ── */}
        <div className="w-72 shrink-0 bg-[#161616] border-l border-white/10 flex flex-col overflow-hidden">
          <div className="px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider border-b border-white/10">
            {selectedClip ? `Clip ${clips.indexOf(selectedClip) + 1} Properties` : 'Select a clip'}
          </div>
          <div className="flex-1 overflow-y-auto flex flex-col">
            {selectedClip ? (
              <ClipProperties clip={selectedClip} projectId={projectId} assets={assets ?? []} clips={clips} />
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-slate-600 text-xs text-center px-4">Click a clip in the list to edit its properties</p>
              </div>
            )}
            <div className="border-t border-white/10 mt-auto">
              <MusicPanel
                projectId={projectId}
                musicAsset={musicAsset}
                includeMusic={project.includeMusic}
                musicGain={project.musicGain}
                musicTrimStartMs={project.musicTrimStartMs}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Music Panel ──────────────────────────────────────────────────────────────

function MusicPanel({
  projectId, musicAsset, includeMusic, musicGain, musicTrimStartMs,
}: {
  projectId: Id<'projects'>;
  musicAsset: { _id: Id<'assets'>; label?: string } | undefined;
  includeMusic: boolean;
  musicGain: number | undefined;
  musicTrimStartMs: number | undefined;
}) {
  const setMusicSettings = useMutation(api.projects.setMusicSettings);
  const setMusic = useMutation(api.projects.setMusic);
  const [gain, setGain] = useState(musicGain ?? 0.3);
  const [trimStart, setTrimStart] = useState((musicTrimStartMs ?? 0) / 1000);
  const prevId = useRef(musicAsset?._id);
  if (prevId.current !== musicAsset?._id) {
    prevId.current = musicAsset?._id;
    setGain(musicGain ?? 0.3);
    setTrimStart((musicTrimStartMs ?? 0) / 1000);
  }

  if (!musicAsset) {
    return <div className="px-4 py-3 text-[11px] text-slate-600 italic">No music — click "+ Music" to upload</div>;
  }

  return (
    <div className="px-4 py-3 flex flex-col gap-3">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Background Music</span>
      <div className="flex items-center gap-2">
        <span className="flex-1 text-[11px] text-slate-400 truncate" title={musicAsset.label ?? 'Music'}>{musicAsset.label ?? 'Music'}</span>
        <button type="button"
          onClick={() => setMusicSettings({ projectId, includeMusic: !includeMusic })}
          className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${includeMusic ? 'border-white/40 bg-white/15 text-white' : 'border-white/15 text-slate-500 hover:border-white/30'}`}>
          {includeMusic ? 'On' : 'Off'}
        </button>
        <button type="button" onClick={() => setMusic({ projectId, musicAssetId: null, includeMusic: false })}
          className="text-slate-500 hover:text-red-400 text-sm leading-none" title="Remove">✕</button>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] text-slate-500">Volume: {Math.round(gain * 100)}%</span>
        <input type="range" min={0} max={1} step={0.01} value={gain}
          onChange={(e) => setGain(parseFloat(e.target.value))}
          onMouseUp={() => setMusicSettings({ projectId, gain })}
          className="w-full h-1 rounded accent-white cursor-pointer" />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] text-slate-500">Trim start: {trimStart.toFixed(1)}s</span>
        <input type="range" min={0} max={120} step={0.5} value={trimStart}
          onChange={(e) => setTrimStart(parseFloat(e.target.value))}
          onMouseUp={() => setMusicSettings({ projectId, trimStartMs: Math.round(trimStart * 1000) })}
          className="w-full h-1 rounded accent-white cursor-pointer" />
      </div>
    </div>
  );
}

// ─── Clip Properties Panel ────────────────────────────────────────────────────

function ClipProperties({
  clip, projectId, assets, clips,
}: {
  clip: ClipFromQuery;
  projectId: Id<'projects'>;
  assets: Array<{ _id: Id<'assets'>; url: string | null; kind: string }>;
  clips: ClipFromQuery[];
}) {
  const updateClip = useMutation(api.timeline.updateClip);
  const deleteClip = useMutation(api.timeline.deleteClip);
  const reorder = useMutation(api.timeline.reorderClips);
  const genUpload = useMutation(api.assets.generateUploadUrl);
  const finalizeUpload = useMutation(api.assets.finalizeUpload);
  const fileRef = useRef<HTMLInputElement>(null);

  const [narration, setNarration] = useState(clip.narrationText);
  const [caption, setCaption] = useState(clip.captionText);
  const [dur, setDur] = useState(((clip.endMs - clip.startMs) / 1000).toFixed(1));
  const [uploading, setUploading] = useState(false);

  const prevId = useRef(clip._id);
  if (prevId.current !== clip._id) {
    prevId.current = clip._id;
    setNarration(clip.narrationText);
    setCaption(clip.captionText);
    setDur(((clip.endMs - clip.startMs) / 1000).toFixed(1));
  }

  async function save(overrides?: Partial<Parameters<typeof updateClip>[0]>) {
    const d = Math.max(1, parseFloat(dur) || 3);
    await updateClip({ projectId, clipId: clip._id, narrationText: narration, captionText: caption, endMs: clip.startMs + Math.round(d * 1000), ...overrides });
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { uploadUrl } = await genUpload({ projectId });
      const res = await fetch(uploadUrl, { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
      const { storageId } = (await res.json()) as { storageId: Id<'_storage'> };
      const assetId = await finalizeUpload({ projectId, storageId, kind: 'upload' });
      await updateClip({ projectId, clipId: clip._id, assetId });
    } finally {
      setUploading(false);
    }
  }

  const idx = clips.indexOf(clip);
  const imageAssets = assets.filter((a) => a.kind === 'screenshot' || a.kind === 'upload');
  const currentLayout = (clip.layoutVariant ?? 'text-left') as LayoutVariant;
  const currentBg = clip.bgStyle ?? 'ocean';
  const hasOverrides = clip.textX !== undefined || clip.textY !== undefined || clip.textW !== undefined ||
    clip.imageX !== undefined || clip.imageY !== undefined || clip.subtitleY !== undefined;

  const LAYOUT_OPTIONS: { value: LayoutVariant; label: string; icon: string }[] = [
    { value: 'text-left', label: 'Text Left', icon: '▐' },
    { value: 'text-right', label: 'Text Right', icon: '▌' },
    { value: 'fullscreen', label: 'Full Screen', icon: '▣' },
  ];

  return (
    <div className="flex-1 overflow-y-auto flex flex-col gap-0 divide-y divide-white/5">
      <Section label="Order">
        <div className="flex gap-2">
          <button type="button" disabled={idx === 0}
            onClick={() => { const ids = clips.map(c => c._id); [ids[idx-1], ids[idx]] = [ids[idx], ids[idx-1]]; reorder({ projectId, orderedClipIds: ids }); }}
            className="flex-1 py-1.5 rounded bg-white/8 text-xs text-slate-300 hover:bg-white/15 disabled:opacity-25">← Move Left</button>
          <button type="button" disabled={idx === clips.length - 1}
            onClick={() => { const ids = clips.map(c => c._id); [ids[idx], ids[idx+1]] = [ids[idx+1], ids[idx]]; reorder({ projectId, orderedClipIds: ids }); }}
            className="flex-1 py-1.5 rounded bg-white/8 text-xs text-slate-300 hover:bg-white/15 disabled:opacity-25">Move Right →</button>
        </div>
      </Section>

      <Section label="Layout">
        <div className="grid grid-cols-3 gap-1.5">
          {LAYOUT_OPTIONS.map((opt) => (
            <button key={opt.value} type="button"
              onClick={() => updateClip({ projectId, clipId: clip._id, layoutVariant: opt.value })}
              className={`flex flex-col items-center gap-1 py-2 rounded border text-xs transition-colors ${currentLayout === opt.value ? 'border-white bg-white/15 text-white' : 'border-white/15 text-slate-400 hover:border-white/30'}`}>
              <span className="text-lg">{opt.icon}</span>
              <span>{opt.label}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section label="Background">
        <div className="flex gap-2 flex-wrap">
          {Object.entries(BG_PRESETS).map(([key, [from, to]]) => (
            <button key={key} type="button" title={key}
              onClick={() => updateClip({ projectId, clipId: clip._id, bgStyle: key })}
              className={`w-8 h-8 rounded-full border-2 transition-transform hover:scale-110 ${currentBg === key ? 'border-white scale-110' : 'border-transparent'}`}
              style={{ background: `linear-gradient(135deg, ${from}, ${to})` }} />
          ))}
        </div>
        <p className="text-[10px] text-slate-600 mt-1 capitalize">{currentBg}</p>
      </Section>

      <Section label="Screenshot / Image">
        <div className="flex items-center justify-between mb-2">
          <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
            className="text-xs underline text-slate-400 hover:text-white disabled:opacity-50">
            {uploading ? 'Uploading…' : '+ Upload image'}
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
        </div>
        <div className="flex gap-2 flex-wrap">
          {imageAssets.slice(0, 12).map((a) => (
            <button key={a._id} type="button"
              onClick={() => updateClip({ projectId, clipId: clip._id, assetId: a._id })}
              className={`rounded-md overflow-hidden border-2 transition-all ${a._id === clip.assetId ? 'border-white' : 'border-transparent hover:border-white/40'}`}>
              {a.url && <img src={a.url} alt="" className="w-20 h-12 object-cover object-top" />}
            </button>
          ))}
        </div>
      </Section>

      <Section label="Headline (Caption)">
        <input value={caption} onChange={(e) => setCaption(e.target.value)} onBlur={() => save()}
          placeholder="Short headline, 4–6 words"
          className="w-full rounded bg-white/8 border border-white/10 px-2.5 py-1.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-white/30" />
      </Section>

      <Section label="Narration (Subtitle)">
        <textarea value={narration} onChange={(e) => setNarration(e.target.value)} onBlur={() => save()} rows={3}
          placeholder="Spoken narration text…"
          className="w-full rounded bg-white/8 border border-white/10 px-2.5 py-1.5 text-sm text-white placeholder:text-slate-600 resize-none focus:outline-none focus:border-white/30" />
      </Section>

      <Section label="Duration (seconds)">
        <input type="number" min={1} max={30} step={0.5} value={dur}
          onChange={(e) => setDur(e.target.value)} onBlur={() => save()}
          className="w-full rounded bg-white/8 border border-white/10 px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-white/30" />
      </Section>

      {hasOverrides && (
        <Section label="Element Layout">
          <p className="text-[10px] text-slate-500">Elements repositioned. Drag boxes on the preview to adjust.</p>
          <button type="button"
            onClick={() => updateClip({ projectId, clipId: clip._id, resetPositions: true })}
            className="text-[11px] text-slate-400 hover:text-white underline mt-1">Reset to defaults</button>
        </Section>
      )}

      <div className="px-4 py-4">
        <button type="button"
          onClick={async () => { if (!confirm('Delete this clip?')) return; await deleteClip({ projectId, clipId: clip._id }); }}
          className="text-xs text-red-400 hover:text-red-300">Delete clip</button>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-3 flex flex-col gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</span>
      {children}
    </div>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
    </svg>
  );
}
