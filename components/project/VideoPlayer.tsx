'use client';

export function VideoPlayer({ src }: { src: string }) {
  return (
    <div className="rounded-lg overflow-hidden bg-black">
      <video
        key={src}
        src={src}
        controls
        className="w-full max-h-[480px]"
        playsInline
      />
      <div className="flex justify-end px-3 py-2 bg-slate-950">
        <a
          href={src}
          download="promovid.mp4"
          className="text-xs text-slate-400 hover:text-white underline"
        >
          Download MP4
        </a>
      </div>
    </div>
  );
}
