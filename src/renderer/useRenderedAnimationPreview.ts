import { useCallback, useEffect, useRef } from "react";
import { renderAsciiAnimationFrames } from "../export/renderAnimationFrames";
import type { AnimatedImageRenderer } from "../processing/animateImage";
import { useStudioStore } from "../state/useStudioStore";
import { normalizeAnimationFps, resolveAnimationFrameCount } from "./animationTiming";
import {
  createRenderedPreviewCacheKey,
  createRenderedPreviewCancelHandle,
  disposeRenderedPreviewFrame,
  freeRenderedPreviewCache,
  renderedPreviewQualityScales,
  type RenderedPreviewCache,
  type RenderedPreviewCachedFrame,
  type RenderedPreviewCancelHandle,
  type RenderedPreviewFrameSource
} from "./renderedPreviewModel";
import type {
  AnimationSettings,
  AsciiSettings,
  BreakupSettings,
  ColorSettings,
  ExportOptions,
  FontSettings,
  FrameSettings,
  GlyphMetric,
  ImageSettings,
  MaskSettings,
  AnimationPreviewFormat,
  RenderedPreviewQuality
} from "./types";

interface RenderedAnimationPreviewArgs {
  sourceKey: string | null;
  renderer: AnimatedImageRenderer | null;
  font: FontSettings;
  ascii: AsciiSettings;
  image: ImageSettings;
  frame: FrameSettings;
  breakup: BreakupSettings;
  mask: MaskSettings;
  color: ColorSettings;
  exportOptions: ExportOptions;
  exportScale: number;
  glyphMetrics: GlyphMetric[];
  animation: AnimationSettings;
  quality: RenderedPreviewQuality;
  previewFormat: AnimationPreviewFormat;
}

interface GenerateRenderedAnimationPreviewArgs extends RenderedAnimationPreviewArgs {
  cancelHandle: RenderedPreviewCancelHandle;
  onProgress?: (progress: RenderedAnimationPreviewProgress) => void;
}

interface RenderedAnimationPreviewProgress {
  currentFrame: number;
  renderedFrameCount: number;
  frameCount: number;
  progress: number;
}

export const MAX_RENDERED_PREVIEW_CACHE_BYTES = 1024 * 1024 * 1024;

const renderedPreviewCaches = new Map<string, RenderedPreviewCache<RenderedPreviewFrameSource>>();

const yieldToBrowser = (signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    let settled = false;
    let frameHandle: number | null = null;
    let timeoutHandle: ReturnType<typeof globalThis.setTimeout> | null = null;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      if (frameHandle !== null && typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(frameHandle);
      }
      if (timeoutHandle !== null) {
        globalThis.clearTimeout(timeoutHandle);
      }
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    signal?.addEventListener("abort", finish, { once: true });
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      frameHandle = window.requestAnimationFrame(finish);
    }
    timeoutHandle = globalThis.setTimeout(finish, 0);
  });

const formatBytes = (bytes: number) => {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  return `${Math.max(1, Math.round(bytes / (1024 * 1024)))} MB`;
};

const createGlyphMetricsKey = (glyphMetrics: GlyphMetric[]) =>
  glyphMetrics
    .map((metric) =>
      [
        metric.glyph,
        metric.density.toFixed(4),
        metric.edgeWeight.toFixed(4),
        metric.fillRatio.toFixed(4),
        metric.directionalStructure.toFixed(4)
      ].join(":")
    )
    .join("|");

const estimateRenderedPreviewCacheBytes = (width: number, height: number, frameCount: number) =>
  Math.max(1, Math.round(width)) * Math.max(1, Math.round(height)) * 4 * Math.max(1, Math.round(frameCount));

const getNow = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export const resolveRenderedPreviewScale = (exportScale: number, quality: RenderedPreviewQuality) =>
  Math.max(0.1, exportScale * (renderedPreviewQualityScales[quality] ?? renderedPreviewQualityScales.balanced));

