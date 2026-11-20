import type { BeatEvent, ChordSymbol, LeftHandAction, LeftHandButton, RightHandNote } from "./scoreTypes";
import { mapChordToStradella } from "./mapChordToStradella";

const almostEqual = (a: number, b: number): boolean => Math.abs(a - b) < 0.001;

export const isBassbeat = (beatNumber: number, beatsPerMeasure: number): boolean => {
  if (beatsPerMeasure === 3) return beatNumber === 1;
  return beatNumber % 2 === 1;
};

export const selectStradellaButton = (
  allButtons: LeftHandButton[],
  beatNumber: number,
  beatsPerMeasure: number,
): { button: LeftHandButton | undefined; action: LeftHandAction } => {
  if (!allButtons.length) return { button: undefined, action: "none" };
  const bassBeat = isBassbeat(beatNumber, beatsPerMeasure);
  if (bassBeat) {
    const btn = allButtons.find((b) => b.row === "bass");
    return { button: btn, action: "bass" };
  }
  const btn = allButtons.find((b) => b.row !== "bass" && b.row !== "counterbass");
  return { button: btn, action: "chord" };
};

export const extractBeatEvents = (
  notesByMeasure: Map<number, RightHandNote[]>,
  chordsByMeasureBeat: Map<string, ChordSymbol | null>,
  beatsPerMeasureByMeasure: Map<number, number>,
  quartersPerBeat = new Map<number, number>(),
): BeatEvent[] => {
  const measureNumbers = Array.from(
    new Set([
      ...notesByMeasure.keys(),
      ...Array.from(chordsByMeasureBeat.keys()).map((key) => Number(key.split(":")[0])),
      ...beatsPerMeasureByMeasure.keys(),
    ]),
  ).sort((a, b) => a - b);

  const events: BeatEvent[] = [];
  let currentChord: ChordSymbol | null | undefined;
  let currentAllButtons: LeftHandButton[] = [];
  let currentChordWarnings: string[] = [];
  let nextMeasureStart = 0;
  const measureStarts = new Map<number, number>();

  measureNumbers.forEach((measureNumber) => {
    measureStarts.set(measureNumber, nextMeasureStart);
    const beats =
      beatsPerMeasureByMeasure.get(measureNumber) ??
      beatsPerMeasureByMeasure.get(measureNumber - 1) ??
      4;
    nextMeasureStart += beats * (quartersPerBeat.get(measureNumber) ?? 1);
  });

  const allNotes = Array.from(notesByMeasure.values()).flat().map(note => {
    const width = quartersPerBeat.get(note.startMeasure) ?? 1;
    const start = (measureStarts.get(note.startMeasure) ?? 0) + (note.startBeat - 1) * width;
    return { note, start, end: start + note.durationBeats * width };
  });

  measureNumbers.forEach((measureNumber) => {
    const beatsPerMeasure =
      beatsPerMeasureByMeasure.get(measureNumber) ??
      beatsPerMeasureByMeasure.get(measureNumber - 1) ??
      4;
    const measureStart = measureStarts.get(measureNumber) ?? 0;
    const durationQuarters = quartersPerBeat.get(measureNumber) ?? 1;

    for (let beatNumber = 1; beatNumber <= beatsPerMeasure; beatNumber += 1) {
      const absoluteBeat = measureStart + (beatNumber - 1) * durationQuarters;
      const chordAtBeat = chordsByMeasureBeat.get(`${measureNumber}:${beatNumber}`);
      const warnings: string[] = [];

      if (chordAtBeat === null) {
        currentChord = null;
        currentAllButtons = [];
        currentChordWarnings = [];
      } else if (chordAtBeat) {
        currentChord = chordAtBeat;
        const mapped = mapChordToStradella(chordAtBeat);
        currentAllButtons = mapped.buttons;
        currentChordWarnings = mapped.warnings;
      } else if (currentChord === undefined) {
        warnings.push(
          `Measure ${measureNumber}, Beat ${beatNumber}: No chord symbol detected.`,
        );
      }

      const { button: selectedButton, action: leftHandAction } = selectStradellaButton(
        currentAllButtons,
        beatNumber,
        beatsPerMeasure,
      );

      const activeRightHandNotes = allNotes
        .filter(({ start, end }) => start <= absoluteBeat && end > absoluteBeat)
        .map(({ note, start }) => ({
          ...note,
          isSustained: start < absoluteBeat,
        }));
      const startingRightHandNotes = allNotes
        .filter(({ start }) => almostEqual(start, absoluteBeat))
        .map(({ note }) => note);

      events.push({
        id: `m${measureNumber}-b${beatNumber}`,
        measureNumber,
        beatNumber,
        beatsPerMeasure,
        durationQuarters,
        activeRightHandNotes,
        startingRightHandNotes,
        chordSymbol: currentChord ?? undefined,
        activeLeftHandButtons: selectedButton ? [selectedButton] : [],
        leftHandAction,
        warnings: [...warnings, ...currentChordWarnings],
        source: {
          rightHand: "score",
          leftHand: currentChord ? "chord-symbol" : "none",
        },
      });
    }
  });

  return events;
};
