# Accordion Tutor

A beginner-friendly web app for **120-bass piano accordion** practice. Upload a PDF or MusicXML score, step through it beat by beat, and see exactly which right-hand piano key and left-hand Stradella button to press — highlighted live on an SVG accordion diagram.

---

## Features

| Feature | Details |
|---|---|
| **Live score display** | Uploaded MusicXML is rendered as a full musical score using [OpenSheetMusicDisplay](https://opensheetmusicdisplay.org/) (OSMD). The score auto-zooms to fill the panel width |
| **Score highlight bar** | A dark-gold sliding highlight follows the current beat across the rendered score. Moves smoothly within a staff line and jumps instantly between lines |
| **Click-on-score navigation** | Click any beat directly on the rendered score to jump to it — transparent overlay buttons are positioned over each beat |
| **Auto-scrolling score** | The score panel smoothly scrolls to keep the current staff line near the top as the music progresses |
| **Beat-by-beat navigation** | Arrow keys, Space, Prev/Next buttons, or click any beat on the score |
| **SVG accordion diagram** | Vertical piano keyboard (right hand) + full 120-bass Stradella grid (left hand), displayed to the left of the score |
| **Bass / chord alternation** | Odd beats (1, 3) highlight the **bass note** button in green; even beats (2, 4) highlight the **chord button** in amber — never both at once |
| **Autoplay metronome** | Plays a Web Audio click, advances beats automatically, stops at the last beat. Beats are scheduled on the Web Audio clock, so the tempo does not drift over long scores |
| **BPM control** | Slider (20–200 BPM) + number input, both stay in sync. Default 80 BPM |
| **Note sound** | Optional toggle — plays a short piano-like tone for each right-hand note as it lights up, including sub-beat off-beat notes in sequence |
| **Bass sound** | Optional toggle — plays the Stradella button sound (single bass note on bass beats, full chord voicing on chord beats) |
| **Sub-beat note animation** | When a beat contains off-beat notes, they are highlighted one by one at the correct rhythmic interval based on the current BPM |
| **PDF upload** | Converts PDF scores to MusicXML via a local Audiveris OMR server |
| **MusicXML upload** | Parsed entirely in the browser — no server required |
| **Saved score library** | Uploaded scores are automatically saved to IndexedDB and persist across page refreshes. Reload any previously uploaded score from the "Saved Scores" dropdown, or delete it with the ✕ button |
| **Built-in sample score** | 2-measure demo (C → Dm → G7 → Bbdim) loads instantly |
| **Extended chord support** | `Cmaj7`, `C6`, `C9`, `Csus4`, `Caug`, `Cm7b5`, slash chords and the rest are reduced to the nearest Stradella button, and the Current Beat panel shows what is actually played (`Cmaj7 → C`) |
| **Multi-part scores** | Chord symbols are collected from every part, so a separate chord or guitar staff is picked up. Notes come from the melody part, auto-detected and switchable from a dropdown |
| **Manual chord entry** | A **Chords** box overrides the score's chords one measure at a time — the practical fallback when OMR misses the harmony |
| **Warnings panel** | Unsupported chords, missing harmony tags, and parse issues reported inline |

---

## How It Works

```
PDF  ──► OMR server (Audiveris)  ──► MusicXML
                                          │
MusicXML ─────────────────────────────────┘
         │
         ├──► parseMusicXml()
         │         │
         │         ▼
         │    BeatEvent[]  (one event per beat, per measure)
         │         │
         │         ▼
         │    Accordion diagram  ──  piano keys highlighted
         │                       ──  Stradella button highlighted
         │
         └──► OSMD score renderer
                   │
                   ▼
              Rendered score with highlight bar + click overlay
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

Chord symbol → button mapping. A Stradella board only has four chord rows, so
richer symbols are reduced to the closest playable button:

| Symbol | Bass button | Chord button | Exact? |
|---|---|---|---|
| `C` / `Cmaj` | `bass-C` | `major-C` | yes |
| `Cm` / `Cmin` / `C-` | `bass-C` | `minor-C` | yes |
| `C7` | `bass-C` | `seventh-C` | yes |
| `Cdim` / `Cdim7` / `C°` | `bass-C` | `diminished-C` | yes |
| `Cmaj7` / `CΔ` / `C6` / `Cadd9` / `Csus4` / `Caug` / `C+` | `bass-C` | `major-C` | reduced |
| `Cm7` / `Cm6` / `Cm9` / `Cm11` | `bass-C` | `minor-C` | reduced |
| `C9` / `C13` / `C7sus4` / `C7b9` / `Caug7` | `bass-C` | `seventh-C` | reduced |
| `Cm7b5` / `Cø` | `bass-C` | `diminished-C` | reduced |
| `C/G` (slash) | `bass-G` | `major-C` | bass note follows the slash |

Reduced chords are played, not rejected. The Current Beat panel shows the
reduction (`Cmaj7 → C`) and the warnings panel lists every symbol that was
simplified, so you can see what the arrangement loses.

Accidentals normalize to ASCII (`B♭` → `Bb`, `F♯` → `F#`), and unusual
spellings fall back to their enharmonic equivalent (`E#` → `F`).

MusicXML `<kind>` values are mapped in full — `major-seventh`, `minor-seventh`,
`half-diminished`, `dominant-ninth`, `suspended-fourth`, `augmented` and the
rest — rather than the four values the parser previously understood. `<bass>`
elements become slash chords, and `kind="none"` is treated as no chord.

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

### Python (PDF support)

`scripts/extract_chords.py` and `scripts/extract_notes.py` need Python 3 and
PyMuPDF. The OMR server shells out to them, so install it before uploading PDFs:

```bash
pip install pymupdf
```

Set `PYTHON_CMD` if `python` is not the right interpreter on your PATH, and
`DIRECT_MIN_BAR_FIT` (default `0.7`) to change how strict the note-reading
confidence gate is.

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
git clone https://github.com/sdszhauk-cmd/accordion-tutor.git
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

### Layout

The main view has two panels side by side:

```
┌──────────────────────────┐  ┌─────────────────────────────┐
│   Accordion Schematic    │  │   Score Display              │
│                          │  │                               │
│  ┌──────┐ ╱╲ ┌───────┐  │  │  ♩ ♩ ♩ ♩ │ ♩ ♩ ♩ ♩ │       │
│  │Strad.│╱  ╲│ Piano │  │  │  ▓▓▓▓ ← highlight bar       │
│  │ grid │╲  ╱│ keys  │  │  │  ♩ ♩ ♩ ♩ │ ♩ ♩ ♩ ♩ │       │
│  └──────┘ ╲╱ └───────┘  │  │                               │
│                          │  │  (auto-scrolls as you play)  │
│  ┌──────────────────┐   │  │                               │
│  │  Current Beat    │   │  └─────────────────────────────┘
│  │  info panel      │   │
│  └──────────────────┘   │
└──────────────────────────┘
```

### Navigation

| Action | Control |
|---|---|
| Next beat | `→` arrow key or **Next →** button |
| Previous beat | `←` arrow key or **← Prev** button |
| Jump to any beat | Click directly on the beat in the rendered score |
| First beat | `Home` key |
| Last beat | `End` key |
| Toggle autoplay | `Space` key or **▶ Play** button |

### Reading the Accordion Diagram

- **Green button** = press the **bass note** (strong beat)
- **Amber button** = press the **chord button** (weak beat)
- **Yellow piano key** = press this piano key (right hand)
- The **Current Beat** panel below the diagram shows the chord symbol, the exact button/key name, and whether it is a bass or chord beat.

### Score Display

The rendered score shows the full notation of the uploaded MusicXML file. A **dark-gold highlight bar** tracks the current beat as you navigate or play:

- **Within a staff line**: the bar slides smoothly to the next beat
- **Between staff lines**: the bar jumps instantly to the new line
- **Auto-scroll**: the score panel scrolls automatically to keep the active staff line near the top
- **Click navigation**: click anywhere on the score to jump to that beat

### Chord Override

When a score has no chord symbols — common after PDF/OMR conversion — type the
progression into the **Chords** box and press Apply (or Enter):

```
Am | Am | Dm E7 | Am
```

One group per measure, separated by `|`. Several chords in one group are spread
evenly across that measure's beats, and `-` holds the previous chord. Clear the
box and press Clear to fall back to whatever the score itself contains. The
override is re-applied whenever the score is re-parsed, including when the
melody part changes.

### Extracting Chords From a PDF (`scripts/extract_chords.py`)

Engraved PDFs - anything exported from MuseScore, Finale, Sibelius or a
publisher, as opposed to a scan - keep chord symbols as **ordinary text**, not as
shapes that have to be recognised. That makes chord extraction a layout problem
rather than an OMR problem, and it is far more accurate than Audiveris for this
one job:

```bash
python scripts/extract_chords.py "zw_scores/Hungarian Dance No. 5.pdf"
```

It prints a ready-made override string for the **Chords** box above:

```
Gm | - | D7 | Gm | Cm | Gm | D7 | Gm | - | - | D7 | Gm | Cm Gm | ...
```

Paste that in, press Apply, and the score plays with correct harmony regardless
of what the OMR made of the chord symbols. `--json` emits the full structure
instead.

How it works, and where it can go wrong:

| Step | Method | Failure mode |
|---|---|---|
| Staff detection | Horizontal rules grouped into runs of five at the page's modal line spacing | Volta brackets and hairpins are also long horizontal strokes; the spacing test is what excludes them |
| Measure segmentation | Vertical strokes spanning a full system are barlines; note stems span only part of a staff | On a grand staff a stem can span one staff exactly, so multi-staff systems require the *full system* span |
| Measure numbers | Engraved numbers at each system's left edge give the expected measure count, and **override** the barline count when they disagree | Absent on some editions (Bella Ciao has none), in which case barlines alone are trusted |
| Chord layer | Scores often carry two text layers - chord symbols plus smaller fingering or bass-button hints. The larger is chosen | Force the other with `--layer "FontName:size"` |
| Accidentals | A flat or sharp is frequently a separate music-font glyph, so `B` and `B♭` extract identically. Known accidental glyphs are merged back in | Unrecognised glyphs are **reported, not guessed**, so a wrong chord is never invented |
| Notation | Letter (`Gm`) and Spanish/solfege (`Solm`, `Dom`, `Lab`) are both understood, auto-detected per file | Force with `--notation letter|solfege` |

Measured on the four scores in `zw_scores/`: measure segmentation agrees with
every engraved measure number in all three scores that print them, and all 18
distinct chord symbols extracted map to real Stradella buttons.

**Scanned PDFs are rejected** with a clear message - there is no text layer to
read, and that genuinely does need OMR.

### Extracting Notes From a PDF (`scripts/extract_notes.py`)

The note-reading counterpart. Same idea, same constraint - engraved PDFs only -
and it emits MusicXML the app can load directly:

```bash
python scripts/extract_notes.py "zw_scores/En las colinas de Manchuria. Vals ruso.pdf" \
    --beats 3 --with-chords --musicxml debug/colinas.musicxml
```

The trick that makes it work is reading each glyph's **origin** (PyMuPDF's
`rawdict`) rather than its bounding box. A music font's glyph box is the em box,
roughly twice the height of a staff, so box centres are useless for pitch;
origins land exactly on the diatonic grid.

