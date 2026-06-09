import { getStradellaButton } from "../data/stradella120Layout";
import type { ChordQuality, ChordSymbol, LeftHandButton } from "./scoreTypes";

const accidentalAliases: Record<string, string> = {
  "B♭": "Bb",
  "F♯": "F#",
  "E♭": "Eb",
  "A♭": "Ab",
  "C♯": "C#",
};

const supportedRoots = new Set([
  "A#",
  "D#",
  "G#",
  "C#",
  "F#",
  "B",
  "E",
  "A",
  "D",
  "G",
  "C",
  "F",
  "Bb",
  "Eb",
  "Ab",
  "Db",
  "Gb",
  "Cb",
  "Fb",
  "Bbb",
]);

export type ChordMappingResult = {
  buttons: LeftHandButton[];
  warnings: string[];
  chord?: ChordSymbol;
};

export const normalizeChordRoot = (root: string): string =>
  accidentalAliases[root] ?? root.replace("♭", "b").replace("♯", "#");

export const parseChordSymbol = (raw: string): ChordSymbol => {
  const trimmed = raw.trim();
  const match = trimmed.match(/^([A-G](?:#|b|♯|♭)?)(.*)$/);

  if (!match) {
    return { root: trimmed, quality: "unknown", raw };
  }

  const root = normalizeChordRoot(match[1]);
  const suffix = match[2].trim();
  let quality: ChordQuality = "unknown";

  if (suffix === "" || /^maj(?:or)?$/i.test(suffix)) quality = "major";
  else if (/^(m|min|-)$/.test(suffix)) quality = "minor";
  else if (suffix === "7") quality = "seventh";
  else if (/^(dim|°)$/i.test(suffix)) quality = "diminished";

  return { root, quality, raw };
};

export const mapChordToStradella = (
  chord: ChordSymbol,
): ChordMappingResult => {
  const root = normalizeChordRoot(chord.root);
  const normalizedChord = { ...chord, root };
  const warnings: string[] = [];

  if (!supportedRoots.has(root) || chord.quality === "unknown") {
    return {
      buttons: [],
      warnings: [`Unsupported chord symbol: ${chord.raw}`],
      chord: normalizedChord,
    };
  }

  const bass = getStradellaButton(`bass-${root}`);
  const chordButton = getStradellaButton(`${chord.quality}-${root}`);
  const buttons = [bass, chordButton].filter(
    (button): button is LeftHandButton => Boolean(button),
  );

  if (buttons.length < 2) {
    warnings.push(`Unsupported chord symbol: ${chord.raw}`);
  }

  return { buttons, warnings, chord: normalizedChord };
};
