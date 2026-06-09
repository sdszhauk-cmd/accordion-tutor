import { useCallback, useEffect, useMemo, useState } from "react";
import { AccordionDiagram } from "./components/AccordionDiagram";
import { BeatInfoPanel } from "./components/BeatInfoPanel";
import { BeatNavigator } from "./components/BeatNavigator";
import { ScoreViewer } from "./components/ScoreViewer";
import { UploadPanel } from "./components/UploadPanel";
import { sampleBeatEvents } from "./data/sampleBeatData";
import type { BeatEvent } from "./lib/scoreTypes";

export default function App() {
  const [beatEvents, setBeatEvents] = useState<BeatEvent[]>(sampleBeatEvents);
  const [currentBeatIndex, setCurrentBeatIndex] = useState(0);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [scoreXml, setScoreXml] = useState<string | undefined>();

  const currentBeat = useMemo(
    () => beatEvents[Math.min(currentBeatIndex, beatEvents.length - 1)],
    [beatEvents, currentBeatIndex],
  );

  const loadBeatEvents = (
    events: BeatEvent[],
    nextWarnings: string[],
    nextScoreXml?: string,
  ) => {
    if (!events.length) {
      setWarnings(nextWarnings.length ? nextWarnings : ["No beat events loaded."]);
      return;
    }

    setBeatEvents(events);
    setCurrentBeatIndex(0);
    setWarnings(nextWarnings);
    setScoreXml(nextScoreXml);
  };

  const useSample = () => {
    setBeatEvents(sampleBeatEvents);
    setCurrentBeatIndex(0);
    setWarnings([]);
    setScoreXml(undefined);
  };

  const moveToBeat = useCallback(
    (index: number) => {
      setCurrentBeatIndex(Math.min(Math.max(index, 0), beatEvents.length - 1));
    },
    [beatEvents.length],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        setCurrentBeatIndex((i) => Math.min(i + 1, beatEvents.length - 1));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setCurrentBeatIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Home") {
        e.preventDefault();
        setCurrentBeatIndex(0);
      } else if (e.key === "End") {
        e.preventDefault();
        setCurrentBeatIndex(beatEvents.length - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [beatEvents.length]);

  return (
    <main className="app-shell">
      <UploadPanel
        onBeatEventsLoaded={loadBeatEvents}
        onWarnings={setWarnings}
        onUseSample={useSample}
      />
      {currentBeat && (
        <>
          <BeatNavigator
            beatEvents={beatEvents}
            currentBeatIndex={currentBeatIndex}
            onChange={moveToBeat}
          />
          <div className="workspace-grid">
            <ScoreViewer
              beatEvents={beatEvents}
              currentBeatIndex={currentBeatIndex}
              scoreXml={scoreXml}
              onSelectBeat={moveToBeat}
            />
            <AccordionDiagram beat={currentBeat} />
            <BeatInfoPanel beat={currentBeat} globalWarnings={warnings} />
          </div>
        </>
      )}
    </main>
  );
}
