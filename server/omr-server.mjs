import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const port = Number(process.env.OMR_PORT ?? 8787);
const audiverisCommand = process.env.AUDIVERIS_CMD ?? "audiveris";
const pythonCommand = process.env.PYTHON_CMD ?? "python";
const scriptsDir = join(dirname(dirname(fileURLToPath(import.meta.url))), "scripts");
// Engraved PDFs are read directly; below this share of measures adding up, the
// note reading is not trusted and Audiveris does the notes instead.
const DIRECT_NOTE_MIN_BAR_FIT = Number(process.env.DIRECT_MIN_BAR_FIT ?? 0.7);
const defaultTessDataPath = join(process.cwd(), ".omr", "tessdata");
const tessDataPrefix = process.env.TESSDATA_PREFIX ?? (existsSync(defaultTessDataPath) ? defaultTessDataPath : undefined);
const debugDir = join(process.cwd(), "debug");
const lastOmrPath = join(debugDir, "last-omr.musicxml");

const json = (response, status, payload) => {
  response.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
};

const run = (command, args, cwd) =>
  new Promise((resolve, reject) => {
    const isWindowsBatch =
      process.platform === "win32" && /\.(bat|cmd)$/i.test(command);
    const env = tessDataPrefix ? { ...process.env, TESSDATA_PREFIX: tessDataPrefix } : process.env;
    const child = isWindowsBatch
      ? spawn("cmd.exe", ["/d", "/c", "call", command, ...args], { cwd, env })
      : spawn(command, args, { cwd, env });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr || stdout || `OMR command exited with code ${code}`));
    });
  });

// Unlike run(), this resolves on a non-zero exit: the extractors report a
// scanned PDF as JSON on stdout with exit code 1, and that is a normal answer.
const runPython = (args, cwd) =>
  new Promise((resolve) => {
    const child = spawn(pythonCommand, args, { cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => resolve({ code: -1, stdout, stderr: String(error) }));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });

const parseJsonOutput = (stdout) => {
  const start = stdout.indexOf("{");
  if (start === -1) return null;
  try {
    return JSON.parse(stdout.slice(start));
  } catch {
    return null;
  }
};

/**
 * Read an engraved PDF directly, with no OMR at all.
 *
 * Chord symbols and noteheads are already present in a vector PDF as placed
 * text and glyphs, so they can be read exactly rather than recognised. Chords
 * come back reliably across every test score; note *rhythm* does not, so the
 * caller decides whether to trust the notes based on how many measures add up.
 */
const readEngravedPdf = async (pdfPath, workDir) => {
  const out = { chords: null, notes: null, musicXml: null };

  const chords = await runPython(
    [join(scriptsDir, "extract_chords.py"), pdfPath, "--json"], workDir);
  if (chords.code === 0) out.chords = parseJsonOutput(chords.stdout);

  const notesXmlPath = join(workDir, "direct.musicxml");
  const notes = await runPython(
    [join(scriptsDir, "extract_notes.py"), pdfPath, "--json", "--with-chords",
     "--musicxml", notesXmlPath], workDir);
  const stats = parseJsonOutput(notes.stdout);
  if (notes.code === 0 && stats && !stats.error) {
    out.notes = stats;
    if (existsSync(notesXmlPath)) out.musicXml = await readFile(notesXmlPath, "utf8");
  } else if (stats && stats.error) {
    out.notesError = stats.error;
  } else if (notes.code !== 0) {
    out.notesError = (notes.stderr || "").trim().split("\n").slice(-1)[0] || "extractor failed";
  }
  return out;
};

const readRequestBody = (request) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });

const parseMultipartPdf = (contentType, body) => {
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[1] ?? contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[2];
  if (!boundary) throw new Error("Missing multipart boundary.");

  const delimiter = Buffer.from(`--${boundary}`);
  const parts = [];
  let cursor = body.indexOf(delimiter);

  while (cursor !== -1) {
    const next = body.indexOf(delimiter, cursor + delimiter.length);
    if (next === -1) break;
    parts.push(body.subarray(cursor + delimiter.length, next));
    cursor = next;
  }

  for (const part of parts) {
    const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd === -1) continue;
    const headers = part.subarray(0, headerEnd).toString("utf8");
    if (!headers.includes('name="score"')) continue;
    const filename = headers.match(/filename="([^"]+)"/)?.[1] ?? "score.pdf";
    const contentStart = headerEnd + 4;
    const contentEnd = part.length >= 2 ? part.length - 2 : part.length;
    return {
      filename: basename(filename),
      bytes: part.subarray(contentStart, contentEnd),
    };
  }

  throw new Error("Missing PDF field named score.");
};

const findExportedScore = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true });
  const xmlCandidates = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await findExportedScore(fullPath);
      if (nested) xmlCandidates.push(nested);
    }
    else if (
      entry.isFile() &&
      [".musicxml", ".xml", ".mxl"].includes(extname(entry.name).toLowerCase())
    ) {
      xmlCandidates.push(fullPath);
    }
  }

  return (
    xmlCandidates.find((file) => extname(file).toLowerCase() === ".musicxml") ??
    xmlCandidates.find((file) => !file.toLowerCase().includes("meta-inf")) ??
    xmlCandidates[0]
  );
};