Nothing is hard-coded to a font. Roles are learned per document from position:

| Element | How it is identified |
|---|---|
| Clef | Leftmost glyph on the staff. A G clef's origin sits on the G line, an F clef's on the F line - which line it lands on says which clef it is |
| Key signature | The run of repeated glyphs after the clef. Sharps appear in the order F C G D A E B and flats B E A D G C F, so the *positions* reveal which accidental the glyph is |
| Accidentals | A glyph that sits immediately left of a notehead at the same pitch. Reliable: 84-85% of instances on the test scores |
| Noteheads | The three most frequent grid-aligned non-accidental glyphs, each needing many distinct vertical positions - rests sit at fixed heights, noteheads move with the pitch |
| Rests | The same test read the other way: grid-height glyphs that *don't* move with the pitch |
| Time signature | The ASCII digits stacked at the staff head - upper is beats, lower is beat type |
| Beams | Filled polygons made of straight edges. A slur is filled *curves* and the grand-staff brace is tall and narrow, so shape alone separates them. Each beam crossing a stem halves the note |
| Note values | **Solved**, not measured - see below |
| Dots | A non-notehead glyph immediately right of a notehead at the same pitch |

Two approaches were tried and **rejected**, which is worth recording so they are
not retried:

- **Stem adjacency** to find noteheads. Articulations near stems also score
  100%, while genuine half notes score as low as 39%.
