export type OmrResult = {
  musicXml?: string;
  warnings: string[];
  error?: string;
};

export const pdfToMusicXml = async (file: File): Promise<OmrResult> => {
  const body = new FormData();
  body.append("score", file);

  try {
    const response = await fetch("http://localhost:8787/api/omr", {
      method: "POST",
      body,
    });
    const result = (await response.json()) as OmrResult;

    if (!response.ok) {
      return {
        warnings: result.warnings ?? [`PDF uploaded: ${file.name}`],
        error: result.error ?? "OMR conversion failed.",
      };
    }

    return {
      musicXml: result.musicXml,
      warnings: result.warnings ?? [`PDF converted: ${file.name}`],
      error: result.error,
    };
  } catch {
    return {
      warnings: [
        `PDF uploaded: ${file.name}`,
        "Start the local OMR server with npm run omr:server and configure AUDIVERIS_CMD to enable PDF recognition.",
      ],
      error: "Local OMR server is not running.",
    };
  }
};