export const createRenderedAnimationPreviewCacheKey = ({
  sourceKey,
  quality,
  previewFormat,
  animation,
  font,
  ascii,
  image,
  frame,
  breakup,
  mask,
  color,
  exportOptions,
  exportScale,
  glyphMetrics
}: RenderedAnimationPreviewArgs) =>
  createRenderedPreviewCacheKey({
    sourceKey,
    quality,
    previewFormat,
    animation,
    font,
    ascii,
    image,
    frame,
    breakup,
    mask,
    color,
    exportOptions,
    exportScale: resolveRenderedPreviewScale(exportScale, quality),
    glyphMetricsKey: createGlyphMetricsKey(glyphMetrics)
  });

const throwIfCancelled = (cancelHandle: RenderedPreviewCancelHandle) => {
  if (cancelHandle.isCancelled()) {
    const error = new Error("Rendered preview generation canceled.");
    error.name = "AbortError";
    throw error;
  }
};

const assertRenderedPreviewCacheSize = (width: number, height: number, frameCount: number) => {
  const estimatedBytes = estimateRenderedPreviewCacheBytes(width, height, frameCount);
  if (estimatedBytes <= MAX_RENDERED_PREVIEW_CACHE_BYTES) {
    return estimatedBytes;
  }

  throw new Error(
    `This preview is too large to cache (${formatBytes(
      estimatedBytes
    )}). Try a smaller output size, a shorter duration, or a lower FPS.`
  );
};

const cloneFrameSource = async (canvas: HTMLCanvasElement): Promise<RenderedPreviewFrameSource> => {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(canvas);
  }

  if (typeof OffscreenCanvas !== "undefined") {
    const clone = new OffscreenCanvas(canvas.width, canvas.height);
    const context = clone.getContext("2d");
    if (!context) {
      throw new Error("Canvas2D is unavailable for rendered preview frame caching.");
    }
    context.drawImage(canvas, 0, 0);
    return clone;
  }

  const clone = document.createElement("canvas");
  clone.width = canvas.width;
  clone.height = canvas.height;
  const context = clone.getContext("2d");
  if (!context) {
    throw new Error("Canvas2D is unavailable for rendered preview frame caching.");
  }
  context.drawImage(canvas, 0, 0);
  return clone;
};

export const getRenderedPreviewCache = (cacheKey: string | null) =>
  cacheKey ? renderedPreviewCaches.get(cacheKey) ?? null : null;

export const clearRenderedPreviewMemoryCache = (cacheKey?: string | null) => {
  if (cacheKey) {
    const cache = renderedPreviewCaches.get(cacheKey);
    freeRenderedPreviewCache(cache);
    renderedPreviewCaches.delete(cacheKey);
    return;
  }

  for (const cache of renderedPreviewCaches.values()) {
    freeRenderedPreviewCache(cache);
  }
  renderedPreviewCaches.clear();
};

const storeRenderedPreviewCache = (cache: RenderedPreviewCache<RenderedPreviewFrameSource>) => {
  clearRenderedPreviewMemoryCache(cache.key);
  renderedPreviewCaches.set(cache.key, cache);
};

const describeRenderedPreviewError = (error: unknown) => {
  const message = error instanceof Error ? error.message : "";
  if (!message) {
    return "Rendered preview generation failed.";
  }
  if (/too large to cache/i.test(message)) {
    return message;
  }
  if (/canvas2d|canvas/i.test(message)) {
    return "The browser could not create the rendered preview canvas. Try a smaller output size or reload the app.";
  }
  if (/frame/i.test(message)) {
    return message;
  }
  return `Rendered preview generation failed. ${message}`;
};