- **Scale fit** as an arbiter of which glyphs are noteheads. In a key with few
  accidentals most naturals are already in-scale, so junk scores 100% too - it
  cheerfully admitted ASCII parentheses as noteheads and injected phantom notes.
  It survives only as the `--check` diagnostic.

Measured on the two MuseScore scores in `zw_scores/`, **100% of extracted
pitches fit a single scale**, and that scale agrees with both the engraved key
signature and the independently extracted chords (E minor for *En las colinas*,
C minor for *Amur Waves*). The generated MusicXML loads in the app with no
warnings: 70 measures, 210 beat events, 207 carrying notes.

#### How note values are worked out

A notehead's codepoint is private to the font, so what it is *worth* cannot be
looked up. Horizontal spacing was tried first and is too blunt: in a waltz the
median space around a half note is barely wider than around a quarter, and two
different shapes collapsed onto the same value.

What works is the redundancy in the notation itself - **the durations in a
measure have to add up to the bar**. With only three notehead shapes there are a
few dozen candidate assignments, so the right one can simply be searched for:
the assignment that makes the most measures add up is the one the engraver used.
On both test scores it independently recovers the same answer, half note = 2
beats, and the bar check then doubles as the accuracy score:

| Score | Measures adding up from note values |
|---|---|
| En las colinas de Manchuria | 128/138 (93%) |
| Amur Waves | 154/179 (86%) |

Adding rests took those from 85% and 68% - a measure containing a rest can never
be made to balance from its noteheads alone.

