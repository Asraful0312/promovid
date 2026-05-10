import {
  AbsoluteFill,
  Audio,
  Img,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
  Sequence,
} from 'remotion';

export const BG_PRESETS: Record<string, [string, string]> = {
  ocean:    ['#0a1628', '#1a3a5c'],
  purple:   ['#1a0035', '#5b21b6'],
  midnight: ['#0d0d1a', '#1e1b4b'],
  forest:   ['#0a1f0a', '#14532d'],
  fire:     ['#1c0500', '#7c2d12'],
  sunset:   ['#1a0a00', '#78350f'],
  slate:    ['#0f172a', '#1e293b'],
};

export type LayoutVariant = 'text-left' | 'text-right' | 'fullscreen';

export interface PromoClip {
  _id: string;
  startMs: number;
  endMs: number;
  narrationText: string;
  captionText: string;
  imageUrl: string | null;
  audioUrl: string | null;
  bgStyle?: string;
  layoutVariant?: LayoutVariant;
  // Element bounds as percentages (0–100) of composition dimensions
  textX?: number; textY?: number; textW?: number; textH?: number;
  imageX?: number; imageY?: number; imageW?: number; imageH?: number;
  subtitleX?: number; subtitleY?: number; subtitleW?: number; subtitleH?: number;
}

export interface PromoVideoProps extends Record<string, unknown> {
  clips: PromoClip[];
  aspectRatio?: '16:9' | '9:16';
  musicUrl?: string;
  musicVolume?: number;
  musicTrimStartMs?: number;
}

function getBg(style: string | undefined): [string, string] {
  return BG_PRESETS[style ?? 'ocean'] ?? BG_PRESETS.ocean;
}

// ─── Shared ──────────────────────────────────────────────────────────────────

function ScreenshotPanel({
  imageUrl, w, h, style,
}: { imageUrl: string; w: number; h: number; style?: React.CSSProperties }) {
  const badgeSize = Math.round(w / 76);
  return (
    <div style={{
      width: w, height: h, borderRadius: 16, overflow: 'hidden',
      boxShadow: '0 24px 80px rgba(0,0,0,0.55)',
      border: '1.5px solid rgba(255,255,255,0.14)',
      background: '#fff', position: 'relative', flexShrink: 0, ...style,
    }}>
      <Img src={imageUrl} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top center' }} />
      <div style={{
        position: 'absolute', bottom: 12, left: 12,
        background: 'rgba(0,0,0,0.52)', backdropFilter: 'blur(6px)',
        borderRadius: 999, padding: `5px ${badgeSize + 4}px`,
        display: 'flex', alignItems: 'center', gap: 5,
      }}>
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e' }} />
        <span style={{ color: 'rgba(255,255,255,0.88)', fontSize: badgeSize, fontWeight: 500, fontFamily: 'Helvetica Neue, Helvetica, Arial, sans-serif' }}>
          Live preview
        </span>
      </div>
    </div>
  );
}

function TextPanel({
  captionText, narrationText, captionSize, narrationSize, labelSize, style,
}: {
  captionText: string; narrationText: string;
  captionSize: number; narrationSize: number; labelSize: number;
  style?: React.CSSProperties;
}) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 18,
      fontFamily: 'Helvetica Neue, Helvetica, Arial, sans-serif', ...style,
    }}>
      <div style={{
        display: 'inline-flex', alignSelf: 'flex-start',
        background: 'rgba(255,255,255,0.14)', borderRadius: 999,
        padding: `${Math.round(labelSize * 0.32)}px ${Math.round(labelSize * 0.9)}px`,
        border: '1px solid rgba(255,255,255,0.22)',
      }}>
        <span style={{ color: 'rgba(255,255,255,0.82)', fontSize: labelSize, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
          Promo
        </span>
      </div>
      <p style={{ color: '#fff', fontSize: captionSize, fontWeight: 800, lineHeight: 1.2, margin: 0, textShadow: '0 2px 16px rgba(0,0,0,0.45)' }}>
        {captionText || narrationText.split(' ').slice(0, 6).join(' ')}
      </p>
      <p style={{ color: 'rgba(255,255,255,0.72)', fontSize: narrationSize, fontWeight: 400, lineHeight: 1.55, margin: 0 }}>
        {narrationText}
      </p>
    </div>
  );
}

// ─── 16:9 ────────────────────────────────────────────────────────────────────

