'use client';

import { useRef, useState, useEffect } from 'react';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import type { LayoutVariant } from '@/remotion/PromoVideo';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ElementKey = 'text' | 'image' | 'subtitle';
export interface Bounds { x: number; y: number; w: number; h: number }
export type LiveOverride = Partial<Record<ElementKey, Partial<Bounds>>>;

export interface CanvaClip {
  _id: Id<'timelineClips'>;
  captionText: string;
  narrationText: string;
  imageUrl: string | null;
  layoutVariant: string | undefined;
  textX?: number; textY?: number; textW?: number; textH?: number;
  imageX?: number; imageY?: number; imageW?: number; imageH?: number;
  subtitleX?: number; subtitleY?: number; subtitleW?: number; subtitleH?: number;
}

// ─── Defaults (% of composition per variant) ─────────────────────────────────

const DEFAULTS: Record<LayoutVariant, Record<ElementKey, Bounds>> = {
  'text-left': {
    text:     { x: 4,  y: 0,  w: 36, h: 82 },
    image:    { x: 44, y: 9,  w: 52, h: 82 },
    subtitle: { x: 0,  y: 82, w: 100, h: 18 },
  },
  'text-right': {
    text:     { x: 56, y: 0,  w: 36, h: 82 },
    image:    { x: 2,  y: 9,  w: 52, h: 82 },
    subtitle: { x: 0,  y: 82, w: 100, h: 18 },
  },
  'fullscreen': {
    text:     { x: 4,  y: 6,  w: 55, h: 24 },
    image:    { x: 0,  y: 0,  w: 100, h: 100 },
    subtitle: { x: 0,  y: 80, w: 100, h: 20 },
  },
};

const EL_COLOR: Record<ElementKey, string> = {
  text:     '#3b82f6',
  image:    '#f97316',
  subtitle: '#22c55e',
};

