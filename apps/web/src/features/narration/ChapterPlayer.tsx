import { Pause, Play, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { assetUrl } from "../../api/client.ts";
import type { NarrationSegment } from "../../api/types.ts";
import { fmt } from "../../components/ui.tsx";

/** Plays synthesized segments in order, honoring pauseAfterMs, reporting the current segment for highlighting. */
export function ChapterPlayer({
  segments,
  onCurrent,
}: {
  segments: NarrationSegment[];
  onCurrent: (segmentId: string | null) => void;
}) {
  const playable = segments.filter((s) => s.audio);
  const [index, setIndex] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const list = useRef(playable);
  list.current = playable;

  const stop = () => {
    clearTimeout(timer.current);
    audio.current?.pause();
    audio.current = null;
    setIndex(null);
    setPaused(false);
    onCurrent(null);
  };

  const playAt = (i: number) => {
    clearTimeout(timer.current);
    const seg = list.current[i];
    if (!seg?.audio) return stop();
    setIndex(i);
    setPaused(false);
    onCurrent(seg.id);
    const a = new Audio(assetUrl(seg.audio.assetId));
    audio.current = a;
    a.onended = () => {
      timer.current = setTimeout(() => playAt(i + 1), seg.pauseAfterMs);
    };
    a.onerror = () => playAt(i + 1);
    a.play().catch(() => stop());
  };

  useEffect(
    () => () => {
      clearTimeout(timer.current);
      audio.current?.pause();
    },
    [],
  );

  const total = playable.reduce((s, x) => s + (x.audio?.durationMs ?? 0) + x.pauseAfterMs, 0);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {index === null ? (
        <button type="button" className="btn-primary" disabled={!playable.length} onClick={() => playAt(0)}>
          <Play className="size-4" /> Play chapter
        </button>
      ) : (
        <>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              if (!audio.current) return;
              if (paused) audio.current.play();
              else audio.current.pause();
              setPaused(!paused);
            }}
          >
            {paused ? <Play className="size-4" /> : <Pause className="size-4" />} {paused ? "Resume" : "Pause"}
          </button>
          <button type="button" className="btn-secondary" onClick={stop}>
            <Square className="size-4" /> Stop
          </button>
          <span className="muted text-xs">
            Segment {index + 1} / {playable.length}
          </span>
        </>
      )}
      <span className="muted text-xs">
        {playable.length}/{segments.length} synthesized · {fmt.ms(total)}
      </span>
    </div>
  );
}
