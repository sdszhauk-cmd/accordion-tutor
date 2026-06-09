export type PianoKeyLayout = {
  id: string;
  label: string;
  pitchClass: string;
  octave: number;
  type: "white" | "black";
  x: number;
  y: number;
  width: number;
  height: number;
};

const pitchClasses = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const whitePitchClasses = new Set(["C", "D", "E", "F", "G", "A", "B"]);
const blackAfterWhite: Record<string, string> = {
  "C#": "C",
  "D#": "D",
  "F#": "F",
  "G#": "G",
  "A#": "A",
};

const midiFor = (pitchName: string): number => {
  const match = pitchName.match(/^([A-G]#?)(\d)$/);
  if (!match) throw new Error(`Invalid piano range pitch: ${pitchName}`);
  return (Number(match[2]) + 1) * 12 + pitchClasses.indexOf(match[1]);
};

const pitchNameForMidi = (midi: number): string => {
  const pitchClass = pitchClasses[midi % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${pitchClass}${octave}`;
};

export const createPianoKeyboardLayout = (
  lowestPitch = "F3",
  highestPitch = "A6",
): PianoKeyLayout[] => {
  const whiteWidth = 44;
  const whiteHeight = 22;
  const keys: PianoKeyLayout[] = [];
  const whiteYByPitch = new Map<string, number>();
  let whiteIndex = 0;

  for (let midi = midiFor(lowestPitch); midi <= midiFor(highestPitch); midi += 1) {
    const name = pitchNameForMidi(midi);
    const pitchClass = name.slice(0, -1);
    const octave = Number(name.slice(-1));

    if (whitePitchClasses.has(pitchClass)) {
      const y = whiteIndex * whiteHeight;
      whiteYByPitch.set(name, y);
      keys.push({
        id: name,
        label: name,
        pitchClass,
        octave,
        type: "white",
        x: 0,
        y,
        width: whiteWidth,
        height: whiteHeight,
      });
      whiteIndex += 1;
    }
  }

  for (let midi = midiFor(lowestPitch); midi <= midiFor(highestPitch); midi += 1) {
    const name = pitchNameForMidi(midi);
    const pitchClass = name.slice(0, -1);
    const octave = Number(name.slice(-1));
    const previousWhite = blackAfterWhite[pitchClass];

    if (previousWhite) {
      const y = whiteYByPitch.get(`${previousWhite}${octave}`);
      if (y !== undefined) {
        keys.push({
          id: name,
          label: name,
          pitchClass,
          octave,
          type: "black",
          x: 0,
          y: y + whiteHeight * 0.65,
          width: 28,
          height: 14,
        });
      }
    }
  }

  return keys;
};

export const pianoKeyboardLayout = createPianoKeyboardLayout();

