# Accordion Tutor

A beginner-friendly web app for **120-bass piano accordion** practice. Upload a PDF or MusicXML score, step through it beat by beat, and see exactly which right-hand piano key and left-hand Stradella button to press — highlighted live on an SVG accordion diagram.

---

## Features

| Feature | Details |
|---|---|
| **Beat-by-beat navigation** | Arrow keys, Space, Prev/Next buttons, or click any beat in the strip |
| **SVG accordion diagram** | Vertical piano keyboard (right hand) + full 120-bass Stradella grid (left hand) |
| **Bass / chord alternation** | Odd beats (1, 3) highlight the **bass note** button in green; even beats (2, 4) highlight the **chord button** in amber — never both at once |
| **Autoplay metronome** | Plays a Web Audio click, advances beats automatically, stops at the last beat |
| **BPM control** | Slider (20–200 BPM) + number input, both stay in sync. Default 80 BPM |
| **PDF upload** | Converts PDF scores to MusicXML via a local Audiveris OMR server |
| **MusicXML upload** | Parsed entirely in the browser — no server required |
| **Built-in sample score** | 2-measure demo (C → Dm → G7 → Bbdim) loads instantly |
| **Warnings panel** | Unsupported chords, missing harmony tags, and parse issues reported inline |

---

## How It Works

```
PDF  ──► OMR server (Audiveris)  ──► MusicXML
                                          │
MusicXML ─────────────────────────────────┘
         │
         ▼
    parseMusicXml()
         │
         ▼
    BeatEvent[]   (one event per beat, per measure)
         │
         ▼
    Accordion diagram  ──  piano keys highlighted
                       ──  Stradella button highlighted (bass OR chord)
```

### Beat Model (`BeatEvent`)

Each beat event carries:

- `measureNumber`, `beatNumber`, `beatsPerMeasure`
- `activeRightHandNotes` — notes sounding on this beat (includes held notes)
- `startingRightHandNotes` — notes that begin on this beat
- `chordSymbol` — current chord (carries forward until a new harmony tag)
- `activeLeftHandButtons` — exactly **one** Stradella button (bass or chord row)
- `leftHandAction` — `"bass"` | `"chord"` | `"none"`
- `warnings` — per-beat parse issues

### Stradella Bass / Chord Alternation

| Time signature | Bass beats | Chord beats |
|---|---|---|
| 4/4 | 1, 3 | 2, 4 |
| 2/4 | 1 | 2 |
| 3/4 | 1 | 2, 3 |

Chord symbol → button mapping:

| Symbol | Bass button | Chord button |
|---|---|---|
| `C` | `bass-C` | `major-C` |
| `Cm` / `Cmin` / `C-` | `bass-C` | `minor-C` |
| `C7` | `bass-C` | `seventh-C` |
| `Cdim` / `C°` | `bass-C` | `diminished-C` |

Accidentals normalize to ASCII (`B♭` → `Bb`, `F♯` → `F#`).

---

## Project Structure

```
accordion-tutor/
├── preview.html              ← Self-contained app (no build needed)
├── src/
│   ├── App.tsx               ← Root React component, keyboard navigation, autoplay state
│   ├── components/
│   │   ├── AccordionDiagram.tsx
│   │   ├── PianoKeyboard.tsx
│   │   ├── StradellaBass.tsx
│   │   ├── ScoreViewer.tsx
│   │   ├── BeatNavigator.tsx
│   │   ├── BeatInfoPanel.tsx
│   │   └── UploadPanel.tsx
│   ├── data/
│   │   ├── pianoKeyboardLayout.ts
│   │   ├── stradella120Layout.ts
│   │   └── sampleBeatData.ts
│   ├── lib/
│   │   ├── scoreTypes.ts
│   │   ├── extractBeatEvents.ts   ← Beat alternation logic
│   │   ├── mapChordToStradella.ts
│   │   ├── mapNotesToPianoKeys.ts
│   │   ├── parseMusicXml.ts
│   │   └── omrPipeline.ts
│   └── styles/
│       └── accordion.css
├── server/
│   └── omr-server.mjs            ← Local OMR bridge (Node.js, no npm deps)
├── scripts/
│   └── start-omr-server.ps1      ← Windows launcher
├── public/
│   └── sample-score.musicxml
└── package.json
```

**Two entry points:**
- `preview.html` — standalone single-file app, opens directly in any browser with no build step. This is the primary interface.
- `src/` — React + TypeScript + Vite app, mirrors all logic from `preview.html` in a component architecture.

---

## Dependencies

### Runtime (browser)

| Dependency | Version | Purpose |
|---|---|---|
| React | ^19.0.0 | UI component tree (React app only) |
| react-dom | ^19.0.0 | DOM rendering (React app only) |
| opensheetmusicdisplay | ^1.9.2 | Optional: renders uploaded MusicXML as a score image |
| Web Audio API | browser built-in | Metronome click sound in autoplay |
| DOMParser | browser built-in | MusicXML parsing |

### Build tools (React app only)

