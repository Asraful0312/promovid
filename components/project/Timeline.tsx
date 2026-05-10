'use client';

import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';

const BG_COLORS: Record<string, [string, string]> = {
  ocean:    ['#0a1628', '#1a3a5c'],
  purple:   ['#1a0035', '#5b21b6'],
  midnight: ['#0d0d1a', '#1e1b4b'],
  forest:   ['#0a1f0a', '#14532d'],
  fire:     ['#1c0500', '#7c2d12'],
  sunset:   ['#1a0a00', '#78350f'],
  slate:    ['#0f172a', '#1e293b'],
};

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
  clips: Clip[];
  projectId: Id<'projects'>;
  selectedId: Id<'timelineClips'> | null;
  onSelect: (id: Id<'timelineClips'>) => void;
}

export function Timeline({ clips, projectId, selectedId, onSelect }: Props) {
  const reorder = useMutation(api.timeline.reorderClips);

  async function moveClip(fromIndex: number, toIndex: number) {
    const ids = clips.map((c) => c._id);
    const [moved] = ids.splice(fromIndex, 1);
    ids.splice(toIndex, 0, moved);
    await reorder({ projectId, orderedClipIds: ids });
  }

  if (clips.length === 0) {
    return (
      <p className="text-slate-500 text-sm py-4">No clips yet. Generate a video to get started.</p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-semibold text-sm">Timeline — {clips.length} clips</h3>
      <div className="flex gap-2 overflow-x-auto pb-2">
        {clips.map((clip, idx) => (
          <ClipCard
            key={clip._id}
            clip={clip}
            index={idx}
            total={clips.length}
            selected={clip._id === selectedId}
            onSelect={() => onSelect(clip._id)}
            onMoveLeft={idx > 0 ? () => moveClip(idx, idx - 1) : undefined}
            onMoveRight={idx < clips.length - 1 ? () => moveClip(idx, idx + 1) : undefined}
          />
        ))}
      </div>
    </div>
  );
}

function ClipCard({
  clip,
  index,
  total,
  selected,
  onSelect,
  onMoveLeft,
  onMoveRight,
}: {
  clip: Clip;
  index: number;
  total: number;
  selected: boolean;
  onSelect: () => void;
  onMoveLeft?: () => void;
  onMoveRight?: () => void;
}) {
  const dur = ((clip.endMs - clip.startMs) / 1000).toFixed(1);

  return (
    <div
      className={`shrink-0 w-36 rounded-lg border-2 cursor-pointer overflow-hidden flex flex-col ${
        selected ? 'border-foreground' : 'border-slate-200 dark:border-slate-800'
      }`}
      onClick={onSelect}
    >
      {/* Thumbnail — gradient tint shows the background preset */}
      <div
        className="relative h-20"
        style={{
          background: `linear-gradient(135deg, ${(BG_COLORS[clip.bgStyle ?? 'ocean'] ?? BG_COLORS.ocean)[0]}, ${(BG_COLORS[clip.bgStyle ?? 'ocean'] ?? BG_COLORS.ocean)[1]})`,
        }}
      >
        {clip.imageUrl && (
          <img src={clip.imageUrl} alt="" className="w-full h-full object-cover object-top opacity-80" />
        )}
        <span className="absolute bottom-1 right-1 bg-black/60 text-white text-[10px] px-1 rounded">
          {dur}s
        </span>
        <span className="absolute top-1 left-1 bg-black/60 text-white text-[10px] px-1 rounded">
          {index + 1}/{total}
        </span>
      </div>
      <div className="p-1.5 flex flex-col gap-0.5">
        <p className="text-[11px] leading-snug line-clamp-2 text-slate-700 dark:text-slate-300">
          {clip.narrationText}
        </p>
      </div>
      <div className="flex border-t border-slate-200 dark:border-slate-800">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onMoveLeft?.(); }}
          disabled={!onMoveLeft}
          className="flex-1 py-1 text-xs text-slate-400 hover:text-foreground disabled:opacity-20"
        >
          ←
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onMoveRight?.(); }}
          disabled={!onMoveRight}
          className="flex-1 py-1 text-xs text-slate-400 hover:text-foreground disabled:opacity-20"
        >
          →
        </button>
      </div>
    </div>
  );
}
