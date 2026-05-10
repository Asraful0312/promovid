'use client';

import { useRef, useState } from 'react';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';

const BG_PRESETS = [
  { key: 'ocean',    label: 'Ocean',    from: '#0a1628', to: '#1a3a5c' },
  { key: 'purple',   label: 'Purple',   from: '#1a0035', to: '#5b21b6' },
  { key: 'midnight', label: 'Night',    from: '#0d0d1a', to: '#1e1b4b' },
  { key: 'forest',   label: 'Forest',   from: '#0a1f0a', to: '#14532d' },
  { key: 'fire',     label: 'Fire',     from: '#1c0500', to: '#7c2d12' },
  { key: 'sunset',   label: 'Sunset',   from: '#1a0a00', to: '#78350f' },
  { key: 'slate',    label: 'Slate',    from: '#0f172a', to: '#1e293b' },
] as const;

interface Clip {
  _id: Id<'timelineClips'>;
  order: number;
  startMs: number;
  endMs: number;
  narrationText: string;
  captionText: string;
  assetId: Id<'assets'>;
  imageUrl: string | null;
  audioUrl: string | null;
  bgStyle?: string;
}

interface Props {
  clip: Clip;
  projectId: Id<'projects'>;
  assets: Array<{ _id: Id<'assets'>; url: string | null; kind: string }>;
  onClose: () => void;
}

export function ClipEditor({ clip, projectId, assets, onClose }: Props) {
  const [narration, setNarration]     = useState(clip.narrationText);
  const [caption, setCaption]         = useState(clip.captionText);
  const [durationSec, setDurationSec] = useState(((clip.endMs - clip.startMs) / 1000).toFixed(1));
  const [uploading, setUploading]     = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const updateClip     = useMutation(api.timeline.updateClip);
  const deleteClip     = useMutation(api.timeline.deleteClip);
  const genUpload      = useMutation(api.assets.generateUploadUrl);
  const finalizeUpload = useMutation(api.assets.finalizeUpload);

  async function saveText() {
    const dur = Math.max(1, parseFloat(durationSec) || 3);
    await updateClip({
      projectId,
      clipId: clip._id,
      narrationText: narration,
      captionText: caption,
      endMs: clip.startMs + Math.round(dur * 1000),
    });
  }

  async function handleBgChange(key: string) {
    await updateClip({ projectId, clipId: clip._id, bgStyle: key });
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { uploadUrl } = await genUpload({ projectId });
      const res = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'image/png' },
        body: file,
      });
      const { storageId } = await res.json() as { storageId: Id<'_storage'> };
      const assetId = await finalizeUpload({ projectId, storageId, kind: 'upload' });
      await updateClip({ projectId, clipId: clip._id, assetId });
    } finally {
      setUploading(false);
    }
  }

  const imageAssets = assets.filter((a) => a.kind === 'screenshot' || a.kind === 'upload');
  const currentBg = clip.bgStyle ?? 'ocean';

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-4 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">Edit clip {clip.order + 1}</h3>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-foreground text-xl leading-none">×</button>
      </div>

      {/* Narration */}
      <label className="flex flex-col gap-1">
        <span className="text-xs text-slate-500">Narration</span>
        <textarea
          value={narration}
          onChange={(e) => setNarration(e.target.value)}
          onBlur={saveText}
          rows={3}
          className="rounded border border-slate-300 dark:border-slate-700 bg-transparent px-2 py-1.5 text-sm resize-none"
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">Caption</span>
          <input
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            onBlur={saveText}
            className="rounded border border-slate-300 dark:border-slate-700 bg-transparent px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">Duration (sec)</span>
          <input
            type="number" min={1} max={30} step={0.5}
            value={durationSec}
            onChange={(e) => setDurationSec(e.target.value)}
            onBlur={saveText}
            className="rounded border border-slate-300 dark:border-slate-700 bg-transparent px-2 py-1.5 text-sm"
          />
        </label>
      </div>

      {/* Background picker */}
      <div className="flex flex-col gap-2">
        <span className="text-xs text-slate-500">Background</span>
        <div className="flex gap-2 flex-wrap">
          {BG_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              title={p.label}
              onClick={() => handleBgChange(p.key)}
              className={`w-8 h-8 rounded-full border-2 transition-transform hover:scale-110 ${
                currentBg === p.key ? 'border-white scale-110' : 'border-transparent'
              }`}
              style={{ background: `linear-gradient(135deg, ${p.from}, ${p.to})` }}
            />
          ))}
        </div>
        <p className="text-[11px] text-slate-400">
          {BG_PRESETS.find((p) => p.key === currentBg)?.label ?? 'Ocean'} — re-render to apply
        </p>
      </div>

      {/* Image picker */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500">Image</span>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="text-xs underline text-slate-500 hover:text-foreground disabled:opacity-50"
          >
            {uploading ? 'Uploading…' : 'Upload new'}
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
        </div>
        <div className="flex gap-2 flex-wrap">
          {imageAssets.slice(0, 8).map((a) => (
            <button
              key={a._id}
              type="button"
              onClick={() => updateClip({ projectId, clipId: clip._id, assetId: a._id })}
              className={`rounded overflow-hidden border-2 ${
                a._id === clip.assetId ? 'border-white' : 'border-transparent'
              }`}
            >
              {a.url && <img src={a.url} alt="" className="w-20 h-12 object-cover" />}
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={async () => {
          if (!confirm('Delete this clip?')) return;
          await deleteClip({ projectId, clipId: clip._id });
          onClose();
        }}
        className="text-xs text-red-500 hover:text-red-700 text-left"
      >
        Delete clip
      </button>
    </div>
  );
}
