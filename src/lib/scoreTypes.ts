export type PitchStep = "A" | "B" | "C" | "D" | "E" | "F" | "G";

export type Pitch = {
  step: PitchStep;
  alter?: number;
  octave: number;
  name: string;
};

export type RightHandNote = {
  id: string;
  pitch: Pitch;
  startMeasure: number;
  startBeat: number;
  durationBeats: number;
  isSustained?: boolean;
};

export type ChordQuality =
  | "major"
  | "minor"
  | "seventh"
  | "diminished"
  | "unknown";

export type ChordSymbol = {
  root: string;
  quality: ChordQuality;
  raw: string;
};

export type StradellaRow =
  | "bass"
  | "counterbass"
  | "major"
  | "minor"
  | "seventh"
  | "diminished";

export type LeftHandButton = {
  id: string;
  label: string;
  row: StradellaRow;
  root: string;
};

export type LeftHandAction = "bass" | "chord" | "none";

export type BeatEvent = {
  id: string;
  measureNumber: number;
  beatNumber: number;
  beatsPerMeasure: number;
  activeRightHandNotes: RightHandNote[];
  startingRightHandNotes: RightHandNote[];
  chordSymbol?: ChordSymbol;
  activeLeftHandButtons: LeftHandButton[];
  leftHandAction: LeftHandAction;
  warnings: string[];
  source: {
    rightHand: "score" | "sample" | "unknown";
    leftHand: "chord-symbol" | "explicit-score" | "none" | "unknown";
  };
};

export type ParseResult = {
  beatEvents: BeatEvent[];
  warnings: string[];
};
