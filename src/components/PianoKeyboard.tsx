import { pianoKeyboardLayout } from "../data/pianoKeyboardLayout";

type PianoKeyboardProps = {
  activePitches: string[];
};

const enharmonicAliases: Record<string, string> = {
  Db: "C#",
  Eb: "D#",
  Gb: "F#",
  Ab: "G#",
  Bb: "A#",
};

const normalizeKey = (pitch: string): string =>
  pitch.replace(/^([A-G]b)(\d)$/, (_, pc, octave) => `${enharmonicAliases[pc] ?? pc}${octave}`);

export function PianoKeyboard({ activePitches }: PianoKeyboardProps) {
  const active = new Set(activePitches.map(normalizeKey));
  const whiteKeys = pianoKeyboardLayout.filter((key) => key.type === "white");
  const blackKeys = pianoKeyboardLayout.filter((key) => key.type === "black");
  const height = Math.max(...whiteKeys.map((key) => key.y + key.height));

  return (
    <svg
      className="piano-keyboard"
      viewBox={`0 0 54 ${height}`}
      role="img"
      aria-label="Right hand piano keyboard"
    >
      {whiteKeys.map((key) => (
        <g key={key.id}>
          <rect
            className={`piano-key piano-key-white ${active.has(key.id) ? "is-active" : ""}`}
            x={key.x}
            y={key.y}
            width={key.width}
            height={key.height}
            rx="2"
          />
          {key.pitchClass === "C" && (
            <text x="48" y={key.y + 15} className="key-label">
              {key.label}
            </text>
          )}
        </g>
      ))}
      {blackKeys.map((key) => (
        <rect
          key={key.id}
          className={`piano-key piano-key-black ${active.has(key.id) ? "is-active" : ""}`}
          x={key.x}
          y={key.y}
          width={key.width}
          height={key.height}
          rx="2"
        />
      ))}
    </svg>
  );
}
