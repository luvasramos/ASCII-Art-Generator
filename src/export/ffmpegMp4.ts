import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";

interface ConvertWebMToMp4Args {
  webmBlob: Blob;
  signal?: AbortSignal;
  onStatus?: (message: string) => void;
  onProgress?: (progress: number) => void;
}

let sharedFfmpeg: FFmpeg | null = null;
let sharedLoadPromise: Promise<FFmpeg> | null = null;
let exportSequence = 0;
const ffmpegLoadTimeoutMs = 45_000;
const ffmpegExecTimeoutMs = 180_000;
const ffmpegReadTimeoutMs = 45_000;

const createAbortError = () => {
  const error = new DOMException("MP4 export canceled.", "AbortError");
  return error;
};

const resolveBundledAssetUrl = (assetUrl: string) => {
  if (typeof window === "undefined") {
    return assetUrl;
  }
  return new URL(assetUrl, window.location.href).href;
};

const assertMp4CanRunHere = () => {
  if (typeof window !== "undefined" && window.location.protocol === "file:") {
    throw new Error("MP4 export requires running the app from a local server.");
  }
  if (typeof Worker === "undefined" || typeof WebAssembly === "undefined") {
    throw new Error("MP4 export requires Web Worker and WebAssembly support.");
  }
};

const withTimeout = async <T,>(promise: Promise<T>, milliseconds: number, label: string, onTimeout?: () => void) => {
  let timeout = 0;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = window.setTimeout(() => {
          onTimeout?.();
          reject(new Error(`${label} timed out.`));
        }, milliseconds);
      })
    ]);
  } finally {
    window.clearTimeout(timeout);
  }
};

const validateWebMBlob = async (webmBlob: Blob) => {
  if (!webmBlob || webmBlob.size <= 0) {
    throw new Error("MP4 conversion failed. The intermediate WebM was empty.");
  }
  if (webmBlob.type && !webmBlob.type.toLowerCase().startsWith("video/webm")) {
    throw new Error(`MP4 conversion failed. Expected WebM input, received ${webmBlob.type}.`);
  }
  const signature = new Uint8Array(await webmBlob.slice(0, 4).arrayBuffer());
  if (signature.length < 4 || signature[0] !== 0x1a || signature[1] !== 0x45 || signature[2] !== 0xdf || signature[3] !== 0xa3) {
    throw new Error("MP4 conversion failed. The intermediate WebM did not contain a valid EBML header.");
  }
};

const validateMp4Bytes = (bytes: Uint8Array) => {
  if (bytes.byteLength < 12) {
    throw new Error("MP4 conversion produced a file that is too small.");
  }
  const brand = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
  if (brand !== "ftyp") {
    throw new Error("MP4 conversion produced data without an MP4 ftyp header.");
  }
};

const summarizeLogs = (logs: string[]) => {
  const usefulLogs = logs.filter((line) => /error|failed|invalid|unable|not found|unknown|denied/i.test(line));
  const tail = (usefulLogs.length ? usefulLogs : logs).slice(-3).join(" ");
  return tail ? ` ${tail}` : "";
};

