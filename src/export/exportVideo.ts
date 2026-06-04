import { createVideoElement, seekVideo, videoFrameToImageData } from "../processing/videoInput";
import type {
  AnimatedExportQuality,
  AsciiSettings,
  AnimationSettings,
  BreakupSettings,
  ColorSettings,
  ExportOptions,
  FontSettings,
  FrameSettings,
  GlyphMetric,
  ImageSettings
} from "../renderer/types";
import { downloadBlob } from "./download";
import { resolveAnimatedExportFps, resolveAnimatedExportProfile } from "./exportQuality";
import { convertWebMToMp4 } from "./ffmpegMp4";
import { renderAsciiAnimationFrames } from "./renderAnimationFrames";

export type VideoExportExtension = "mp4" | "webm";

interface VideoExportFormat {
  mimeType: string;
  extension: VideoExportExtension;
  label: string;
}

interface SharedAsciiVideoArgs {
  sourceName: string;
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
  preferredExtension?: VideoExportExtension;
  allowFormatFallback?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
  onStatus?: (message: string) => void;
}

interface ExportAsciiVideoArgs extends SharedAsciiVideoArgs {
  video: HTMLVideoElement;
}

interface ExportAsciiFrameSequenceArgs extends SharedAsciiVideoArgs {
  duration: number;
  fileSuffix: string;
  frameLabel: string;
  prerenderFrames?: boolean;
  getFrame: (timeSeconds: number, progress: number, frameIndex: number, totalFrames: number) => ImageData | Promise<ImageData>;
}

type RequestFrameTrack = MediaStreamTrack & {
  requestFrame?: () => void;
};

interface ExportAsciiVideoResult {
  fileName: string;
  mimeType: string;
  extension: VideoExportExtension;
  usedFallback: boolean;
  timingWarning?: string;
}

const videoFormats: VideoExportFormat[] = [
  { mimeType: 'video/mp4;codecs="avc1.42E01E,mp4a.40.2"', extension: "mp4", label: "MP4" },
  { mimeType: "video/mp4", extension: "mp4", label: "MP4" },
  { mimeType: "video/webm;codecs=vp9", extension: "webm", label: "WebM VP9" },
  { mimeType: "video/webm;codecs=vp8", extension: "webm", label: "WebM VP8" },
  { mimeType: "video/webm", extension: "webm", label: "WebM" }
];

const createAbortError = () => {
  const error = new Error("Video export canceled.");
  error.name = "AbortError";
  return error;
};

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) {
    throw createAbortError();
  }
};

const wait = (milliseconds: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    throwIfAborted(signal);
    const handleAbort = () => {
      window.clearTimeout(timeout);
      reject(createAbortError());
    };
    const timeout = window.setTimeout(() => {
      signal?.removeEventListener("abort", handleAbort);
      resolve();
    }, Math.max(0, milliseconds));
    signal?.addEventListener("abort", handleAbort, { once: true });
  });

const waitUntil = (targetTime: number, signal?: AbortSignal) => wait(targetTime - performance.now(), signal);
const yieldToBrowser = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0));
const waitForAnimationFrame = (signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    throwIfAborted(signal);
    let frameHandle = 0;
    const handleAbort = () => {
      window.cancelAnimationFrame(frameHandle);
      reject(createAbortError());
    };
    frameHandle = window.requestAnimationFrame(() => {
      signal?.removeEventListener("abort", handleAbort);
      resolve();
    });
    signal?.addEventListener("abort", handleAbort, { once: true });
  });

const waitForVideoReady = (video: HTMLVideoElement) =>
  new Promise<void>((resolve, reject) => {
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA && video.videoWidth && video.videoHeight) {
      resolve();
      return;
    }

    const cleanup = () => {
      video.removeEventListener("loadedmetadata", handleReady);
      video.removeEventListener("loadeddata", handleReady);
      video.removeEventListener("error", handleError);
    };
    const handleReady = () => {
      if (!video.videoWidth || !video.videoHeight) {
        return;
      }
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error("This browser could not decode the video for export."));
    };

    video.addEventListener("loadedmetadata", handleReady);
    video.addEventListener("loadeddata", handleReady);
    video.addEventListener("error", handleError, { once: true });
    video.load();
  });

