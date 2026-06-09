import type { BeatEvent, Pitch, RightHandNote } from "../lib/scoreTypes";
import { mapChordToStradella, parseChordSymbol } from "../lib/mapChordToStradella";
import { selectStradellaButton } from "../lib/extractBeatEvents";

const pitch = (name: string): Pitch => {
  const match = name.match(/^([A-G])([#b]?)(\d)$/);
  if (!match) throw new Error(`Invalid sample pitch ${name}`);
  const alter = match[2] === "#" ? 1 : match[2] === "b" ? -1 : undefined;
  return {
    step: match[1] as Pitch["step"],
    alter,
    octave: Number(match[3]),
    name,
  };
};

const note = (
  id: string,
  name: string,
  startMeasure: number,
  startBeat: number,
  durationBeats: number,
  isSustained = false,
): RightHandNote => ({
  id,
  pitch: pitch(name),
  startMeasure,
  startBeat,
  durationBeats,
  isSustained,
});

const BEATS_PER_MEASURE = 4;

const buildBeat = (
  id: string,
  measureNumber: number,
  beatNumber: number,
  activeRightHandNotes: RightHandNote[],
  startingRightHandNotes: RightHandNote[],
  rawChord: string,
  warnings: string[] = [],
): BeatEvent => {
  const chordSymbol = parseChordSymbol(rawChord);
  const mapping = mapChordToStradella(chordSymbol);
  const { button: selectedButton, action: leftHandAction } = selectStradellaButton(
    mapping.buttons,
    beatNumber,
    BEATS_PER_MEASURE,
  );

  return {
    id,
    measureNumber,
    beatNumber,
    beatsPerMeasure: BEATS_PER_MEASURE,
    activeRightHandNotes,
    startingRightHandNotes,
    chordSymbol: mapping.chord,
    activeLeftHandButtons: selectedButton ? [selectedButton] : [],
    leftHandAction,
    warnings: [...warnings, ...mapping.warnings],
    source: {
      rightHand: "sample",
      leftHand: "chord-symbol",
    },
  };
};

const c4 = note("m1-b1-C4", "C4", 1, 1, 2);
const e4 = note("m1-b1-E4", "E4", 1, 1, 1);
const g4 = note("m1-b1-G4", "G4", 1, 1, 1);
const d4 = note("m1-b2-D4", "D4", 1, 2, 1);
const f4 = note("m1-b3-F4", "F4", 1, 3, 2);
const a4 = note("m1-b3-A4", "A4", 1, 3, 1);
const e5 = note("m2-b1-E5", "E5", 2, 1, 1);
const g5 = note("m2-b2-G5", "G5", 2, 2, 1);
const fSharp4 = note("m2-b3-F#4", "F#4", 2, 3, 2);

export const sampleBeatEvents: BeatEvent[] = [
  buildBeat("m1-b1", 1, 1, [c4, e4, g4], [c4, e4, g4], "C"),
  buildBeat("m1-b2", 1, 2, [{ ...c4, isSustained: true }, d4], [d4], "C"),
  buildBeat("m1-b3", 1, 3, [f4, a4], [f4, a4], "Dm"),
  buildBeat("m1-b4", 1, 4, [{ ...f4, isSustained: true }], [], "Dm"),
  buildBeat("m2-b1", 2, 1, [e5], [e5], "G7"),
  buildBeat("m2-b2", 2, 2, [g5], [g5], "G7"),
  buildBeat("m2-b3", 2, 3, [fSharp4], [fSharp4], "Bbdim"),
  buildBeat("m2-b4", 2, 4, [{ ...fSharp4, isSustained: true }], [], "Bbdim"),
];
