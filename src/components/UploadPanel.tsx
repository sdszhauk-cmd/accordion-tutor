import { pdfToMusicXml } from "../lib/omrPipeline";
import { parseMusicXml } from "../lib/parseMusicXml";
import type { BeatEvent } from "../lib/scoreTypes";

type UploadPanelProps = {
  onBeatEventsLoaded: (events: BeatEvent[], warnings: string[], scoreXml?: string) => void;
  onWarnings: (warnings: string[]) => void;
  onUseSample: () => void;
};

const readFileAsText = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });

export function UploadPanel({
  onBeatEventsLoaded,
  onWarnings,
  onUseSample,
}: UploadPanelProps) {
  const handleFile = async (file: File) => {
    const lowerName = file.name.toLowerCase();

    if (lowerName.endsWith(".pdf")) {
      const result = await pdfToMusicXml(file);
      if (result.musicXml) {
        const parsed = parseMusicXml(result.musicXml);
        onBeatEventsLoaded(
          parsed.beatEvents,
          [...result.warnings, ...parsed.warnings],
          result.musicXml,
        );
        return;
      }

      onWarnings(result.error ? [...result.warnings, result.error] : result.warnings);
      return;
    }

    if (lowerName.endsWith(".mxl")) {
      onWarnings([
        "Compressed .mxl upload is recognized, but archive decompression is not implemented in this browser-only MVP. Export uncompressed .musicxml or .xml for now.",
      ]);
      return;
    }

    if (lowerName.endsWith(".musicxml") || lowerName.endsWith(".xml")) {
      const xmlText = await readFileAsText(file);
      const result = parseMusicXml(xmlText);
      onBeatEventsLoaded(result.beatEvents, result.warnings, xmlText);
      return;
    }

    onWarnings(["Unsupported file type. Use .musicxml, .xml, .mxl, or .pdf."]);
  };

  return (
    <section className="upload-panel">
      <div>
        <h1>Accordion Tutor</h1>
        <p>Upload a MusicXML score and step through it beat by beat. The accordion diagram highlights exactly which key or Stradella button to press — bass note on strong beats, chord button on weak beats.</p>
      </div>
      <div className="upload-actions">
        <label className="file-picker">
          Upload Score
          <input
            type="file"
            accept=".pdf,.musicxml,.xml,.mxl"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
        </label>
        <button type="button" onClick={onUseSample}>
          Load Sample
        </button>
      </div>
    </section>
  );
}
