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
  chordsByMeasureBeat: Map<string, ChordSymbol>,
  beatsPerMeasureByMeasure: Map<number, number>,
): BeatEvent[] => {
  const measureNumbers = Array.from(
    new Set([
      ...notesByMeasure.keys(),
      ...Array.from(chordsByMeasureBeat.keys()).map((key) => Number(key.split(":")[0])),
      ...beatsPerMeasureByMeasure.keys(),
    ]),
  ).sort((a, b) => a - b);

  const events: BeatEvent[] = [];
  let currentChord: ChordSymbol | undefined;
  let currentAllButtons: LeftHandButton[] = [];
  let currentChordWarnings: string[] = [];
  let nextMeasureStart = 0;
  const measureStartBeats = new Map<number, number>();
  const allNotes = Array.from(notesByMeasure.values()).flat();

  measureNumbers.forEach((measureNumber) => {
    measureStartBeats.set(measureNumber, nextMeasureStart);
    nextMeasureStart +=
      beatsPerMeasureByMeasure.get(measureNumber) ??
      beatsPerMeasureByMeasure.get(measureNumber - 1) ??
      4;
  });

  measureNumbers.forEach((measureNumber) => {
    const beatsPerMeasure =
      beatsPerMeasureByMeasure.get(measureNumber) ??
      beatsPerMeasureByMeasure.get(measureNumber - 1) ??
      4;
    const measureStartBeat = measureStartBeats.get(measureNumber) ?? 0;

    for (let beatNumber = 1; beatNumber <= beatsPerMeasure; beatNumber += 1) {
      const absoluteBeat = measureStartBeat + beatNumber - 1;
      const chordAtBeat = chordsByMeasureBeat.get(`${measureNumber}:${beatNumber}`);
      const warnings: string[] = [];

      if (chordAtBeat) {
        currentChord = chordAtBeat;
        const mapped = mapChordToStradella(chordAtBeat);
        currentAllButtons = mapped.buttons;
        currentChordWarnings = mapped.warnings;
      } else if (!currentChord) {
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
        .filter((note) => {
          const noteMeasureStart = measureStartBeats.get(note.startMeasure) ?? 0;
          const noteStart = noteMeasureStart + note.startBeat - 1;
          return noteStart <= absoluteBeat && noteStart + note.durationBeats > absoluteBeat;
        })
        .map((note) => ({
          ...note,
          isSustained:
            (measureStartBeats.get(note.startMeasure) ?? 0) + note.startBeat - 1 <
            absoluteBeat,
        }));
      const startingRightHandNotes = allNotes.filter((note) => {
        const noteMeasureStart = measureStartBeats.get(note.startMeasure) ?? 0;
        return almostEqual(noteMeasureStart + note.startBeat - 1, absoluteBeat);
      });

      events.push({
        id: `m${measureNumber}-b${beatNumber}`,
        measureNumber,
        beatNumber,
        beatsPerMeasure,
        activeRightHandNotes,
        startingRightHandNotes,
        chordSymbol: currentChord,
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