Where a measure still doesn't balance - an unhandled tie, tuplet or second voice
- that measure alone falls back to the spacing estimate, so a local failure
stays local. Both generated files load in the app with **no warnings**, and half
notes now correctly sustain across beats instead of being re-struck.

> **Still not handled:** ties, tuplets, multiple voices per staff, grace notes,
> and the top staff only. Roughly one measure in ten falls back to spacing.

### Autoplay / Metronome

1. Set the BPM using the slider or the number input.
2. Press **▶ Play** (or `Space`) to start.
3. The app advances one beat per tick, plays a click sound (louder on beat 1), and flashes the indicator dot.
4. Playback stops automatically at the last beat.
5. Pressing `←` / `→` or clicking a beat while playing stops the autoplay.

### Sound Toggles

Both toggles are in the autoplay bar and are **off by default**.

| Toggle | What it does |
|---|---|
| **Note sound** | Plays a short piano-like tone for each right-hand note as it is highlighted. On beats with off-beat notes, each note sounds at the correct rhythmic interval based on the current BPM. |
| **Bass sound** | Plays the Stradella button sound each time a beat is navigated to. Bass beats play a single root note; chord beats play the full chord voicing (major, minor, dominant 7th, or diminished). |

### Uploading a Score

| File type | What happens |
|---|---|
| `.musicxml` / `.xml` | Parsed in the browser instantly. **Recommended** — most reliable for notes and chord symbols |
| `.pdf` | Sent to the local server, which **reads engraved PDFs directly** and only falls back to Audiveris OMR when it has to. See note below |
| `.mxl` | Recognized but not yet supported (export as uncompressed `.musicxml`) |

#### What happens to an uploaded PDF

The server tries the cheap, exact route before the expensive, approximate one:

1. **Chord symbols** are read straight from the PDF's text layer
   (`scripts/extract_chords.py`). This is not recognition - in an engraved PDF
   the chords are already text - and it is dramatically better than OMR at the
   job. They are sent back to the browser, dropped into the **Chords** box and
   applied automatically when they line up measure-for-measure.
2. **Notes** are read from the notehead glyphs (`scripts/extract_notes.py`).
   This is trusted only when the score verifies itself - see the bar check
   above. Above 70% of measures adding up, Audiveris is **never run at all**:
   no Java, no OMR, and the upload completes in well under a second instead of
   tens of seconds.
3. **Otherwise** Audiveris does the notes as before, while the directly-read
   chords are still used, because they are reliable even where rhythm is not.
4. If Audiveris is not installed and the direct reading was weak, the direct
   reading is used anyway, and the warnings panel says exactly how far it is
   trusted.

Every step is reported in the warnings panel, so you can always see which route
a given score took and how much of it was verified.

> **PDF quality note:** direct reading only works on *engraved* (vector) PDFs.
> A scan has no text layer and no glyphs, so it still needs Audiveris OMR,
> which can miss chord symbols, misread notes, or produce incomplete MusicXML.
> For best results use a real `.musicxml` file. Many scores are available as
> MusicXML on [MuseScore.com](https://musescore.com) (export as uncompressed
> MusicXML). Alternatively, open the OMR output in
> [MuseScore](https://musescore.org/) (free), correct any errors, and re-export.

### Saved Scores

Uploaded scores are automatically saved to IndexedDB in the browser:

- **Saved Scores dropdown** — select any previously uploaded score to reload it instantly
- **Delete button (✕)** — remove a saved score from the library
- The built-in sample is always available and is not saved to the library
- Saved scores persist across page refreshes but are specific to the browser profile

---

## Known Limitations

- Right-hand notes come from **one part at a time**. Chord symbols are read from every part, and the melody part is auto-detected (the first part with pitched notes) and can be changed from the part dropdown, but the app does not merge two staves into one line.
- Extended chords are **approximated, not voiced** — `Cmaj7` plays as `C`, `C9` as `C7`. The Stradella board has no button for them; the Current Beat panel names the substitution.
- Compressed `.mxl` archives are not decompressed in-browser.
- `scripts/extract_chords.py` and `scripts/extract_notes.py` work only on
  engraved (vector) PDFs. Scans have no text layer and still need OMR.
- `extract_notes.py` reads the **top staff only** (the melody), derives rhythm
  from spacing rather than from note values, and does not handle ties, rests,
  tuplets, voices or grace notes. Treat its rhythm as a starting point.
- **PDF → MusicXML conversion is lossy.** Audiveris OMR frequently misses chord symbols, misreads accidentals, or drops notes — especially on scanned or handwritten scores. Always prefer native `.musicxml` files when available.
- The counterbass row is displayed on the Stradella grid but is never highlighted automatically.
- Saved scores are stored in the browser's IndexedDB and do not sync across devices or browsers.

---

## License

MIT