function Scene16x9({ clip }: { clip: PromoClip }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const [c1, c2] = getBg(clip.bgStyle);
  const variant: LayoutVariant = (clip.layoutVariant as LayoutVariant) ?? 'text-left';

  const progress = spring({ frame, fps, config: { damping: 16, stiffness: 75 } });
  const textOpacity = interpolate(frame, [0, 14], [0, 1], { extrapolateRight: 'clamp' });
  const animTextY   = interpolate(frame, [0, 14], [24, 0], { extrapolateRight: 'clamp' });

  const captionSize   = Math.round(width / 28);
  const narrationSize = Math.round(width / 52);
  const labelSize     = Math.round(width / 60);

  // Default sizes
  const defaultPanelW = Math.round(width * 0.52);
  const defaultPanelH = Math.round(height * 0.82);
  const defaultPanelY = Math.round((height - defaultPanelH) / 2);
  const defaultTextW  = Math.round(width * 0.40) - 72;

  if (variant === 'fullscreen') {
    const overlayOpacity = interpolate(frame, [8, 22], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    const captionLeft = clip.textX !== undefined ? `${clip.textX}%` : '72px';
    const captionTop  = clip.textY !== undefined ? `${clip.textY}%` : '60px';
    const captionW    = clip.textW !== undefined ? `${clip.textW}%` : undefined;
    const subTopStyle: React.CSSProperties = clip.subtitleY !== undefined
      ? { top: `${clip.subtitleY}%`, bottom: undefined, background: 'rgba(0,0,0,0.62)' }
      : { bottom: 0 };

    return (
      <AbsoluteFill style={{ background: `linear-gradient(140deg, ${c1}, ${c2})` }}>
        {clip.audioUrl ? <Audio src={clip.audioUrl} /> : null}
        {clip.imageUrl ? (
          <AbsoluteFill>
            <Img src={clip.imageUrl} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top center', opacity: 0.7 }} />
          </AbsoluteFill>
        ) : null}
        <AbsoluteFill style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.25) 60%, transparent 100%)' }} />
        <div style={{ position: 'absolute', top: captionTop, left: captionLeft, width: captionW, opacity: textOpacity, transform: `translateY(${animTextY}px)`, fontFamily: 'Helvetica Neue, Helvetica, Arial, sans-serif' }}>
          <div style={{ display: 'inline-flex', background: 'rgba(255,255,255,0.18)', borderRadius: 999, padding: `${Math.round(labelSize * 0.3)}px ${Math.round(labelSize * 0.9)}px`, marginBottom: 18 }}>
            <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: labelSize, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Promo</span>
          </div>
          <p style={{ color: '#fff', fontSize: captionSize, fontWeight: 800, lineHeight: 1.2, margin: 0, textShadow: '0 2px 20px rgba(0,0,0,0.6)', maxWidth: captionW ?? Math.round(width * 0.55) }}>
            {clip.captionText || clip.narrationText.split(' ').slice(0, 6).join(' ')}
          </p>
        </div>
        <div style={{
          position: 'absolute', left: clip.subtitleX !== undefined ? `${clip.subtitleX}%` : 0,
          width: clip.subtitleW !== undefined ? `${clip.subtitleW}%` : undefined,
          right: clip.subtitleW === undefined ? 0 : undefined,
          padding: `${Math.round(height * 0.04)}px 72px`,
          height: clip.subtitleH !== undefined ? `${clip.subtitleH}%` : undefined,
          opacity: overlayOpacity, ...subTopStyle,
        }}>
          <p style={{ color: 'rgba(255,255,255,0.9)', fontSize: narrationSize, fontWeight: 400, lineHeight: 1.5, margin: 0, fontFamily: 'Helvetica Neue, Helvetica, Arial, sans-serif', textShadow: '0 1px 8px rgba(0,0,0,0.6)' }}>
            {clip.narrationText}
          </p>
        </div>
      </AbsoluteFill>
    );
  }

  const isLeft = variant !== 'text-right';
  const textLeftDefault = isLeft ? 72 : Math.round(width * 0.56);

  // Resolve element bounds from stored values (or defaults)
  const effectiveTextLeft = clip.textX !== undefined ? Math.round(width * clip.textX / 100) : textLeftDefault;
  const effectiveTextTop  = clip.textY !== undefined ? Math.round(height * clip.textY / 100) : 0;
  const effectiveTextW    = clip.textW !== undefined ? Math.round(width * clip.textW / 100) : defaultTextW;
  const effectiveTextH    = clip.textH !== undefined ? Math.round(height * clip.textH / 100) : undefined;
  const hasTextOverride   = clip.textY !== undefined || clip.textH !== undefined;

  const finalImageLeft = clip.imageX !== undefined ? Math.round(width * clip.imageX / 100) : (isLeft ? Math.round(width * 0.44) : 40);
  const finalImageTop  = clip.imageY !== undefined ? Math.round(height * clip.imageY / 100) : defaultPanelY;
  const finalPanelW    = clip.imageW !== undefined ? Math.round(width * clip.imageW / 100) : defaultPanelW;
  const finalPanelH    = clip.imageH !== undefined ? Math.round(height * clip.imageH / 100) : defaultPanelH;

  const subtitleLeft   = clip.subtitleX !== undefined ? Math.round(width * clip.subtitleX / 100) : 0;
  const subtitleTopPx  = clip.subtitleY !== undefined ? Math.round(height * clip.subtitleY / 100) : null;
  const subtitleHeight = clip.subtitleH !== undefined ? Math.round(height * clip.subtitleH / 100) : Math.round(height * 0.18);

  // Slide in from side to final position
  const panelSlide = interpolate(progress, [0, 1], [isLeft ? width + 60 : -finalPanelW - 60, finalImageLeft]);

  return (
    <AbsoluteFill style={{ background: `linear-gradient(140deg, ${c1} 0%, ${c2} 100%)` }}>
      {clip.audioUrl ? <Audio src={clip.audioUrl} /> : null}

      <TextPanel
        captionText={clip.captionText}
        narrationText={clip.narrationText}
        captionSize={captionSize}
        narrationSize={narrationSize}
        labelSize={labelSize}
        style={{
          position: 'absolute',
          left: effectiveTextLeft, top: effectiveTextTop,
          width: effectiveTextW,
          height: effectiveTextH ?? (hasTextOverride ? 'auto' : height - Math.round(height * 0.18)),
          justifyContent: hasTextOverride ? 'flex-start' : 'center',
          opacity: textOpacity, transform: `translateY(${animTextY}px)`,
        }}
      />

      {clip.imageUrl ? (
        <ScreenshotPanel
          imageUrl={clip.imageUrl}
          w={finalPanelW} h={finalPanelH}
          style={{ position: 'absolute', left: panelSlide, top: finalImageTop }}
        />
      ) : null}

      <div style={{
        position: 'absolute',
        left: subtitleLeft,
        right: clip.subtitleW !== undefined ? undefined : 0,
        width: clip.subtitleW !== undefined ? Math.round(width * clip.subtitleW / 100) : undefined,
        ...(subtitleTopPx !== null
          ? { top: subtitleTopPx, background: 'rgba(0,0,0,0.65)', alignItems: 'center', paddingBottom: 0 }
          : { bottom: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.68) 0%, transparent 100%)', alignItems: 'flex-end', paddingBottom: Math.round(height * 0.035) }),
        height: subtitleHeight,
        display: 'flex',
        paddingLeft: effectiveTextLeft,
        paddingRight: isLeft ? Math.round(width * 0.47) : 72,
        opacity: interpolate(frame, [8, 22], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
      }}>
        <p style={{ color: 'rgba(255,255,255,0.88)', fontSize: Math.round(width / 58), fontWeight: 400, lineHeight: 1.5, margin: 0, fontFamily: 'Helvetica Neue, Helvetica, Arial, sans-serif' }}>
          {clip.narrationText}
        </p>
      </div>
    </AbsoluteFill>
  );
}