const getSupportedVideoFormat = (
  preferredExtension: VideoExportExtension = "webm",
  allowFormatFallback = true
) => {
  if (typeof MediaRecorder === "undefined") {
    return null;
  }
  const preferred = videoFormats.filter((format) => format.extension === preferredExtension);
  if (!allowFormatFallback) {
    return preferred.find((format) => MediaRecorder.isTypeSupported(format.mimeType)) ?? null;
  }
  const fallback = videoFormats.filter((format) => format.extension !== preferredExtension);
  return [...preferred, ...fallback].find((format) => MediaRecorder.isTypeSupported(format.mimeType)) ?? null;
};

const buildVideoFileName = (sourceName: string, suffix: string, extension: VideoExportExtension) => {
  const base = sourceName.replace(/\.[a-z0-9]+$/i, "").replace(/[^a-z0-9-_]+/gi, "-").toLowerCase();
  return `${base || "ascii-video"}-${suffix}.${extension}`;
};

const logMp4Export = (message: string, details?: Record<string, unknown>) => {
  console.info(`[ASCII Studio MP4] ${message}`, details ?? "");
};

const cloneCanvasFrame = async (canvas: HTMLCanvasElement): Promise<CanvasImageSource> => {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(canvas);
  }

  const copy = document.createElement("canvas");
  copy.width = canvas.width;
  copy.height = canvas.height;
  const copyCtx = copy.getContext("2d");
  if (!copyCtx) {
    throw new Error("Canvas2D is unavailable for video frame buffering.");
  }
  copyCtx.drawImage(canvas, 0, 0);
  return copy;
};

const releaseCanvasFrames = (frames: CanvasImageSource[]) => {
  frames.forEach((frame) => {
    if ("close" in frame && typeof frame.close === "function") {
      frame.close();
    }
  });
};

const createRecordingStream = (canvas: HTMLCanvasElement, fps: number, onStatus?: (message: string) => void) => {
  let canRequestFrame = false;
  try {
    const testStream = canvas.captureStream(0);
    const requestFrameTrack = testStream.getVideoTracks()[0] as RequestFrameTrack | undefined;
    canRequestFrame = typeof requestFrameTrack?.requestFrame === "function";
    testStream.getTracks().forEach((track) => track.stop());
  } catch {
    canRequestFrame = false;
  }

  const stream = canvas.captureStream(canRequestFrame ? 0 : fps);
  const track = stream.getVideoTracks()[0] as RequestFrameTrack | undefined;
  const timingWarning = canRequestFrame
    ? undefined
    : "Browser does not support precise canvas frame requests; GIF export is more reliable for fixed-frame animation.";
  if (timingWarning) {
    onStatus?.(timingWarning);
  }

  return {
    stream,
    requestFrame: () => track?.requestFrame?.(),
    hasManualFrameRequest: canRequestFrame,
    timingWarning
  };
};

const waitForRecorderStart = (recorder: MediaRecorder, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    throwIfAborted(signal);
    if (recorder.state === "recording") {
      resolve();
      return;
    }
    const cleanup = () => {
      recorder.removeEventListener("start", handleStart);
      recorder.removeEventListener("error", handleError);
      signal?.removeEventListener("abort", handleAbort);
    };
    const handleStart = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error("Video recorder failed to start."));
    };
    const handleAbort = () => {
      cleanup();
      reject(createAbortError());
    };
    recorder.addEventListener("start", handleStart, { once: true });
    recorder.addEventListener("error", handleError, { once: true });
    signal?.addEventListener("abort", handleAbort, { once: true });
  });

const drawRecordingFrame = (
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  frame: CanvasImageSource
) => {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(frame, 0, 0);
  ctx.restore();
};