const EL_LABEL: Record<ElementKey, string> = {
  text:     'Text',
  image:    'Image',
  subtitle: 'Subtitle',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

function resolvedBounds(el: ElementKey, clip: CanvaClip, variant: LayoutVariant, ov?: Partial<Bounds>): Bounds {
  const def = DEFAULTS[variant]?.[el] ?? DEFAULTS['text-left'][el];
  const sx = el === 'text' ? clip.textX : el === 'image' ? clip.imageX : clip.subtitleX;
  const sy = el === 'text' ? clip.textY : el === 'image' ? clip.imageY : clip.subtitleY;
  const sw = el === 'text' ? clip.textW : el === 'image' ? clip.imageW : clip.subtitleW;
  const sh = el === 'text' ? clip.textH : el === 'image' ? clip.imageH : clip.subtitleH;
  return {
    x: ov?.x ?? sx ?? def.x,
    y: ov?.y ?? sy ?? def.y,
    w: ov?.w ?? sw ?? def.w,
    h: ov?.h ?? sh ?? def.h,
  };
}

function applyResize(dir: string, start: Bounds, dx: number, dy: number): Bounds {
  let { x, y, w, h } = start;
  if (dir.includes('n')) { y += dy; h = Math.max(5, h - dy); }
  if (dir.includes('s')) { h = Math.max(5, h + dy); }
  if (dir.includes('w')) { x += dx; w = Math.max(5, w - dx); }
  if (dir.includes('e')) { w = Math.max(5, w + dx); }
  return { x: clamp(x, 0, 94), y: clamp(y, 0, 94), w: Math.max(5, w), h: Math.max(5, h) };
}

const RESIZE_HANDLES: { dir: string; cursor: string; pos: React.CSSProperties }[] = [
  { dir: 'nw', cursor: 'nw-resize', pos: { top: -4,  left: -4 } },
  { dir: 'n',  cursor: 'n-resize',  pos: { top: -4,  left: '50%', transform: 'translateX(-50%)' } },
  { dir: 'ne', cursor: 'ne-resize', pos: { top: -4,  right: -4 } },
  { dir: 'e',  cursor: 'e-resize',  pos: { top: '50%', right: -4, transform: 'translateY(-50%)' } },
  { dir: 'se', cursor: 'se-resize', pos: { bottom: -4, right: -4 } },
  { dir: 's',  cursor: 's-resize',  pos: { bottom: -4, left: '50%', transform: 'translateX(-50%)' } },
  { dir: 'sw', cursor: 'sw-resize', pos: { bottom: -4, left: -4 } },
  { dir: 'w',  cursor: 'w-resize',  pos: { top: '50%', left: -4, transform: 'translateY(-50%)' } },
];

// ─── SelectBox ────────────────────────────────────────────────────────────────

function SelectBox({
  el, bounds, isActive, blocked, overlayRef, onSelect, onLiveChange, onSave, onDoubleClick,
}: {
  el: ElementKey;
  bounds: Bounds;
  isActive: boolean;
  blocked: boolean;
  overlayRef: React.RefObject<HTMLDivElement | null>;
  onSelect: () => void;
  onLiveChange: (b: Partial<Bounds>) => void;
  onSave: (b: Bounds) => Promise<void>;
  onDoubleClick: () => void;
}) {
  const color = EL_COLOR[el];
  const label = EL_LABEL[el];

  function startMove(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    onSelect();
    const overlay = overlayRef.current;
    if (!overlay) return;
    const rect = overlay.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY;
    const sb = { ...bounds };

    function onMove(me: MouseEvent) {
      const dx = (me.clientX - sx) / rect.width * 100;
      const dy = (me.clientY - sy) / rect.height * 100;
      onLiveChange({ x: clamp(sb.x + dx, 0, 94), y: clamp(sb.y + dy, 0, 94), w: sb.w, h: sb.h });
    }
    async function onUp(me: MouseEvent) {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      const dx = (me.clientX - sx) / rect.width * 100;
      const dy = (me.clientY - sy) / rect.height * 100;
      await onSave({ x: clamp(sb.x + dx, 0, 94), y: clamp(sb.y + dy, 0, 94), w: sb.w, h: sb.h });
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function startResize(dir: string) {
    return (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const overlay = overlayRef.current;
      if (!overlay) return;
      const rect = overlay.getBoundingClientRect();
      const sx = e.clientX, sy = e.clientY;
      const sb = { ...bounds };

      function onMove(me: MouseEvent) {
        const dx = (me.clientX - sx) / rect.width * 100;
        const dy = (me.clientY - sy) / rect.height * 100;
        onLiveChange(applyResize(dir, sb, dx, dy));
      }
      async function onUp(me: MouseEvent) {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        const dx = (me.clientX - sx) / rect.width * 100;
        const dy = (me.clientY - sy) / rect.height * 100;
        await onSave(applyResize(dir, sb, dx, dy));
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    };
  }

  return (
    <div
      className="absolute"
      style={{
        left: `${bounds.x}%`, top: `${bounds.y}%`, width: `${bounds.w}%`, height: `${bounds.h}%`,
        pointerEvents: blocked ? 'none' : 'auto',
      }}
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
      onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick(); }}
    >
      {/* Label above box */}
      {isActive && (
        <div
          className="absolute -top-5 left-0 text-[10px] px-1.5 py-0.5 rounded-t font-semibold whitespace-nowrap pointer-events-none"
          style={{ background: color, color: 'white' }}
        >
          {label}
        </div>
      )}

      {/* Element bounding box */}
      <div
        className="w-full h-full cursor-move select-none"
        style={{
          border: isActive ? `2px solid ${color}` : `1px dashed rgba(255,255,255,0.35)`,
          backgroundColor: isActive ? `${color}18` : 'transparent',
          boxSizing: 'border-box',
        }}
        onMouseDown={startMove}
      />

      {/* Resize handles — shown only when active */}
      {isActive && RESIZE_HANDLES.map((h) => (
        <div
          key={h.dir}
          className="absolute"
          style={{
            ...h.pos,
            position: 'absolute',
            width: 8, height: 8,
            background: 'white',
            border: `1.5px solid ${color}`,
            borderRadius: 2,
            cursor: h.cursor,
            zIndex: 20,
            boxSizing: 'border-box',
          }}
          onMouseDown={startResize(h.dir)}
        />
      ))}
    </div>
  );
}

// ─── Inline Text Editor ───────────────────────────────────────────────────────

function TextEditor({
  el, bounds, caption, narration,
  onCaptionChange, onNarrationChange, onSave, onCancel,
}: {
  el: ElementKey;
  bounds: Bounds;
  caption: string; narration: string;
  onCaptionChange: (v: string) => void;
  onNarrationChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="absolute pointer-events-auto z-30"
      style={{ left: `${bounds.x}%`, top: `${bounds.y}%`, width: `${Math.max(bounds.w, 25)}%`, minHeight: `${bounds.h}%` }}
    >
      <div className="bg-black/90 backdrop-blur-sm rounded p-2.5 flex flex-col gap-2 border border-white/20">
        {el === 'text' && (
          <input
            autoFocus
            value={caption}
            onChange={(e) => onCaptionChange(e.target.value)}
            placeholder="Headline…"
            className="w-full bg-white/10 border border-white/20 rounded px-2 py-1 text-white text-xs font-bold focus:outline-none focus:border-white/50"
          />
        )}
        <textarea
          autoFocus={el === 'subtitle'}
          value={narration}
          onChange={(e) => onNarrationChange(e.target.value)}
          placeholder="Narration…"
          rows={3}
          className="w-full bg-white/10 border border-white/20 rounded px-2 py-1 text-white text-[11px] resize-none focus:outline-none focus:border-white/50"
        />
        <div className="flex gap-1.5">
          <button type="button" onClick={onSave} className="flex-1 py-1 bg-white text-black text-[11px] font-semibold rounded hover:bg-slate-200">
            Save
          </button>
          <button type="button" onClick={onCancel} className="flex-1 py-1 bg-white/10 text-white text-[11px] rounded hover:bg-white/20">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── CanvaEditor ─────────────────────────────────────────────────────────────

export function CanvaEditor({
  clip,
  projectId,
  liveOverride,
  onLiveChange,
  onCommit,
}: {
  clip: CanvaClip;
  projectId: Id<'projects'>;
  liveOverride: LiveOverride;
  onLiveChange: (override: LiveOverride) => void;
  onCommit: () => void;
}) {
  const updateClip = useMutation(api.timeline.updateClip);
  const [activeEl, setActiveEl] = useState<ElementKey | null>(null);
  const [editEl, setEditEl] = useState<ElementKey | null>(null);
  const [editCaption, setEditCaption] = useState('');
  const [editNarration, setEditNarration] = useState('');
  const [blockInput, setBlockInput] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Block SelectBox interaction when mouse is in the player controls zone (bottom ~52px)
  useEffect(() => {
    let blocked = false;
    const onMove = (e: MouseEvent) => {
      const el = overlayRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const should = e.clientY > r.bottom - 52;
      if (should !== blocked) { blocked = should; setBlockInput(should); }
    };
    document.addEventListener('mousemove', onMove, { passive: true });
    return () => document.removeEventListener('mousemove', onMove);
  }, []);

  // Deselect element when clicking outside the overlay (e.g. player controls, sidebar)
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (overlayRef.current && !overlayRef.current.contains(e.target as Node)) {
        setActiveEl(null);
        setEditEl(null);
      }
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, []);

  const variant = (clip.layoutVariant ?? 'text-left') as LayoutVariant;

  // Which elements to show depends on layout variant
  const elements: ElementKey[] = [
    'text',
    ...(clip.imageUrl && variant !== 'fullscreen' ? ['image' as ElementKey] : []),
    'subtitle',
  ];

  async function saveBounds(el: ElementKey, b: Bounds) {
    if (el === 'text') {
      await updateClip({ projectId, clipId: clip._id, textX: b.x, textY: b.y, textW: b.w, textH: b.h });
    } else if (el === 'image') {
      await updateClip({ projectId, clipId: clip._id, imageX: b.x, imageY: b.y, imageW: b.w, imageH: b.h });
    } else {
      await updateClip({ projectId, clipId: clip._id, subtitleX: b.x, subtitleY: b.y, subtitleW: b.w, subtitleH: b.h });
    }
    onCommit();
  }

  async function saveText() {
    await updateClip({ projectId, clipId: clip._id, captionText: editCaption, narrationText: editNarration });
    setEditEl(null);
  }

  return (
    <div ref={overlayRef} className="absolute inset-0 pointer-events-none select-none" style={{ zIndex: 5 }}>
      {elements.map((el) => {
        const bounds = resolvedBounds(el, clip, variant, liveOverride[el]);
        return (
          <SelectBox
            key={el}
            el={el}
            bounds={bounds}
            isActive={activeEl === el}
            blocked={blockInput}
            overlayRef={overlayRef}
            onSelect={() => { setActiveEl(el); setEditEl(null); }}
            onLiveChange={(b) => onLiveChange({ ...liveOverride, [el]: b })}
            onSave={(b) => saveBounds(el, b)}
            onDoubleClick={() => {
              if (el === 'text' || el === 'subtitle') {
                setEditEl(el);
                setActiveEl(el);
                setEditCaption(clip.captionText);
                setEditNarration(clip.narrationText);
              }
            }}
          />
        );
      })}

      {editEl && (
        <TextEditor
          el={editEl}
          bounds={resolvedBounds(editEl, clip, variant, liveOverride[editEl])}
          caption={editCaption}
          narration={editNarration}
          onCaptionChange={setEditCaption}
          onNarrationChange={setEditNarration}
          onSave={saveText}
          onCancel={() => setEditEl(null)}
        />
      )}
    </div>
  );
}