// ─── 9:16 ────────────────────────────────────────────────────────────────────

function Scene9x16({ clip }: { clip: PromoClip }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const [c1, c2] = getBg(clip.bgStyle);
  const variant: LayoutVariant = (clip.layoutVariant as LayoutVariant) ?? 'text-left';

  const progress = spring({ frame, fps, config: { damping: 16, stiffness: 75 } });
  const textOpacity = interpolate(frame, [8, 22], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const animTextY   = interpolate(frame, [8, 22], [18, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  const captionSize   = Math.round(width / 14);
  const narrationSize = Math.round(width / 22);
  const labelSize     = Math.round(width / 36);
  const defaultPanelH = Math.round(height * 0.50);

  if (variant === 'fullscreen') {
    const overlayOpacity = interpolate(frame, [8, 22], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    const blockPos: React.CSSProperties = clip.textY !== undefined ? { top: `${clip.textY}%` } : { bottom: 60 };
    return (
      <AbsoluteFill style={{ background: `linear-gradient(170deg, ${c1}, ${c2})` }}>
        {clip.audioUrl ? <Audio src={clip.audioUrl} /> : null}
        {clip.imageUrl ? (
          <AbsoluteFill>
            <Img src={clip.imageUrl} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top center', opacity: 0.7 }} />
          </AbsoluteFill>
        ) : null}
        <AbsoluteFill style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.1) 65%, transparent 100%)' }} />
        <div style={{ position: 'absolute', left: clip.textX !== undefined ? `${clip.textX}%` : 48, right: 48, ...blockPos, opacity: overlayOpacity, transform: `translateY(${animTextY}px)`, fontFamily: 'Helvetica Neue, Helvetica, Arial, sans-serif' }}>
          <p style={{ color: '#fff', fontSize: captionSize, fontWeight: 800, lineHeight: 1.2, margin: '0 0 16px', textShadow: '0 2px 16px rgba(0,0,0,0.5)' }}>
            {clip.captionText || clip.narrationText.split(' ').slice(0, 5).join(' ')}
          </p>
          <p style={{ color: 'rgba(255,255,255,0.78)', fontSize: narrationSize, fontWeight: 400, lineHeight: 1.5, margin: 0 }}>
            {clip.narrationText}
          </p>
        </div>
      </AbsoluteFill>
    );
  }

  const finalImageTop = clip.imageY !== undefined ? Math.round(height * clip.imageY / 100) : 50;
  const finalPanelH   = clip.imageH !== undefined ? Math.round(height * clip.imageH / 100) : defaultPanelH;
  const finalPanelW   = clip.imageW !== undefined ? Math.round(width * clip.imageW / 100) : width - 80;
  const panelSlide    = interpolate(progress, [0, 1], [-finalPanelH - 60, finalImageTop]);
  const textTop       = clip.textY !== undefined ? Math.round(height * clip.textY / 100) : finalImageTop + finalPanelH + 40;

  return (
    <AbsoluteFill style={{ background: `linear-gradient(170deg, ${c1} 0%, ${c2} 100%)` }}>
      {clip.audioUrl ? <Audio src={clip.audioUrl} /> : null}
      {clip.imageUrl ? (
        <ScreenshotPanel
          imageUrl={clip.imageUrl}
          w={finalPanelW} h={finalPanelH}
          style={{ position: 'absolute', left: clip.imageX !== undefined ? Math.round(width * clip.imageX / 100) : 40, top: panelSlide, borderRadius: 24 }}
        />
      ) : null}
      <div style={{
        position: 'absolute', left: 48, right: 48, top: textTop, bottom: 60,
        display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 18,
        opacity: textOpacity, transform: `translateY(${animTextY}px)`,
        fontFamily: 'Helvetica Neue, Helvetica, Arial, sans-serif',
      }}>
        <p style={{ color: '#fff', fontSize: captionSize, fontWeight: 800, lineHeight: 1.2, margin: 0, textShadow: '0 2px 16px rgba(0,0,0,0.45)' }}>
          {clip.captionText || clip.narrationText.split(' ').slice(0, 5).join(' ')}
        </p>
        <p style={{ color: 'rgba(255,255,255,0.78)', fontSize: narrationSize, fontWeight: 400, lineHeight: 1.5, margin: 0 }}>
          {clip.narrationText}
        </p>
      </div>
    </AbsoluteFill>
  );
}

// ─── Composition ─────────────────────────────────────────────────────────────

export function PromoVideo({ clips, aspectRatio = '16:9', musicUrl, musicVolume, musicTrimStartMs }: PromoVideoProps) {
  const { fps } = useVideoConfig();
  let f = 0;
  return (
    <>
      {musicUrl ? (
        <Audio
          src={musicUrl as string}
          volume={(musicVolume as number | undefined) ?? 0.3}
          startFrom={musicTrimStartMs ? Math.round((musicTrimStartMs as number) / 1000 * fps) : 0}
        />
      ) : null}
      {(clips as PromoClip[]).map((clip) => {
        const frames = Math.max(1, Math.round(Math.max(1000, clip.endMs - clip.startMs) / 1000 * fps));
        const from = f;
        f += frames;
        return (
          <Sequence key={clip._id} from={from} durationInFrames={frames}>
            {(aspectRatio as string) === '9:16' ? <Scene9x16 clip={clip} /> : <Scene16x9 clip={clip} />}
          </Sequence>
        );
      })}
    </>
  );
}
