import type { BeatEvent } from "../lib/scoreTypes";

type BeatNavigatorProps = {
  beatEvents: BeatEvent[];
  currentBeatIndex: number;
  onChange: (index: number) => void;
};

export function BeatNavigator({
  beatEvents,
  currentBeatIndex,
  onChange,
}: BeatNavigatorProps) {
  const currentBeat = beatEvents[currentBeatIndex];
  const atStart = currentBeatIndex === 0;
  const atEnd = currentBeatIndex >= beatEvents.length - 1;

  return (
    <div className="beat-navigator">
      <button type="button" onClick={() => onChange(currentBeatIndex - 1)} disabled={atStart}>
        ← Prev Beat
      </button>
      <div className="beat-position">
        <span>Measure {currentBeat?.measureNumber ?? "-"}</span>
        <strong>Beat {currentBeat?.beatNumber ?? "-"}</strong>
        <span className="beat-counter">
          {beatEvents.length ? currentBeatIndex + 1 : 0} / {beatEvents.length}
        </span>
        <span className="keyboard-hint">← → Space</span>
      </div>
      <button type="button" onClick={() => onChange(currentBeatIndex + 1)} disabled={atEnd}>
        Next Beat →
      </button>
    </div>
  );
}