const captureCompletedFrame = async ({
  requestFrame,
  hasManualFrameRequest,
  signal
}: {
  requestFrame: () => void;
  hasManualFrameRequest: boolean;
  signal?: AbortSignal;
}) => {
  // Canvas drawing is synchronous, but yielding one paint turn prevents MediaRecorder
  // from sampling a canvas while the browser is still committing image/video/glyph pixels.
  await waitForAnimationFrame(signal);
  if (hasManualFrameRequest) {
    requestFrame();
  }
  await yieldToBrowser();
};

const videoBitsPerPixelFloor: Record<AnimatedExportQuality, number> = {
  small: 0.12,
  balanced: 0.32,
  high: 0.72
};

const resolveAsciiVideoBitrate = (
  width: number,
  height: number,
  fps: number,
  profile: ReturnType<typeof resolveAnimatedExportProfile>
) => {
  const bitsPerPixel = Math.max(profile.videoBitsPerPixel, videoBitsPerPixelFloor[profile.quality]);
  const target = Math.round(width * height * fps * bitsPerPixel);
  return Math.max(2_500_000, Math.min(120_000_000, target));
};

export const exportAsciiFrameSequence = async ({
  sourceName,
  fileSuffix,
  frameLabel,
  prerenderFrames = false,
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
  preferredExtension = "webm",
  allowFormatFallback = true,
  signal,
  onProgress,
  onStatus,
  getFrame
}: ExportAsciiFrameSequenceArgs): Promise<ExportAsciiVideoResult> => {
  if (typeof document === "undefined") {
    throw new Error("Video export requires a browser.");
  }
  if (typeof HTMLCanvasElement === "undefined" || typeof HTMLCanvasElement.prototype.captureStream !== "function") {
    throw new Error("This browser cannot export video from canvas. Use GIF export for deterministic still-image animation.");
  }

  const exportQuality = quality ?? exportOptions.animatedExportQuality;
  const convertingToMp4 = preferredExtension === "mp4";
  if (convertingToMp4 && typeof window !== "undefined" && window.location.protocol === "file:") {
    throw new Error("MP4 export requires running the app from a local server.");
  }
  const recordingExtension: VideoExportExtension = convertingToMp4 ? "webm" : preferredExtension;
  const format = getSupportedVideoFormat(recordingExtension, convertingToMp4 ? false : allowFormatFallback);
  if (!format) {
    throw new Error(
      preferredExtension === "mp4"
        ? "MP4 export needs WebM canvas recording before conversion, but this browser cannot record WebM."
        : "This browser does not provide a supported video recorder. Use GIF export for deterministic still-image animation."
    );
  }

  const normalizedFps = resolveAnimatedExportFps(fps, exportQuality, animation?.type);
  const profile = resolveAnimatedExportProfile(exportQuality, animation?.type);
  const totalFrames = Math.max(1, Math.round(Math.max(0.001, duration) * normalizedFps));
  const frameInterval = 1000 / normalizedFps;
  const recordingProgressWeight = convertingToMp4 ? 0.72 : 1;
  const emitRecordingProgress = (progress: number) => onProgress?.(Math.min(recordingProgressWeight, Math.max(0, progress * recordingProgressWeight)));
  const bufferedFrames: CanvasImageSource[] = [];
  let firstCanvas: HTMLCanvasElement | null = null;
  let capturedFrameCount = 0;

  try {
    if (prerenderFrames) {
      onStatus?.(convertingToMp4 ? "Rendering WebM" : `Pre-rendering ${totalFrames} ${frameLabel} frames at ${normalizedFps}fps`);
    } else if (convertingToMp4) {
      onStatus?.("Rendering WebM");
    }
    if (convertingToMp4) {
      logMp4Export("Starting MP4 export from current ASCII render", {
        sourceName,
        frameLabel,
        expectedFrameCount: totalFrames,
        fps: normalizedFps,
        duration,
        animationType: animation?.type ?? "none"
      });
    }

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
      renderLikePreview: true,
      signal,
      getFrame
    })) {
      firstCanvas = renderedFrame.canvas;
      if (!prerenderFrames) {
        break;
      }
      bufferedFrames.push(await cloneCanvasFrame(renderedFrame.canvas));
      emitRecordingProgress(((renderedFrame.frameIndex + 1) / totalFrames) * 0.5);
      if (renderedFrame.frameIndex % 4 === 3) {
        await yieldToBrowser();
      }
    }

    if (!firstCanvas) {
      throw new Error("Animation frame generation failed.");
    }

    const recordingCanvas = document.createElement("canvas");
    recordingCanvas.width = firstCanvas.width + (firstCanvas.width % 2);
    recordingCanvas.height = firstCanvas.height + (firstCanvas.height % 2);
    if (convertingToMp4) {
      logMp4Export("Prepared recording canvas", {
        width: recordingCanvas.width,
        height: recordingCanvas.height,
        bufferedFrameCount: bufferedFrames.length,
        usesSameFrameSequenceAsWebM: true
      });
    }
    const recordingCtx = recordingCanvas.getContext("2d");
    if (!recordingCtx) {
      throw new Error("Canvas2D is unavailable for video recording.");
    }
    recordingCtx.imageSmoothingEnabled = false;

    if (bufferedFrames.length) {
      drawRecordingFrame(recordingCtx, recordingCanvas, bufferedFrames[0]);
    } else {
      drawRecordingFrame(recordingCtx, recordingCanvas, firstCanvas);
    }

    const { stream, requestFrame, hasManualFrameRequest, timingWarning } = createRecordingStream(recordingCanvas, normalizedFps, onStatus);
    const chunks: BlobPart[] = [];
    let recorder: MediaRecorder | null = null;
    let stopped = false;
    const stopTracks = () => stream.getTracks().forEach((track) => track.stop());
    const stopRecorder = () =>
      new Promise<void>((resolve) => {
        if (!recorder || stopped || recorder.state === "inactive") {
          stopped = true;
          stopTracks();
          resolve();
          return;
        }
        recorder.addEventListener(
          "stop",
          () => {
            stopped = true;
            stopTracks();
            resolve();
          },
          { once: true }
        );
        recorder.stop();
      });

    try {
      const bitsPerSecond = resolveAsciiVideoBitrate(recordingCanvas.width, recordingCanvas.height, normalizedFps, profile);
      recorder = new MediaRecorder(stream, { mimeType: format.mimeType, videoBitsPerSecond: bitsPerSecond });
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      });

      const recorderStop = new Promise<void>((resolve, reject) => {
        if (!recorder) {
          reject(new Error("Video recorder did not start."));
          return;
        }
        recorder.addEventListener("stop", () => resolve(), { once: true });
        recorder.addEventListener("error", () => reject(new Error("Video recording failed.")), { once: true });
      });

      recorder.start();
      await waitForRecorderStart(recorder, signal);
      await yieldToBrowser();
      const recordingStartedAt = performance.now();

      if (bufferedFrames.length) {
        for (let index = 0; index < bufferedFrames.length; index += 1) {
          throwIfAborted(signal);
          if (!convertingToMp4) {
            onStatus?.(`Recording ${frameLabel} frame ${index + 1} of ${bufferedFrames.length}`);
          }
          drawRecordingFrame(recordingCtx, recordingCanvas, bufferedFrames[index]);
          await captureCompletedFrame({ requestFrame, hasManualFrameRequest, signal });
          capturedFrameCount = index + 1;
          emitRecordingProgress(0.5 + ((index + 1) / bufferedFrames.length) * 0.5);
          await waitUntil(recordingStartedAt + (index + 1) * frameInterval, signal);
        }
      } else {
        let frameIndex = 0;
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
          renderLikePreview: true,
          signal,
          getFrame
        })) {
          throwIfAborted(signal);
          if (!convertingToMp4) {
            onStatus?.(`Rendering ${frameLabel} frame ${renderedFrame.frameIndex + 1} of ${renderedFrame.totalFrames}`);
          }
          drawRecordingFrame(recordingCtx, recordingCanvas, renderedFrame.canvas);
          await captureCompletedFrame({ requestFrame, hasManualFrameRequest, signal });
          capturedFrameCount = renderedFrame.frameIndex + 1;
          emitRecordingProgress((renderedFrame.frameIndex + 1) / renderedFrame.totalFrames);
          frameIndex += 1;
          await waitUntil(recordingStartedAt + frameIndex * frameInterval, signal);
        }
      }

      await stopRecorder();
      await recorderStop;
    } catch (error) {
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          // The recorder may already be stopping after an abort or browser encoder error.
        }
      }
      stopTracks();
      throw error;
    }

    if (!chunks.length) {
      throw new Error("Video export produced no data.");
    }
    if (capturedFrameCount !== totalFrames) {
      throw new Error(`Video export captured ${capturedFrameCount} frames, expected ${totalFrames}.`);
    }

    const blob = new Blob(chunks, { type: format.mimeType });
    console.info("[ASCII Studio WebM] Captured video export", {
      capturedFrameCount,
      expectedFrameCount: totalFrames,
      chunkCount: chunks.length,
      webmBlobSize: blob.size,
      webmMimeType: blob.type,
      canvasWidth: recordingCanvas.width,
      canvasHeight: recordingCanvas.height
    });
    if (convertingToMp4) {
      logMp4Export("Captured WebM intermediate", {
        capturedFrameCount,
        expectedFrameCount: totalFrames,
        chunkCount: chunks.length,
        webmBlobSize: blob.size,
        webmMimeType: blob.type,
        canvasWidth: recordingCanvas.width,
        canvasHeight: recordingCanvas.height
      });
      if (capturedFrameCount !== totalFrames) {
        throw new Error(
          `MP4 conversion failed. Captured ${capturedFrameCount} canvas frames, expected ${totalFrames}. You can export WebM instead.`
        );
      }
    }
    if (convertingToMp4 && (blob.size <= 0 || !blob.type.toLowerCase().startsWith("video/webm"))) {
      throw new Error("MP4 conversion failed. The intermediate WebM was invalid. You can export WebM instead.");
    }
    if (convertingToMp4) {
      const mp4Blob = await convertWebMToMp4({
        webmBlob: blob,
        signal,
        onStatus,
        onProgress: (progress) => onProgress?.(0.72 + progress * 0.27)
      });
      onStatus?.("Downloading MP4");
      const fileName = buildVideoFileName(sourceName, fileSuffix, "mp4");
      if (!fileName.toLowerCase().endsWith(".mp4") || mp4Blob.size <= 0 || mp4Blob.type !== "video/mp4") {
        throw new Error("MP4 conversion failed. The final MP4 output was invalid. You can export WebM instead.");
      }
      logMp4Export("Downloading MP4", {
        downloadedFileName: fileName,
        mp4BlobSize: mp4Blob.size,
        mp4MimeType: mp4Blob.type,
        capturedFrameCount
      });
      downloadBlob(mp4Blob, fileName);
      onProgress?.(1);
      return {
        fileName,
        mimeType: "video/mp4",
        extension: "mp4",
        usedFallback: false,
        timingWarning
      };
    }

    const fileName = buildVideoFileName(sourceName, fileSuffix, format.extension);
    downloadBlob(blob, fileName);
    return {
      fileName,
      mimeType: format.mimeType,
      extension: format.extension,
      usedFallback: format.extension !== preferredExtension,
      timingWarning
    };
  } finally {
    releaseCanvasFrames(bufferedFrames);
  }
};

export const exportAsciiVideo = async ({
  video,
  sourceName,
  ...shared
}: ExportAsciiVideoArgs): Promise<ExportAsciiVideoResult> => {
  const source = video.currentSrc || video.src;
  if (!source) {
    throw new Error("Video source is unavailable for export.");
  }

  const exportVideo = createVideoElement(source);
  exportVideo.currentTime = 0;
  await waitForVideoReady(exportVideo);
  await seekVideo(exportVideo, 0);

  return exportAsciiFrameSequence({
    ...shared,
    sourceName,
    fileSuffix: "ascii",
    frameLabel: "video",
    duration: Number.isFinite(exportVideo.duration) && exportVideo.duration > 0 ? exportVideo.duration : 0,
    getFrame: async (time) => {
      await seekVideo(exportVideo, time);
      return videoFrameToImageData(exportVideo);
    }
  });
};
