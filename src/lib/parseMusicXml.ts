import type { ChordQuality, ChordSymbol, ParseResult, Pitch, RightHandNote } from "./scoreTypes";
import { extractBeatEvents } from "./extractBeatEvents";
import { parseChordSymbol } from "./mapChordToStradella";

const textOf = (node: Element | undefined, selector: string): string | undefined =>
  node?.querySelector(selector)?.textContent?.trim();

const parseNumber = (value: string | undefined | null, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const qualityFromMusicXmlKind = (kind: string | undefined): ChordQuality => {
  if (!kind) return "major";
  if (["major", "none"].includes(kind)) return "major";
  if (kind === "minor") return "minor";
  if (kind.includes("seventh") || kind === "dominant") return "seventh";
  if (kind.includes("diminished")) return "diminished";
  return "unknown";
};

const pitchName = (step: string, alter: number | undefined, octave: number): string => {
  const accidental = alter === 1 ? "#" : alter === -1 ? "b" : "";
  return `${step}${accidental}${octave}`;
};

const parsePitch = (pitchElement: Element): Pitch | undefined => {
  const step = textOf(pitchElement, "step");
  const octave = parseNumber(textOf(pitchElement, "octave"), NaN);
  if (!step || !Number.isFinite(octave)) return undefined;
  const alterText = textOf(pitchElement, "alter");
  const alter = alterText === undefined ? undefined : Number(alterText);

  return {
    step: step as Pitch["step"],
    alter,
    octave,
    name: pitchName(step, alter, octave),
  };
};

const chordTextPattern = /(^|[^A-Za-z0-9#b♭♯])([A-G](?:#|b|♭|♯)?(?:m|min|-|7|dim)?)(?=$|[^A-Za-z0-9#b♭♯])/g;

const parseChordFromText = (rawText: string | undefined): ChordSymbol | undefined => {
  if (!rawText) return undefined;
  const normalized = rawText.replace(/♭/g, "b").replace(/♯/g, "#");
  for (const match of normalized.matchAll(chordTextPattern)) {
    const parsed = parseChordSymbol(match[2]);
    if (parsed.quality !== "unknown") return parsed;
  }
  return undefined;
};

const textContentForChordScan = (element: Element): string =>
  Array.from(element.querySelectorAll("words, rehearsal, lyric text, credit-words"))
    .map((node) => node.textContent?.trim())
    .filter(Boolean)
    .join(" ");
const suffixForChordQuality = (quality: ChordQuality): string => {
  if (quality === "minor") return "m";
  if (quality === "seventh") return "7";
  if (quality === "diminished") return "dim";
  return "";
};

const parseHarmony = (harmony: Element): ChordSymbol | undefined => {
  const rootStep = textOf(harmony, "root-step");
  if (!rootStep) return undefined;
  const rootAlter = parseNumber(textOf(harmony, "root-alter"), 0);
  const root = `${rootStep}${rootAlter === 1 ? "#" : rootAlter === -1 ? "b" : ""}`;
  const kind = harmony.querySelector("kind");
  const displayText = kind?.getAttribute("text")?.replace(/\s+/g, "");
  const kindQuality = qualityFromMusicXmlKind(kind?.textContent?.trim());
  const raw = displayText
    ? /^[A-G]/.test(displayText)
      ? displayText
      : `${root}${displayText}`
    : `${root}${suffixForChordQuality(kindQuality)}`;
  const parsed = parseChordSymbol(raw);
  return {
    root,
    quality: parsed.quality === "unknown" ? kindQuality : parsed.quality,
    raw,
  };
};

export const parseMusicXml = (xmlText: string): ParseResult => {
  const warnings: string[] = [];
  const parser = new DOMParser();
  const document = parser.parseFromString(xmlText, "application/xml");
  const parseError = document.querySelector("parsererror");

  if (parseError) {
    return {
      beatEvents: [],
      warnings: ["MusicXML parse failure. Check that the uploaded file is valid XML."],
    };
  }

  const parts = Array.from(document.querySelectorAll("part"));
  if (!parts.length) {
    return {
      beatEvents: [],
      warnings: ["Missing MusicXML parts."],
    };
  }

  const notesByMeasure = new Map<number, RightHandNote[]>();
  const chordsByMeasureBeat = new Map<string, ChordSymbol>();
  const beatsPerMeasureByMeasure = new Map<number, number>();

  parts.forEach((part, partIndex) => {
    let divisions = 1;
    let currentTimeBeats = 4;

    Array.from(part.children)
      .filter((child) => child.localName === "measure")
      .forEach((measure, index) => {
        const measureNumber = parseNumber(
          measure.getAttribute("number") ?? undefined,
          index + 1,
        );
        const attributes = measure.querySelector("attributes");
        divisions = parseNumber(textOf(attributes ?? measure, "divisions"), divisions);
        const beats = parseNumber(
          textOf(attributes ?? measure, "time > beats"),
          currentTimeBeats,
        );
        currentTimeBeats = beats;
        if (partIndex === 0) {
          beatsPerMeasureByMeasure.set(measureNumber, currentTimeBeats);
        }

        let cursorDivisions = 0;
        let lastNoteStartDivisions = 0;
        const measureNotes: RightHandNote[] = [];

        Array.from(measure.children).forEach((child, childIndex) => {
          if (child.localName === "backup") {
            cursorDivisions -= parseNumber(textOf(child, "duration"), 0);
            return;
          }

          if (child.localName === "forward") {
            cursorDivisions += parseNumber(textOf(child, "duration"), 0);
            return;
          }

          if (child.localName === "harmony") {
            const beatNumber = Math.floor(cursorDivisions / divisions) + 1;
            const chord = parseHarmony(child);
            if (chord) chordsByMeasureBeat.set(`${measureNumber}:${beatNumber}`, chord);
            return;
          }

          if (child.localName === "direction") {
            const beatNumber = Math.floor(cursorDivisions / divisions) + 1;
            const chord = parseChordFromText(textContentForChordScan(child));
            if (chord) chordsByMeasureBeat.set(`${measureNumber}:${beatNumber}`, chord);
            return;
          }

          if (child.localName !== "note") return;
          const lyricChord = parseChordFromText(textContentForChordScan(child));
          if (lyricChord) {
            const beatNumber = Math.floor(cursorDivisions / divisions) + 1;
            chordsByMeasureBeat.set(`${measureNumber}:${beatNumber}`, lyricChord);
          }
          const isRest = Boolean(child.querySelector("rest"));
          const isChordTone = Boolean(child.querySelector("chord"));
          const duration = parseNumber(textOf(child, "duration"), divisions);
          const startDivisions = isChordTone ? lastNoteStartDivisions : cursorDivisions;

          if (!isRest && partIndex === 0) {
            const pitchElement = child.querySelector("pitch");
            const pitch = pitchElement ? parsePitch(pitchElement) : undefined;
            if (pitch) {
              measureNotes.push({
                id: `m${measureNumber}-n${childIndex}-${pitch.name}`,
                pitch,
                startMeasure: measureNumber,
                startBeat: startDivisions / divisions + 1,
                durationBeats: Math.max(duration / divisions, 0.25),
              });
            }
          }

          if (!isChordTone) {
            lastNoteStartDivisions = startDivisions;
            cursorDivisions += duration;
          }
        });

        if (partIndex === 0) {
          notesByMeasure.set(measureNumber, measureNotes);
        }
      });
  });

  const beatEvents = extractBeatEvents(
    notesByMeasure,
    chordsByMeasureBeat,
    beatsPerMeasureByMeasure,
  );

  if (!beatEvents.length) {
    warnings.push("No beat events could be extracted from this MusicXML file.");
  }

  return { beatEvents, warnings };
};





