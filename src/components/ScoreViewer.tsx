import { useEffect, useRef, useState } from "react";
import type { BeatEvent } from "../lib/scoreTypes";

type ScoreViewerProps = {
  beatEvents: BeatEvent[];
  currentBeatIndex: number;
  scoreXml?: string;
  onSelectBeat: (index: number) => void;
};

export function ScoreViewer({
  beatEvents,
  currentBeatIndex,
  scoreXml,
  onSelectBeat,
}: ScoreViewerProps) {
  const osmdRef = useRef<HTMLDivElement>(null);
  const [renderStatus, setRenderStatus] = useState<string>("");

  useEffect(() => {
    if (!scoreXml || !osmdRef.current) {
      setRenderStatus("");
      return;
    }

    let cancelled = false;
    osmdRef.current.innerHTML = "";
    setRenderStatus("Rendering score...");

    import("opensheetmusicdisplay")
      .then(async ({ OpenSheetMusicDisplay }) => {
        if (cancelled || !osmdRef.current) return;
        const osmd = new OpenSheetMusicDisplay(osmdRef.current, {
          autoResize: true,
          drawTitle: false,
        });
        await osmd.load(scoreXml);
        if (cancelled) return;
        await osmd.render();
        setRenderStatus("");
      })
      .catch(() => {
        if (!cancelled) {
          setRenderStatus("Score rendering dependency is not installed. Beat navigation still works.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [scoreXml]);

  const currentBeat = beatEvents[currentBeatIndex];

  return (
    <section className="score-viewer">
      <div className="score-header">
        <h2>Score</h2>
        {currentBeat && (
          <span>
            Measure {currentBeat.measureNumber}, Beat {currentBeat.beatNumber}
          </span>
        )}
      </div>
      {scoreXml ? (
        <div className="rendered-score" ref={osmdRef} />
      ) : (
        <div className="beat-strip" aria-label="Sample beat selector">
          {beatEvents.map((beat, index) => (
            <button
              type="button"
              key={beat.id}
              className={index === currentBeatIndex ? "is-selected" : ""}
              onClick={() => onSelectBeat(index)}
            >
              M{beat.measureNumber} B{beat.beatNumber}
            </button>
          ))}
        </div>
      )}
      {scoreXml && (
        <div className="beat-strip compact" aria-label="Parsed beat selector">
          {beatEvents.map((beat, index) => (
            <button
              type="button"
              key={beat.id}
              className={index === currentBeatIndex ? "is-selected" : ""}
              onClick={() => onSelectBeat(index)}
            >
              {beat.measureNumber}.{beat.beatNumber}
            </button>
          ))}
        </div>
      )}
      {renderStatus && <p className="status-line">{renderStatus}</p>}
    </section>
  );
}