| Dependency | Version | Purpose |
|---|---|---|
| Vite | ^7.0.0 | Dev server and bundler |
| TypeScript | ^5.8.0 | Type checking |
| @vitejs/plugin-react | ^5.0.0 | JSX transform for Vite |

### External tools (PDF support only)

| Tool | Purpose |
|---|---|
| **Node.js** (v18+) | Runs the local OMR bridge server |
| **Java** (JDK 21+) | Required by Audiveris |
| **Audiveris 5.x** | Optical Music Recognition — converts PDF → MusicXML |
| **Tesseract OCR** (optional) | Improves chord symbol text recognition inside Audiveris |

> PDF support is **optional**. MusicXML files work with no external tools at all.

---

## Installation

### Option A — Standalone (`preview.html`, recommended for beginners)

No installation needed.

1. Download or clone this repository.
2. Open `preview.html` directly in Chrome, Edge, or Firefox.
3. Click **Load Sample** or upload a `.musicxml` / `.xml` file.

For PDF upload, also complete the OMR server setup below.

---

### Option B — React + Vite dev server

**Requirements:** Node.js 18+

```bash
git clone https://github.com/<your-username>/accordion-tutor.git
cd accordion-tutor
npm install
npm run dev
```

Open the local URL shown in the terminal (default: `http://localhost:5173`).

---

### OMR Server Setup (PDF support)

**Requirements:** Node.js 18+, Java JDK 21, Audiveris 5.x

#### 1. Install Java

Download from [Adoptium](https://adoptium.net/) or [Oracle](https://www.oracle.com/java/). Java 21 or newer.

Set `JAVA_HOME` before starting the server:

**Windows (PowerShell):**
```powershell
$env:JAVA_HOME = "C:\Program Files\Java\jdk-XX"
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
```

**macOS / Linux:**
```bash
export JAVA_HOME=/path/to/jdk
export PATH=$JAVA_HOME/bin:$PATH
```

#### 2. Install Audiveris

Download Audiveris 5.x from [github.com/Audiveris/audiveris/releases](https://github.com/Audiveris/audiveris/releases).

The app automatically looks for Audiveris at `.omr/audiveris/app-5.x.x/bin/Audiveris.bat` inside the project folder. Place it there, or pass the path explicitly when starting the server.

#### 3. Install Tesseract language data (optional)

Tesseract improves recognition of chord symbols printed on the score. Place the `tessdata` folder at `.omr/tessdata/` inside the project root.

#### 4. Start the OMR server

**Windows (PowerShell):**
```powershell
powershell -ExecutionPolicy Bypass -File ".\scripts\start-omr-server.ps1"
```

With an explicit Audiveris path:
```powershell
powershell -ExecutionPolicy Bypass -File ".\scripts\start-omr-server.ps1" -AudiverisCmd "C:\Path\To\Audiveris\bin\Audiveris.bat"
```

**macOS / Linux:**
```bash
AUDIVERIS_CMD=/path/to/audiveris npm run omr:server
```

The server starts on `http://localhost:8787`. Keep this terminal open while using PDF upload.

---

## How to Use

### Navigation

| Action | Control |
|---|---|
| Next beat | `→` arrow key or **Next →** button |
| Previous beat | `←` arrow key or **← Prev** button |
| Jump to any beat | Click the beat in the score strip |
| First beat | `Home` key |
| Last beat | `End` key |
| Toggle autoplay | `Space` key or **▶ Play** button |

### Reading the Accordion Diagram

```
┌─────────────────────┐  ╱╲  ┌──────────┐
│   Stradella grid    │ ╱  ╲ │  Piano   │
│   (left hand)       │ ╲  ╱ │  keys    │
│                     │  ╲╱  │(right hd)│
└─────────────────────┘       └──────────┘
```

- **Green button** = press the **bass note** (strong beat)
- **Amber button** = press the **chord button** (weak beat)
- **Yellow piano key** = press this piano key (right hand)
- The **Current Beat** panel on the right shows the chord symbol, the exact button/key name, and whether it is a bass or chord beat.

### Autoplay / Metronome

1. Set the BPM using the slider or the number input.
2. Press **▶ Play** (or `Space`) to start.
3. The app advances one beat per tick, plays a click sound (louder on beat 1), and flashes the indicator dot.
4. Playback stops automatically at the last beat.
5. Pressing `←` / `→` or clicking a beat while playing stops the autoplay.

### Uploading a Score

| File type | What happens |
|---|---|
| `.musicxml` / `.xml` | Parsed in the browser instantly |
| `.pdf` | Sent to the local OMR server → converted by Audiveris → parsed as MusicXML |
| `.mxl` | Recognized but not yet supported (export as uncompressed `.musicxml`) |

---

## Known Limitations

- Only the **first MusicXML part** is read as right-hand notes.
- Extended chords (`Cmaj7`, `C6`, `C9`, sus chords, slash chords) are not mapped to Stradella buttons and produce warnings.
- Compressed `.mxl` archives are not decompressed in-browser.
- PDF recognition quality depends on scan quality and Audiveris output.
- The counterbass row is displayed on the Stradella grid but is never highlighted automatically.

---

## License

MIT