export const generateRenderedAnimationPreview = async ({
  sourceKey,
  renderer,
  font,
  ascii,
  image,
  frame,
  breakup,
  mask,
  color,
  exportOptions,
  exportScale,
  glyphMetrics,
  animation,
  quality,
  previewFormat,
  cancelHandle,
  onProgress
}: GenerateRenderedAnimationPreviewArgs): Promise<RenderedPreviewCache<RenderedPreviewFrameSource>> => {
  if (!renderer) {
    throw new Error("Rendered preview needs an animated image renderer.");
  }
  if (!glyphMetrics.length) {
    throw new Error("Rendered preview needs glyph metrics before frames can be generated.");
  }
  throwIfCancelled(cancelHandle);

  const fps = normalizeAnimationFps(animation.fps);
  const frameCount = resolveAnimationFrameCount(animation.loopDuration, fps);
  const renderAnimation: AnimationSettings = { ...animation, enabled: true };
  const cacheKey = createRenderedAnimationPreviewCacheKey({
    sourceKey,
    renderer,
    font,
    ascii,
    image,
    frame,
    breakup,
    mask,
    color,
    exportOptions,
    exportScale,
    glyphMetrics,
    animation: renderAnimation,
    quality,
    previewFormat
  });
  const previewScale = resolveRenderedPreviewScale(exportScale, quality);
  const frames: RenderedPreviewCachedFrame<RenderedPreviewFrameSource>[] = [];
  let width = 0;
  let height = 0;
  let memoryEstimateBytes = 0;
  let cacheShapeChecked = false;

  try {
    for await (const renderedFrame of renderAsciiAnimationFrames({
      duration: animation.loopDuration,
      fps,
      font,
      ascii,
      image,
      frame,
      breakup,
      mask,
      color,
      exportOptions,
      exportScale: previewScale,
      glyphMetrics,
      animation: renderAnimation,
      renderLikePreview: true,
      signal: cancelHandle.signal,
      onFrameStart: () => {
        throwIfCancelled(cancelHandle);
      },
      onCanvasReady: (canvasWidth, canvasHeight, totalFrames) => {
        throwIfCancelled(cancelHandle);
        width = canvasWidth;
        height = canvasHeight;
        memoryEstimateBytes = assertRenderedPreviewCacheSize(width, height, totalFrames);
        cacheShapeChecked = true;
      },
      getFrame: (timeSeconds, progress, frameIndex, totalFrames) =>
        renderer.render(renderAnimation, timeSeconds || (frameIndex / Math.max(1, totalFrames)) * animation.loopDuration)
    })) {
      throwIfCancelled(cancelHandle);
      width = renderedFrame.canvas.width;
      height = renderedFrame.canvas.height;
      if (!cacheShapeChecked) {
        memoryEstimateBytes = assertRenderedPreviewCacheSize(width, height, frameCount);
        cacheShapeChecked = true;
      }

      const frameSource = await cloneFrameSource(renderedFrame.canvas);
      if (cancelHandle.isCancelled()) {
        disposeRenderedPreviewFrame(frameSource);
      }
      throwIfCancelled(cancelHandle);
      frames.push({
        frameIndex: renderedFrame.frameIndex,
        timestamp: renderedFrame.timestamp,
        width,
        height,
        frame: frameSource
      });
      const renderedFrameCount = frames.length;
      onProgress?.({
        currentFrame: renderedFrame.frameIndex,
        renderedFrameCount,
        frameCount,
        progress: frameCount > 0 ? renderedFrameCount / frameCount : 0
      });
      throwIfCancelled(cancelHandle);
      await yieldToBrowser(cancelHandle.signal);
      throwIfCancelled(cancelHandle);
    }

    throwIfCancelled(cancelHandle);
    if (frames.length !== frameCount) {
      throw new Error(`Rendered preview created ${frames.length} frames, but ${frameCount} were expected.`);
    }

    const cache: RenderedPreviewCache<RenderedPreviewFrameSource> = {
      key: cacheKey,
      quality,
      previewFormat,
      fps,
      frameCount,
      width,
      height,
      exportScale: previewScale,
      memoryEstimateBytes: memoryEstimateBytes || estimateRenderedPreviewCacheBytes(width, height, frameCount),
      frames,
      generatedAt: Date.now()
    };
    storeRenderedPreviewCache(cache);
    return cache;
  } catch (error) {
    freeRenderedPreviewCache({
      key: cacheKey,
      quality,
      previewFormat,
      fps,
      frameCount,
      width,
      height,
      exportScale: previewScale,
      memoryEstimateBytes: memoryEstimateBytes || estimateRenderedPreviewCacheBytes(width, height, frameCount),
      frames,
      generatedAt: Date.now()
    });
    throw error;
  }
};

