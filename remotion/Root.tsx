import React from 'react';
import { Composition } from 'remotion';
import { PromoVideo, type PromoVideoProps } from './PromoVideo';

const FPS = 30;

function calcFrames(props: PromoVideoProps) {
  const ms = props.clips.reduce((s, c) => s + Math.max(1000, c.endMs - c.startMs), 0);
  return { durationInFrames: Math.max(FPS, Math.round(ms / 1000 * FPS)) };
}

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="PromoVideo"
      component={PromoVideo}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={{ clips: [], aspectRatio: '16:9' as const }}
      calculateMetadata={({ props }) => calcFrames(props)}
    />
    <Composition
      id="PromoVideo916"
      component={PromoVideo}
      fps={FPS}
      width={1080}
      height={1920}
      defaultProps={{ clips: [], aspectRatio: '9:16' as const }}
      calculateMetadata={({ props }) => calcFrames(props)}
    />
  </>
);
