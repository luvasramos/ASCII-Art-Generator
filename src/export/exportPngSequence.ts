import type {
  AnimatedExportQuality,
  AnimationSettings,
  AsciiSettings,
  BreakupSettings,
  ColorSettings,
  ExportOptions,
  FontSettings,
  FrameSettings,
  GlyphMetric,
  ImageSettings
} from "../renderer/types";
import { resolveAnimationFrameCount } from "../renderer/animationTiming";
import { downloadBlob } from "./download";
import { resolveAnimatedExportFps } from "./exportQuality";
import { createCanvasPngBlob } from "./exportPng";
import { renderAsciiAnimationFrames } from "./renderAnimationFrames";
import { createStoredZipBlob, type StoredZipFile } from "./zip";

interface ExportAsciiPngSequenceArgs {
  sourceName: string;
  duration: number;
  font: FontSettings;
  ascii: AsciiSettings;
  image: ImageSettings;
  frame: FrameSettings;
  breakup: BreakupSettings;
  color: ColorSettings;
  exportOptions: ExportOptions;
  exportScale: number;
  glyphMetrics: GlyphMetric[];
  animation?: AnimationSettings;
  fps: number;
  quality?: AnimatedExportQuality;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
  onStatus?: (message: string) => void;
  getFrame: (timeSeconds: number, progress: number, frameIndex: number, totalFrames: number) => ImageData | Promise<ImageData>;
}

interface PngSequenceExportResult {
  fileName: string;
  frameCount: number;
  fps: number;
  bytes: number;
}

const maxPngSequenceBytes = 1024 * 1024 * 1024;

const createAbortError = () => {
  const error = new Error("PNG sequence export canceled.");
  error.name = "AbortError";
  return error;
};

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) {
    throw createAbortError();
  }
};

const yieldToBrowser = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0));

const buildPngSequenceFileName = (sourceName: string) => {
  const base = sourceName.replace(/\.[a-z0-9]+$/i, "").replace(/[^a-z0-9-_]+/gi, "-").toLowerCase();
  return `${base || "ascii-render"}-png-sequence.zip`;
};

const frameFileName = (frameIndex: number) => `frame_${String(frameIndex + 1).padStart(6, "0")}.png`;

const blobToBytes = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());

export const exportAsciiPngSequence = async ({
  sourceName,
  duration,
  font,
  ascii,
  image,
  frame,
  breakup,
  color,
  exportOptions,
  exportScale,
  glyphMetrics,
  animation,
  fps,
  quality,
  signal,
  onProgress,
  onStatus,
  getFrame
}: ExportAsciiPngSequenceArgs): Promise<PngSequenceExportResult> => {
  const exportQuality = quality ?? exportOptions.animatedExportQuality;
  const normalizedFps = resolveAnimatedExportFps(fps, exportQuality, animation?.type);
  const totalFrames = resolveAnimationFrameCount(duration, normalizedFps);
  const files: StoredZipFile[] = [];
  let accumulatedPngBytes = 0;

  onStatus?.("Preparing PNG sequence");
  onProgress?.(0);

  for await (const renderedFrame of renderAsciiAnimationFrames({
    duration,
    fps: normalizedFps,
    font,
    ascii,
    image,
    frame,
    breakup,
    color,
    exportOptions,
    exportScale,
    glyphMetrics,
    animation,
    signal,
    getFrame
  })) {
    throwIfAborted(signal);
    onStatus?.(`Rendering frame ${renderedFrame.frameIndex + 1} of ${renderedFrame.totalFrames}`);
    const pngBlob = await createCanvasPngBlob(renderedFrame.canvas, frame.dpi);
    throwIfAborted(signal);
    const pngBytes = await blobToBytes(pngBlob);
    accumulatedPngBytes += pngBytes.byteLength;
    if (accumulatedPngBytes > maxPngSequenceBytes) {
      throw new Error(
        "PNG sequence is too large to package in memory. Try a shorter duration, lower FPS, or smaller export scale."
      );
    }
    files.push({
      name: frameFileName(renderedFrame.frameIndex),
      data: pngBytes
    });
    onProgress?.(((renderedFrame.frameIndex + 1) / renderedFrame.totalFrames) * 0.9);
    if (renderedFrame.frameIndex % 2 === 1) {
      await yieldToBrowser();
    }
  }

  if (files.length !== totalFrames) {
    throw new Error(`PNG sequence rendered ${files.length} frames, expected ${totalFrames}.`);
  }

  throwIfAborted(signal);
  onStatus?.("Writing ZIP");
  onProgress?.(0.96);
  await yieldToBrowser();
  const zipBlob = createStoredZipBlob(files);
  throwIfAborted(signal);
  const fileName = buildPngSequenceFileName(sourceName);
  onStatus?.("Download ready");
  downloadBlob(zipBlob, fileName);
  onProgress?.(1);

  return {
    fileName,
    frameCount: files.length,
    fps: normalizedFps,
    bytes: zipBlob.size
  };
};
