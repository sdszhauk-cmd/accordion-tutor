import type { BeatEvent, LeftHandAction } from "../lib/scoreTypes";

type BeatInfoPanelProps = {
  beat: BeatEvent;
  globalWarnings: string[];
};

const actionLabels: Record<LeftHandAction, string> = {
  bass: "Bass note",
  chord: "Chord button",
  none: "—",
};

const actionColors: Record<LeftHandAction, string> = {
  bass: "#49c6a3",
  chord: "#ffd166",
  none: "transparent",
};

export function BeatInfoPanel({ beat, globalWarnings }: BeatInfoPanelProps) {
  const notes = beat.activeRightHandNotes.map(
    (note) => `${note.pitch.name}${note.isSustained ? " (held)" : ""}`,
  );
  const button = beat.activeLeftHandButtons[0];
  const warnings = [...globalWarnings, ...beat.warnings];

  return (
    <aside className="beat-info">
      <h2>Current Beat</h2>
      <dl>
        <div>
          <dt>Position</dt>
          <dd>
            Measure {beat.measureNumber}, Beat {beat.beatNumber} / {beat.beatsPerMeasure}
          </dd>
        </div>
        <div>
          <dt>Chord</dt>
          <dd>{beat.chordSymbol?.raw ?? "None"}</dd>
        </div>
        <div>
          <dt>Left Hand</dt>
          <dd className="action-row">
            <span
              className="action-pill"
              style={{ background: actionColors[beat.leftHandAction] }}
            >
              {actionLabels[beat.leftHandAction]}
            </span>
            {button && <span className="button-name">{button.label}</span>}
          </dd>
        </div>
        <div>
          <dt>Right Hand</dt>
          <dd>{notes.length ? notes.join(", ") : "Rest"}</dd>
        </div>
      </dl>
      {warnings.length > 0 && (
        <div className="warnings">
          <h3>Warnings</h3>
          <ul>
            {warnings.map((warning, index) => (
              <li key={`${warning}-${index}`}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="legend">
        <h3>Legend</h3>
        <div className="legend-row">
          <span className="legend-dot" style={{ background: "#49c6a3" }} />
          Bass note (beats 1 &amp; 3)
        </div>
        <div className="legend-row">
          <span className="legend-dot" style={{ background: "#ffd166" }} />
          Chord button (beats 2 &amp; 4)
        </div>
        <div className="legend-row">
          <span className="legend-dot piano-dot" />
          Active piano key
        </div>
      </div>
    </aside>
  );
}