const extractMxl = async (mxlPath, workDir) => {
  const extractDir = join(workDir, "mxl");
  await mkdir(extractDir, { recursive: true });

  if (process.platform === "win32") {
    const zipPath = join(workDir, "score-mxl.zip");
    await writeFile(zipPath, await readFile(mxlPath));
    await run(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${extractDir.replace(/'/g, "''")}' -Force`,
      ],
      workDir,
    );
  } else {
    await run("unzip", ["-q", mxlPath, "-d", extractDir], workDir);
  }

  return findExportedScore(extractDir);
};

const runAudiveris = async (pdfPath, workDir) => {
  {
    await run(
      audiverisCommand,
      ["-batch", "-constant", "org.audiveris.omr.text.Language.defaultSpecification=eng", "-export", pdfPath],
      workDir,
    );

    let musicXmlPath = await findExportedScore(workDir);
    if (musicXmlPath && extname(musicXmlPath).toLowerCase() === ".mxl") {
      musicXmlPath = await extractMxl(musicXmlPath, workDir);
    }
    if (!musicXmlPath || extname(musicXmlPath).toLowerCase() === ".mxl") {
      throw new Error("Audiveris completed but did not produce a MusicXML/XML file.");
    }

    const musicXml = await readFile(musicXmlPath, "utf8");
    await mkdir(dirname(lastOmrPath), { recursive: true });
    await writeFile(lastOmrPath, musicXml, "utf8");
    return musicXml;
  }
};

/**
 * Convert a PDF, preferring direct extraction over OMR where it is trustworthy.
 *
 * For an engraved PDF this skips Audiveris entirely - no Java, no recognition,
 * and far better chord symbols. A scan, or an engraving whose rhythm cannot be
 * read confidently, falls back to Audiveris for the notes; the extracted chords
 * are still returned, because they are reliable even when the rhythm is not.
 */
const convertPdf = async (pdfBytes, filename) => {
  const workDir = join(tmpdir(), `accordion-omr-${randomUUID()}`);
  await mkdir(workDir, { recursive: true });

  try {
    const pdfPath = join(workDir, filename || "score.pdf");
    await writeFile(pdfPath, pdfBytes);

    const direct = await readEngravedPdf(pdfPath, workDir);
    const warnings = [];
    const chordOverride = direct.chords?.override ?? null;
    if (direct.chords) {
      warnings.push(
        `Read ${direct.chords.chords_found} chord symbol(s) straight from the PDF text ` +
        `across ${direct.chords.measures} measures.`);
    }

    const barFit = direct.notes?.bar_fit ?? 0;
    if (direct.musicXml && barFit >= DIRECT_NOTE_MIN_BAR_FIT) {
      const [beats, beatType] = direct.notes.time_signature;
      warnings.push(
        `Notes read directly from the engraved PDF - Audiveris was not needed. ` +
        `${direct.notes.noteheads} noteheads, ${beats}/${beatType}` +
        `${direct.notes.time_signature_engraved ? " (engraved)" : " (assumed)"}, ` +
        `${Math.round(barFit * 100)}% of measures add up.`);
      await mkdir(dirname(lastOmrPath), { recursive: true });
      await writeFile(lastOmrPath, direct.musicXml, "utf8");
      return { musicXml: direct.musicXml, chordOverride, warnings, source: "direct" };
    }

    if (direct.notesError) {
      warnings.push(`Direct note reading unavailable (${direct.notesError}); using OMR.`);
    } else if (direct.notes) {
      warnings.push(
        `Direct note reading was not confident enough (only ` +
        `${Math.round(barFit * 100)}% of measures add up); using Audiveris for the notes.`);
    }

    try {
      const musicXml = await runAudiveris(pdfPath, workDir);
      warnings.push(`PDF converted with ${audiverisCommand}.`);
      warnings.push("Review the score carefully: OMR can misread notes, rhythms, and chord symbols.");
      return { musicXml, chordOverride, warnings, source: "audiveris" };
    } catch (error) {
      if (direct.musicXml) {
        warnings.push(
          `Audiveris failed (${error instanceof Error ? error.message : error}); ` +
          `falling back to the direct reading, whose rhythm is only ` +
          `${Math.round(barFit * 100)}% verified.`);
        return { musicXml: direct.musicXml, chordOverride, warnings, source: "direct-fallback" };
      }
      throw error;
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
};

createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    json(response, 204, {});
    return;
  }

  if (request.method !== "POST" || request.url !== "/api/omr") {
    json(response, 404, { error: "Not found", warnings: [] });
    return;
  }

  try {
    const body = await readRequestBody(request);
    const upload = parseMultipartPdf(request.headers["content-type"] ?? "", body);
    const result = await convertPdf(upload.bytes, upload.filename);
    json(response, 200, {
      musicXml: result.musicXml,
      chordOverride: result.chordOverride,
      source: result.source,
      warnings: result.warnings,
    });
  } catch (error) {
    json(response, 500, {
      error: "OMR failed",
      details: error instanceof Error ? error.message : String(error),
      warnings: [
        "PDF upload reached the OMR server, but conversion failed.",
        "Install Audiveris and set AUDIVERIS_CMD if the command is not on PATH.",
        `The configured Audiveris command is: ${audiverisCommand}`,
        tessDataPrefix ? `OCR language data: ${tessDataPrefix}.` : "OCR language data was not configured; chord text may be missed.",
      ],
    });
  }
}).listen(port, () => {
  console.log(`OMR server listening on http://localhost:${port}`);
});









