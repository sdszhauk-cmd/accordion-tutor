import type { LeftHandButton, StradellaRow } from "../lib/scoreTypes";

export type StradellaButtonLayout = LeftHandButton & {
  x: number;
  y: number;
};

export const stradellaBassRoots = [
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
];

const counterbassLabels: Record<string, string> = {
  "A#": "Cx",
  "D#": "Fx",
  "G#": "B#",
  "C#": "E#",
  "F#": "A#",
  B: "D#",
  E: "G#",
  A: "C#",
  D: "F#",
  G: "B",
  C: "E",
  F: "A",
  Bb: "D",
  Eb: "G",
  Ab: "C",
  Db: "F",
  Gb: "Bb",
  Cb: "Eb",
  Fb: "Ab",
  Bbb: "Db",
};

type StradellaRowSpec = {
  row: StradellaRow;
  label: string;
  labelFor: (root: string) => string;
};

const rowDisplayNames: Record<StradellaRow, string> = {
  diminished: "Dim",
  seventh: "7th",
  minor: "Minor",
  major: "Major",
  bass: "Bass",
  counterbass: "Counter",
};

const baseStradellaRows: Array<Omit<StradellaRowSpec, "label">> = [
  { row: "diminished", labelFor: (root) => `${root}dim` },
  { row: "seventh", labelFor: (root) => `${root}7` },
  { row: "minor", labelFor: (root) => `${root}m` },
  { row: "major", labelFor: (root) => root },
  { row: "bass", labelFor: (root) => root },
  {
    row: "counterbass",
    labelFor: (root) => counterbassLabels[root] ?? root,
  },
];

export const stradellaRows: StradellaRowSpec[] = baseStradellaRows.map((spec) => ({
  ...spec,
  label: rowDisplayNames[spec.row],
}));

const columnGap = 34;
const rootGap = 27;
const rowDrop = 13;
const headerBand = 34;
export const stradellaHeaderXOffset = -8;
export const stradellaHeaderYOffset = 12;
export const stradellaButtonXOffset = 2;
export const stradellaButtonYOffset = 26;

const buttonsForRoot = (
  root: string,
  rowIndex: number,
  rootIndex: number,
): StradellaButtonLayout => {
  const spec = stradellaRows[rowIndex];
  const x = stradellaButtonXOffset + rowIndex * columnGap;
  const y = stradellaButtonYOffset + headerBand + rootIndex * rootGap + rowIndex * rowDrop;

  return {
    id: `${spec.row}-${root}`,
    label: spec.labelFor(root),
    root,
    row: spec.row,
    x,
    y,
  };
};

export const stradella120Layout: StradellaButtonLayout[] = stradellaRows.flatMap(
  (_, rowIndex) =>
    stradellaBassRoots.map((root, rootIndex) =>
      buttonsForRoot(root, rowIndex, rootIndex),
    ),
);

export const stradellaViewBox = "-18 0 225 672";

export const getStradellaButton = (
  id: string,
): StradellaButtonLayout | undefined =>
  stradella120Layout.find((button) => button.id === id);