const createExportId = () => {
  exportSequence += 1;
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${Date.now()}-${exportSequence}-${random}`;
};

const logMp4 = (message: string, details?: Record<string, unknown>) => {
  console.info(`[ASCII Studio MP4] ${message}`, details ?? "");
};

const clearPreviousFfmpegVideoFiles = async (ffmpeg: FFmpeg) => {
  try {
    const nodes = await ffmpeg.listDir("/");
    await Promise.all(
      nodes
        .map((node) => node.name)
        .filter((name) => name.endsWith(".webm") || name.endsWith(".mp4"))
        .map(async (name) => {
          try {
            await ffmpeg.deleteFile(name);
          } catch {
            // Ignore stale cleanup misses.
          }
        })
    );
  } catch {
    // Some older ffmpeg.wasm builds can fail listDir before the FS is warmed up.
  }
};

const getFfmpeg = async (signal?: AbortSignal, onStatus?: (message: string) => void) => {
  assertMp4CanRunHere();
  if (sharedFfmpeg?.loaded) {
    return sharedFfmpeg;
  }

  if (!sharedLoadPromise) {
    onStatus?.("Loading converter");
    const ffmpeg = new FFmpeg();
    sharedFfmpeg = ffmpeg;
    const resetEncoder = () => {
      ffmpeg.terminate();
      sharedFfmpeg = null;
      sharedLoadPromise = null;
    };
    sharedLoadPromise = withTimeout(
      ffmpeg.load(
        {
          coreURL: resolveBundledAssetUrl("ffmpeg/ffmpeg-core.js"),
          wasmURL: resolveBundledAssetUrl("ffmpeg/ffmpeg-core.wasm"),
          classWorkerURL: resolveBundledAssetUrl("ffmpeg/ffmpeg-worker.js")
        },
        { signal }
      ),
      ffmpegLoadTimeoutMs,
      "Loading converter",
      resetEncoder
    )
      .then(() => ffmpeg)
      .catch((error) => {
        sharedFfmpeg = null;
        sharedLoadPromise = null;
        throw error;
      });
  }

  return sharedLoadPromise;
};

export const convertWebMToMp4 = async ({ webmBlob, signal, onStatus, onProgress }: ConvertWebMToMp4Args) => {
  await validateWebMBlob(webmBlob);
  logMp4("Validated WebM input", { webmBlobSize: webmBlob.size, webmMimeType: webmBlob.type || "(empty)" });
  if (signal?.aborted) {
    throw createAbortError();
  }

  let ffmpeg: FFmpeg;
  try {
    ffmpeg = await getFfmpeg(signal, onStatus);
  } catch (error) {
    if (signal?.aborted) {
      throw createAbortError();
    }
    const detail = error instanceof Error ? error.message : String(error);
    if (detail.includes("local server")) {
      throw new Error(detail);
    }
    console.error("[ASCII Studio MP4] Converter load failed", error);
    throw new Error(`MP4 conversion failed. ${detail} Export WebM instead.`);
  }
  const exportId = createExportId();
  const inputName = `ascii-mp4-${exportId}-input.webm`;
  const outputName = `ascii-mp4-${exportId}-output.mp4`;
  logMp4("Prepared FFmpeg filenames", { inputName, outputName });

  let aborted = false;
  const handleAbort = () => {
    aborted = true;
    sharedFfmpeg?.terminate();
    sharedFfmpeg = null;
    sharedLoadPromise = null;
  };
  signal?.addEventListener("abort", handleAbort, { once: true });

  const handleProgress = ({ progress }: { progress: number }) => {
    if (Number.isFinite(progress)) {
      onProgress?.(Math.min(0.98, Math.max(0, progress)));
    }
  };
  const logs: string[] = [];
  const handleLog = ({ type, message }: { type: string; message: string }) => {
    const line = `[${type}] ${message}`;
    logs.push(line);
    if (/error|failed|invalid|unable|not found|unknown|denied/i.test(message)) {
      onStatus?.(`FFmpeg ${message}`);
    }
  };

  ffmpeg.on("progress", handleProgress);
  ffmpeg.on("log", handleLog);
  try {
    await clearPreviousFfmpegVideoFiles(ffmpeg);
    logMp4("Cleared previous FFmpeg virtual video files", { inputName, outputName });
    onStatus?.("Writing WebM to FFmpeg FS");
    logMp4("Writing WebM to FFmpeg FS", { inputName, webmBlobSize: webmBlob.size });
    await withTimeout(ffmpeg.writeFile(inputName, await fetchFile(webmBlob), { signal }), ffmpegReadTimeoutMs, "Writing WebM to FFmpeg FS");

    onStatus?.("Converting to MP4");
    logMp4("Starting FFmpeg conversion", { inputName, outputName });
    const exitCode = await withTimeout(
      ffmpeg.exec(
        ["-i", inputName, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "faststart", outputName],
        ffmpegExecTimeoutMs,
        { signal }
      ),
      ffmpegExecTimeoutMs + 5_000,
      "Converting to MP4",
      () => {
        sharedFfmpeg?.terminate();
        sharedFfmpeg = null;
        sharedLoadPromise = null;
      }
    );
    if (exitCode !== 0) {
      throw new Error(`FFmpeg exited with code ${exitCode}.${summarizeLogs(logs)}`);
    }
    logMp4("FFmpeg conversion finished", { outputName, exitCode });

    onStatus?.("Reading MP4 output");
    logMp4("Reading MP4 output", { outputName });
    const output = await withTimeout(ffmpeg.readFile(outputName, undefined, { signal }), ffmpegReadTimeoutMs, "Reading MP4 output");
    if (typeof output === "string" || !output.byteLength) {
      throw new Error(`MP4 conversion produced no video data.${summarizeLogs(logs)}`);
    }

    const bytes = new Uint8Array(output.byteLength);
    bytes.set(output);
    validateMp4Bytes(bytes);
    onProgress?.(1);
    const mp4Blob = new Blob([bytes.buffer], { type: "video/mp4" });
    if (mp4Blob.size <= 0 || mp4Blob.type !== "video/mp4") {
      throw new Error("MP4 conversion produced an invalid MP4 blob.");
    }
    logMp4("Validated MP4 output", { outputName, mp4ByteSize: mp4Blob.size, mp4MimeType: mp4Blob.type });
    return mp4Blob;
  } catch (error) {
    if (aborted || signal?.aborted) {
      throw createAbortError();
    }
    const detail = error instanceof Error ? error.message : "Unknown FFmpeg error.";
    console.error("[ASCII Studio MP4] Conversion failed", { detail, logs });
    throw new Error(`MP4 conversion failed. ${detail}${summarizeLogs(logs)} Export WebM instead.`);
  } finally {
    ffmpeg.off("progress", handleProgress);
    ffmpeg.off("log", handleLog);
    signal?.removeEventListener("abort", handleAbort);
    try {
      await ffmpeg.deleteFile(inputName);
    } catch {
      // Ignore virtual FS cleanup misses after cancellation or failed conversion.
    }
    try {
      await ffmpeg.deleteFile(outputName);
    } catch {
      // Ignore virtual FS cleanup misses after cancellation or failed conversion.
    }
    try {
      await clearPreviousFfmpegVideoFiles(ffmpeg);
    } catch {
      // Ignore broad cleanup failures from a terminated or unavailable virtual FS.
    }
  }
};
