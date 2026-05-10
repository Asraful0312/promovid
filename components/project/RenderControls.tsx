'use client';

import { useRef, useState } from 'react';
import type { Id } from '@/convex/_generated/dataModel';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

const VOICES = [
  { value: 'en-US-AriaNeural', label: 'Aria – US Female' },
  { value: 'en-US-GuyNeural', label: 'Guy – US Male' },
  { value: 'en-GB-SoniaNeural', label: 'Sonia – UK Female' },
  { value: 'en-AU-NatashaNeural', label: 'Natasha – AU Female' },
];

interface Props {
  projectId: Id<'projects'>;
  includeMusic: boolean;
  musicAssetId?: Id<'assets'> | null;
  disabled?: boolean;
  label?: string;
}

export function RenderControls({ projectId, includeMusic, musicAssetId, disabled, label }: Props) {
  const [voice, setVoice] = useState('en-US-AriaNeural');
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16'>('16:9');
  const [musicEnabled, setMusicEnabled] = useState(includeMusic);
  const [musicGain, setMusicGain] = useState(0.3);
  const [uploading, setUploading] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);

  const enqueue = useMutation(api.renders.enqueue);
  const genUpload = useMutation(api.assets.generateUploadUrl);
  const finalizeUpload = useMutation(api.assets.finalizeUpload);
  const setMusic = useMutation(api.projects.setMusic);

  async function handleMusicUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { uploadUrl } = await genUpload({ projectId });
      const res = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'audio/mpeg' },
        body: file,
      });
      const { storageId } = await res.json() as { storageId: Id<'_storage'> };
      const assetId = await finalizeUpload({ projectId, storageId, kind: 'music', label: file.name });
      await setMusic({ projectId, musicAssetId: assetId, includeMusic: true });
      setMusicEnabled(true);
    } finally {
      setUploading(false);
    }
  }

  async function handleRender() {
    await enqueue({
      projectId,
      params: {
        voice,
        aspectRatio,
        musicGain: musicEnabled ? musicGain : undefined,
      },
    });
    if (musicEnabled !== includeMusic) {
      await setMusic({ projectId, musicAssetId: musicAssetId ?? null, includeMusic: musicEnabled });
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-4 flex flex-col gap-4">
      <h3 className="font-semibold text-sm">Render settings</h3>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">Voice</span>
          <select
            value={voice}
            onChange={(e) => setVoice(e.target.value)}
            className="rounded border border-slate-300 dark:border-slate-700 bg-transparent px-2 py-1.5 text-sm"
          >
            {VOICES.map((v) => (
              <option key={v.value} value={v.value}>{v.label}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">Aspect ratio</span>
          <div className="flex gap-2 mt-1">
            {(['16:9', '9:16'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setAspectRatio(r)}
                className={`flex-1 rounded border px-2 py-1.5 text-sm ${
                  aspectRatio === r
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-slate-300 dark:border-slate-700'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </label>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="music"
            checked={musicEnabled}
            onChange={(e) => setMusicEnabled(e.target.checked)}
            className="rounded"
          />
          <label htmlFor="music" className="text-sm">Background music</label>
          {musicEnabled && (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="ml-auto text-xs underline text-slate-500 hover:text-foreground disabled:opacity-50"
            >
              {uploading ? 'Uploading…' : musicAssetId ? 'Replace music' : 'Upload music'}
            </button>
          )}
          <input ref={fileRef} type="file" accept="audio/*" className="hidden" onChange={handleMusicUpload} />
        </div>

        {musicEnabled && (
          <label className="flex items-center gap-2 text-sm">
            <span className="text-xs text-slate-500 w-16">Music vol</span>
            <input
              type="range"
              min={0.05}
              max={1}
              step={0.05}
              value={musicGain}
              onChange={(e) => setMusicGain(Number(e.target.value))}
              className="flex-1"
            />
            <span className="text-xs w-8 text-right">{Math.round(musicGain * 100)}%</span>
          </label>
        )}
      </div>

      <button
        type="button"
        onClick={handleRender}
        disabled={disabled}
        className="rounded-md bg-foreground text-background px-4 py-2 text-sm font-medium disabled:opacity-50 hover:opacity-90"
      >
        {label ?? 'Generate video'}
      </button>
    </div>
  );
}
