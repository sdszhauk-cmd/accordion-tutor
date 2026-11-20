const { before, after, test } = require("node:test");
const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const { stripTypeScriptTypes } = require("node:module");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const fixture = name => readFile(path.join(__dirname, "fixtures", name + ".musicxml"), "utf8");
let browser;
let page;

before(async () => {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  page = await browser.newPage();
  // Supply the actual app sources to a real browser, including its XML DOM.
  // The optical score renderer is independent of parsing and diagram updates.
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== "http://accordion.test") return route.abort();
    if (url.pathname === "/preview.html") {
      return route.fulfill({ path: path.join(root, "preview.html"), contentType: "text/html" });
    }
    if (/^\/src\/(?:lib|data)\/[A-Za-z0-9]+$/.test(url.pathname)) {
      const source = await readFile(path.join(root, url.pathname + ".ts"), "utf8");
      return route.fulfill({ body: stripTypeScriptTypes(source), contentType: "text/javascript" });
    }
    return route.fulfill({ status: 404, body: "" });
  });
  await page.goto("http://accordion.test/preview.html");
});
after(async () => browser?.close());

async function parse(entry, xml) {
  return page.evaluate(async ({ entry, xml }) => {
    if (entry === "standalone") return parseMusicXml(xml).events;
    const parser = await import("/src/lib/parseMusicXml");
    return parser.parseMusicXml(xml).beatEvents;
  }, { entry, xml });
}

// Each attack is [measure, offset in quarters, pitch, duration in quarters].
// Measure starts are elapsed quarter notes since the start of the piece.
function timeline(events) {
  const attacks = [];
  const starts = [];
  let elapsed = 0;
  let measureStart = 0;
  let measure;
  for (const beat of events) {
    if (measure !== beat.measureNumber) {
      measure = beat.measureNumber;
      measureStart = elapsed;
      starts.push([measure, elapsed]);
    }
    const width = beat.durationQuarters ?? 1;
    const groups = beat.noteOnsets ?? [{ posInBeat: 0, notes: beat.startingRightHandNotes }];
    for (const group of groups) {
      const offset = elapsed - measureStart + group.posInBeat * width;
      for (const note of group.notes) {
        attacks.push([measure, offset, note.pitch.name, note.durationQuarters ?? note.durationBeats * width]);
      }
    }
    elapsed += width;
  }
  return { starts, attacks };
}

function checkRows(actual, expected, label) {
  for (let i = 0; i < Math.max(actual.length, expected.length); i++) {
    const [measure, offset] = expected[i] ?? actual[i];
    assert.deepEqual(actual[i], expected[i], label + " at measure " + measure + ", quarter offset " + offset +
      "\nexpected " + JSON.stringify(expected[i]) + "\nreceived " + JSON.stringify(actual[i]));
  }
}

function leftHand(events) {
  return events.map(beat => [beat.measureNumber, beat.beatNumber - 1,
    beat.chordSymbol?.raw ?? null, beat.activeLeftHandButtons.map(button => button.id)]);
}

for (const entry of ["standalone", "react"]) {
  test(entry + " | built-in sample control", async () => {
    const xml = await page.evaluate(() => SAMPLE_XML);
    const events = await parse(entry, xml);
    const { attacks, starts } = timeline(events);
    checkRows(starts, [[1, 0], [2, 4]], "measure start");
    checkRows(attacks, [
      [1, 0, "C4", 2], [1, 0, "E4", 1], [1, 0, "G4", 1],
      [1, 2, "F4", 2], [1, 2, "A4", 1], [2, 0, "E5", 1],
      [2, 1, "G5", 1], [2, 2, "F#4", 2],
    ], "right-hand attack");
    checkRows(leftHand(events), [
      [1, 0, "C", ["bass-C"]], [1, 1, "C", ["major-C"]],
      [1, 2, "Dm", ["bass-D"]], [1, 3, "Dm", ["minor-D"]],
      [2, 0, "G7", ["bass-G"]], [2, 1, "G7", ["seventh-G"]],
      [2, 2, "Bbdim", ["bass-Bb"]], [2, 3, "Bbdim", ["diminished-Bb"]],
    ], "left hand");
  });
  test(entry + " | six eighths and following downbeat", async () => {
    const events = await parse(entry, await fixture("six-eight"));
    const { attacks, starts } = timeline(events);
    checkRows(starts, [[1, 0], [2, 3]], "measure start");
    checkRows(attacks, [
      [1, 0, "C4", .5], [1, .5, "D4", .5], [1, 1, "E4", .5],
      [1, 1.5, "F4", .5], [1, 2, "G4", .5], [1, 2.5, "A4", .5], [2, 0, "B4", 3],
    ], "right-hand attack");
  });
  test(entry + " | explicit silence, carry across bar, resume", async () => {
    const events = await parse(entry, await fixture("no-chord"));
    checkRows(leftHand(events), [
      [1, 0, "C", ["bass-C"]], [1, 1, null, []], [1, 2, null, []], [1, 3, null, []],
      [2, 0, null, []], [2, 1, "G", ["major-G"]], [2, 2, "G", ["bass-G"]], [2, 3, "G", ["major-G"]],
    ], "left hand");
  });
}

test("standalone | uploading and stepping updates the instrument diagram", async () => {
  await page.locator("#file").setInputFiles(path.join(__dirname, "fixtures/no-chord.musicxml"));
  await page.getByText(/MusicXML loaded: no-chord.musicxml/).first().waitFor({ state: "attached" });
  await page.locator('[data-bid="bass-C"].is-active-bass').waitFor();
  await page.locator("#next").click();
  await page.locator('[data-key="D4"].is-active').waitFor();
  assert.equal(await page.locator("#bass .is-active-bass, #bass .is-active-chord").count(), 0,
    "a button is still highlighted in measure 1 at quarter offset 1");
});

test("standalone | autoplay schedules the next 6/8 downbeat after three quarters", async () => {
  await page.locator("#file").setInputFiles(path.join(__dirname, "fixtures/six-eight.musicxml"));
  await page.getByText(/MusicXML loaded: six-eight.musicxml/).first().waitFor({ state: "attached" });
  await page.locator("#bpmnum").fill("120");
  // Observe the metronome's scheduled audio timestamps, independent of frame latency.
  await page.evaluate(() => {
    const original = playClick;
    window.downbeats = [];
    window.restoreClick = () => { playClick = original; };
    playClick = (strong, when) => {
      if (strong) window.downbeats.push(when);
      original(strong, when);
    };
  });
  try {
    await page.locator("#playbtn").click();
    await page.waitForFunction(() => window.downbeats.length >= 2, null, { timeout: 6000 });
    const gap = await page.evaluate(() => window.downbeats[1] - window.downbeats[0]);
    assert.ok(Math.abs(gap - 1.5) < 0.000001, "expected 1.5 seconds between downbeats, got " + gap);
    await page.locator('[data-key="B4"].is-active').waitFor();
  } finally {
    await page.evaluate(() => { stopAutoplay(); window.restoreClick(); });
  }
});