export const useRenderedAnimationPreview = (args: RenderedAnimationPreviewArgs) => {
  const cancelHandleRef = useRef<RenderedPreviewCancelHandle | null>(null);

  useEffect(
    () =>
      useStudioStore.subscribe((state, previousState) => {
        const preview = state.renderedPreview;
        const previousPreview = previousState.renderedPreview;
        if (preview.status === "stale" && previousPreview.status !== "stale" && preview.cacheKey) {
          clearRenderedPreviewMemoryCache(preview.cacheKey);
        }
      }),
    []
  );

  const generate = useCallback(async () => {
    const cancelHandle = createRenderedPreviewCancelHandle();
    cancelHandleRef.current?.cancel();
    cancelHandleRef.current = cancelHandle;
    const fps = normalizeAnimationFps(args.animation.fps);
    const frameCount = resolveAnimationFrameCount(args.animation.loopDuration, fps);
    const renderArgs = {
      ...args,
      animation: { ...args.animation, enabled: true }
    };
    const cacheKey = createRenderedAnimationPreviewCacheKey(renderArgs);
    let lastProgressUpdateAt = 0;
    clearRenderedPreviewMemoryCache(cacheKey);
    useStudioStore.getState().startRenderedPreviewRender({
      cacheKey,
      fps,
      frameCount,
      quality: args.quality,
      previewFormat: args.previewFormat,
      cancelRequestId: cancelHandle.id
    });

    try {
      const cache = await generateRenderedAnimationPreview({
        ...renderArgs,
        cancelHandle,
        onProgress: ({ currentFrame, renderedFrameCount, frameCount: totalFrames, progress }) => {
          const now = getNow();
          const shouldUpdate =
            totalFrames <= 120 ||
            renderedFrameCount <= 1 ||
            renderedFrameCount >= totalFrames ||
            now - lastProgressUpdateAt >= 75;
          if (!shouldUpdate) {
            return;
          }
          lastProgressUpdateAt = now;
          useStudioStore.getState().updateRenderedPreviewProgress({
            cacheKey,
            currentFrame,
            progress
          });
        }
      });
      const state = useStudioStore.getState().renderedPreview;
      if (state.cacheKey !== cache.key || state.cancelRequestId !== cancelHandle.id || state.status === "stale") {
        freeRenderedPreviewCache(cache);
        renderedPreviewCaches.delete(cache.key);
        return null;
      }
      useStudioStore.getState().finishRenderedPreviewRender({
        cacheKey: cache.key,
        fps: cache.fps,
        frameCount: cache.frameCount,
        quality: cache.quality,
        previewFormat: cache.previewFormat
      });
      return cache;
    } catch (error) {
      clearRenderedPreviewMemoryCache(cacheKey);
      if (cancelHandle.isCancelled() || (error instanceof Error && error.name === "AbortError")) {
        useStudioStore.getState().cancelRenderedPreviewRender(cancelHandle.id);
        return null;
      }
      useStudioStore
        .getState()
        .failRenderedPreviewRender(describeRenderedPreviewError(error));
      return null;
    } finally {
      if (cancelHandleRef.current?.id === cancelHandle.id) {
        cancelHandleRef.current = null;
      }
    }
  }, [args]);

  const cancel = useCallback(() => {
    const cancelHandle = cancelHandleRef.current;
    const cacheKey = useStudioStore.getState().renderedPreview.cacheKey;
    cancelHandle?.cancel();
    clearRenderedPreviewMemoryCache(cacheKey);
    useStudioStore.getState().cancelRenderedPreviewRender(cancelHandle?.id ?? null);
  }, []);

  const clear = useCallback(() => {
    const cacheKey = useStudioStore.getState().renderedPreview.cacheKey;
    clearRenderedPreviewMemoryCache(cacheKey);
    useStudioStore.getState().clearRenderedPreviewCache();
  }, []);

  return {
    generate,
    cancel,
    clear,
    getCache: () => getRenderedPreviewCache(useStudioStore.getState().renderedPreview.cacheKey)
  };
};
