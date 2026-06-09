import type { Pitch } from "./scoreTypes";

export const normalizeAccidental = (name: string): string =>
  name.replace("♭", "b").replace("♯", "#");

export const pitchToPianoKeyId = (pitch: Pitch): string => {
  const accidental = pitch.alter === 1 ? "#" : pitch.alter === -1 ? "b" : "";
  return normalizeAccidental(`${pitch.step}${accidental}${pitch.octave}`);
};

export const mapNotesToPianoKeys = (pitches: Pitch[]): string[] =>
  pitches.map(pitchToPianoKeyId);
