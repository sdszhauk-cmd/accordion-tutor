import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

const port = Number(process.env.OMR_PORT ?? 8787);
const audiverisCommand = process.env.AUDIVERIS_CMD ?? "audiveris";
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

const convertPdf = async (pdfBytes, filename) => {
  const workDir = join(tmpdir(), `accordion-omr-${randomUUID()}`);
  await mkdir(workDir, { recursive: true });

  try {
    const pdfPath = join(workDir, filename || "score.pdf");
    await writeFile(pdfPath, pdfBytes);
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
    const musicXml = await convertPdf(upload.bytes, upload.filename);
    json(response, 200, {
      musicXml,
      warnings: [
        `PDF converted with ${audiverisCommand}.`,  
        tessDataPrefix ? `OCR language data: ${tessDataPrefix}.` : "OCR language data was not configured; chord text may be missed.",
        "Review the score carefully: OMR recognition can misread notes, rhythms, and chord symbols.",
      ],
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









