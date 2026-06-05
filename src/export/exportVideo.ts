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
import { resolveAnimationFrameCount } from "../renderer/animationTiming";
import { downloadBlob } from "./download";
import { formatBitrate, resolveAnimatedExportFps, resolveVideoEncodingSettings } from "./exportQuality";
import { collectMp4RuntimeDiagnostics, encodePngSequenceToMp4 } from "./ffmpegMp4";
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
  { mimeType: "video/mp4;codecs=avc1.42E01E", extension: "mp4", label: "MP4 H.264" },
  { mimeType: "video/mp4;codecs=h264", extension: "mp4", label: "MP4 H.264" },
  { mimeType: "video/mp4", extension: "mp4", label: "MP4" },
  { mimeType: "video/webm;codecs=vp9", extension: "webm", label: "WebM VP9" },
  { mimeType: "video/webm;codecs=vp8", extension: "webm", label: "WebM VP8" },
  { mimeType: "video/webm", extension: "webm", label: "WebM" }
];

const videoMimeTypesToTest = videoFormats.map((format) => format.mimeType);

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

const collectRecorderDiagnostics = () => ({
  mediaRecorderAvailable: typeof MediaRecorder !== "undefined",
  testedMimeTypes: videoMimeTypesToTest.map((mimeType) => ({
    mimeType,
    supported: typeof MediaRecorder !== "undefined" ? MediaRecorder.isTypeSupported(mimeType) : false
  }))
});

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

  const exportQuality = quality ?? exportOptions.animatedExportQuality;
  const convertingToMp4 = preferredExtension === "mp4";
  const normalizedFps = resolveAnimatedExportFps(fps, exportQuality, animation?.type);
  const totalFrames = resolveAnimationFrameCount(duration, normalizedFps);

  if (convertingToMp4) {
    logMp4Export("Runtime diagnostics before MP4 export", {
      ...collectMp4RuntimeDiagnostics(),
      recorder: collectRecorderDiagnostics()
    });

    onStatus?.("Preparing export");
    onProgress?.(0);
    const renderedFrames = renderAsciiAnimationFrames({
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
      onFrameStart: (frameIndex, frameTotal) => onStatus?.(`Rendering frame ${frameIndex + 1} of ${frameTotal}`),
      getFrame
    });
    const firstFrameResult = await renderedFrames.next();
    if (firstFrameResult.done) {
      throw new Error("Animation frame generation failed.");
    }

    const firstCanvas = firstFrameResult.value.canvas;
    const outputWidth = firstCanvas.width + (firstCanvas.width % 2);
    const outputHeight = firstCanvas.height + (firstCanvas.height % 2);
    const encodingSettings = resolveVideoEncodingSettings({
      width: outputWidth,
      height: outputHeight,
      fps: normalizedFps,
      quality: exportQuality,
      animationType: animation?.type
    });
    console.info("[ASCII Studio MP4] Deterministic export encoding settings", {
      selectedFps: normalizedFps,
      outputWidth,
      outputHeight,
      duration,
      expectedDuration: totalFrames / normalizedFps,
      expectedFrameCount: totalFrames,
      exportScale,
      quality: encodingSettings.profile.label,
      bitrateTarget: encodingSettings.bitrate,
      bitrateTargetLabel: formatBitrate(encodingSettings.bitrate),
      mp4Crf: encodingSettings.crf,
      mp4Preset: encodingSettings.preset
    });

    const mp4Frames = (async function* () {
      yield firstFrameResult.value;
      for await (const renderedFrame of renderedFrames) {
        yield renderedFrame;
      }
    })();
    const { blob: mp4Blob, actualEncodedFrameCount } = await encodePngSequenceToMp4({
      frames: mp4Frames,
      fps: normalizedFps,
      width: outputWidth,
      height: outputHeight,
      duration,
      frameCount: totalFrames,
      quality: exportQuality,
      bitrateTarget: encodingSettings.bitrate,
      crf: encodingSettings.crf,
      preset: encodingSettings.preset,
      exportScale,
      signal,
      onStatus,
      onProgress
    });
    if (actualEncodedFrameCount !== null && actualEncodedFrameCount !== totalFrames) {
      throw new Error(`MP4 encoded ${actualEncodedFrameCount} frames, expected ${totalFrames}.`);
    }
    const fileName = buildVideoFileName(sourceName, fileSuffix, "mp4");
    if (!fileName.toLowerCase().endsWith(".mp4") || mp4Blob.size <= 0 || mp4Blob.type !== "video/mp4") {
      throw new Error("MP4 conversion failed. The final MP4 output was invalid. You can export WebM instead.");
    }
    logMp4Export("Downloading deterministic MP4", {
      downloadedFileName: fileName,
      selectedFps: normalizedFps,
      duration,
      expectedDuration: totalFrames / normalizedFps,
      expectedFrameCount: totalFrames,
      actualEncodedFrameCount: actualEncodedFrameCount ?? "not detected",
      outputWidth,
      outputHeight,
      exportScale,
      mp4BlobSize: mp4Blob.size,
      mp4MimeType: mp4Blob.type,
      bitrateTarget: encodingSettings.bitrate,
      crf: encodingSettings.crf,
      preset: encodingSettings.preset
    });
    onStatus?.("Finalizing file");
    downloadBlob(mp4Blob, fileName);
    onStatus?.("Download ready");
    onProgress?.(1);
    return {
      fileName,
      mimeType: "video/mp4",
      extension: "mp4",
      usedFallback: false
    };
  }

  if (typeof HTMLCanvasElement === "undefined" || typeof HTMLCanvasElement.prototype.captureStream !== "function") {
    throw new Error("This browser cannot export video from canvas. Use GIF export for deterministic still-image animation.");
  }

  const recordingExtension: VideoExportExtension = preferredExtension;
  const format = getSupportedVideoFormat(recordingExtension, allowFormatFallback);
  if (!format) {
    throw new Error("MediaRecorder unavailable or no supported WebM canvas recording MIME type was reported. Use GIF export for deterministic still-image animation.");
  }

  const frameInterval = 1000 / normalizedFps;
  const recordingProgressWeight = 1;
  const emitRecordingProgress = (progress: number) => onProgress?.(Math.min(recordingProgressWeight, Math.max(0, progress * recordingProgressWeight)));
  const bufferedFrames: CanvasImageSource[] = [];
  let firstCanvas: HTMLCanvasElement | null = null;
  let capturedFrameCount = 0;

  try {
    onStatus?.("Preparing export");
    if (prerenderFrames) {
      onStatus?.("Rendering frames");
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
    const recordingCtx = recordingCanvas.getContext("2d");
    if (!recordingCtx) {
      throw new Error("Canvas2D is unavailable for video recording.");
    }
    recordingCtx.imageSmoothingEnabled = false;
    const encodingSettings = resolveVideoEncodingSettings({
      width: recordingCanvas.width,
      height: recordingCanvas.height,
      fps: normalizedFps,
      quality: exportQuality,
      animationType: animation?.type
    });
    console.info("[ASCII Studio Video] Export encoding settings", {
      selectedFps: normalizedFps,
      outputWidth: recordingCanvas.width,
      outputHeight: recordingCanvas.height,
      duration,
      frameCount: totalFrames,
      quality: encodingSettings.profile.label,
      bitrateTarget: encodingSettings.bitrate,
      bitrateTargetLabel: formatBitrate(encodingSettings.bitrate),
      mp4Crf: encodingSettings.crf,
      mp4Preset: encodingSettings.preset,
      recordingMimeType: format.mimeType,
      preferredExtension,
      recordingExtension
    });

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
      const bitsPerSecond = encodingSettings.bitrate;
      onStatus?.(`Recording ${format.label}`);
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
          onStatus?.(`Recording ${frameLabel} frame ${index + 1} of ${bufferedFrames.length}`);
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
          onStatus?.(`Rendering ${frameLabel} frame ${renderedFrame.frameIndex + 1} of ${renderedFrame.totalFrames}`);
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

    const fileName = buildVideoFileName(sourceName, fileSuffix, format.extension);
    onStatus?.("Finalizing file");
    console.info("[ASCII Studio WebM] Downloading video export", {
      downloadedFileName: fileName,
      selectedFps: normalizedFps,
      outputWidth: recordingCanvas.width,
      outputHeight: recordingCanvas.height,
      duration,
      frameCount: totalFrames,
      bitrateTarget: encodingSettings.bitrate,
      finalBlobSize: blob.size,
      mimeType: blob.type
    });
    downloadBlob(blob, fileName);
    onStatus?.("Download ready");
    onProgress?.(1);
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
