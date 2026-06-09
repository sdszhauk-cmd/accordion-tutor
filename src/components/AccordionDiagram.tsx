import { mapNotesToPianoKeys } from "../lib/mapNotesToPianoKeys";
import type { BeatEvent } from "../lib/scoreTypes";
import { PianoKeyboard } from "./PianoKeyboard";
import { StradellaBass } from "./StradellaBass";

type AccordionDiagramProps = {
  beat: BeatEvent;
};

export function AccordionDiagram({ beat }: AccordionDiagramProps) {
  const activePitches = mapNotesToPianoKeys(
    beat.activeRightHandNotes.map((note) => note.pitch),
  );
  const activeButtonIds = beat.activeLeftHandButtons.map((button) => button.id);

  return (
    <section className="accordion-diagram" aria-label="Accordion diagram">
      <div className="instrument-panel bass-side">
        <StradellaBass activeButtonIds={activeButtonIds} leftHandAction={beat.leftHandAction} />
      </div>
      <div className="bellows" aria-hidden="true">
        {Array.from({ length: 9 }).map((_, index) => (
          <span key={index} />
        ))}
      </div>
      <div className="instrument-panel piano-side">
        <PianoKeyboard activePitches={activePitches} />
      </div>
    </section>
  );
}
