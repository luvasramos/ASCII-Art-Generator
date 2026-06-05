import { useCallback, useEffect, useRef, type RefObject } from "react";
import { useStudioStore } from "../state/useStudioStore";
import { normalizeAnimationFps } from "./animationTiming";
import type {
  RenderedPreviewCache,
  RenderedPreviewCachedFrame,
  RenderedPreviewFrameSource
} from "./renderedPreviewModel";
import { getRenderedPreviewCache } from "./useRenderedAnimationPreview";

interface RenderedAnimationPlaybackArgs {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  cacheKey?: string | null;
  loop?: boolean;
  clearBeforeDraw?: boolean;
}

interface RenderedAnimationPlaybackPlayOptions {
  restart?: boolean;
}

interface RenderedAnimationPlaybackSession {
  cacheKey: string;
  startedAt: number;
  fps: number;
  frameCount: number;
  loop: boolean;
  lastFrameIndex: number;
  clearBeforeDraw: boolean;
}

const getNow = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

const requestPlaybackFrame = (callback: FrameRequestCallback) => {
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    return window.requestAnimationFrame(callback);
  }
  return globalThis.setTimeout(() => callback(getNow()), 16);
};

const cancelPlaybackFrame = (frameHandle: number) => {
  if (typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function") {
    window.cancelAnimationFrame(frameHandle);
    return;
  }
  globalThis.clearTimeout(frameHandle);
};

const resolveActiveCache = (cacheKey?: string | null) => {
  const stateCacheKey = useStudioStore.getState().renderedPreview.cacheKey;
  return getRenderedPreviewCache(cacheKey ?? stateCacheKey);
};

const validatePlaybackCache = (
  cache: RenderedPreviewCache<RenderedPreviewFrameSource> | null
): RenderedPreviewCache<RenderedPreviewFrameSource> => {
  if (!cache) {
    throw new Error("Rendered preview playback needs a generated frame cache.");
  }
  if (!cache.frames.length) {
    throw new Error("Rendered preview playback cannot start because the frame cache is empty.");
  }
  if (!Number.isFinite(cache.frameCount) || cache.frameCount <= 0) {
    throw new Error("Rendered preview playback cannot start because the cached frame count is invalid.");
  }
  return cache;
};

const preparePlaybackCanvas = (
  canvas: HTMLCanvasElement,
  cache: RenderedPreviewCache<RenderedPreviewFrameSource>
) => {
  const width = Math.max(1, Math.round(cache.width));
  const height = Math.max(1, Math.round(cache.height));
  if (canvas.width !== width) {
    canvas.width = width;
  }
  if (canvas.height !== height) {
    canvas.height = height;
  }
  canvas.style.width = "auto";
  canvas.style.height = "auto";
  canvas.style.aspectRatio = `${width} / ${height}`;
  canvas.style.objectFit = "contain";
};

export const drawRenderedPreviewFrame = (
  canvas: HTMLCanvasElement,
  frame: RenderedPreviewCachedFrame<RenderedPreviewFrameSource>,
  clearBeforeDraw = true
) => {
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) {
    throw new Error("Canvas2D is unavailable for rendered preview playback.");
  }
  if (clearBeforeDraw) {
    context.clearRect(0, 0, canvas.width, canvas.height);
  }
  context.globalAlpha = 1;
  context.globalCompositeOperation = "source-over";
  context.imageSmoothingEnabled = false;
  context.drawImage(frame.frame, 0, 0, canvas.width, canvas.height);
};

const drawCachedFrameAtIndex = (
  canvas: HTMLCanvasElement,
  cache: RenderedPreviewCache<RenderedPreviewFrameSource>,
  frameIndex: number,
  clearBeforeDraw: boolean
) => {
  const safeIndex = Math.max(0, Math.min(cache.frames.length - 1, frameIndex));
  const frame = cache.frames[safeIndex];
  if (!frame) {
    throw new Error(`Rendered preview playback cannot draw missing frame ${frameIndex}.`);
  }
  drawRenderedPreviewFrame(canvas, frame, clearBeforeDraw);
  return frame.frameIndex;
};

export const useRenderedAnimationPlayback = ({
  canvasRef,
  cacheKey,
  loop = true,
  clearBeforeDraw = true
}: RenderedAnimationPlaybackArgs) => {
  const frameHandleRef = useRef<number | null>(null);
  const sessionRef = useRef<RenderedAnimationPlaybackSession | null>(null);

  const cancelLoop = useCallback(() => {
    if (frameHandleRef.current !== null) {
      cancelPlaybackFrame(frameHandleRef.current);
      frameHandleRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    cancelLoop();
    sessionRef.current = null;
    useStudioStore.getState().stopRenderedPreviewPlayback();
  }, [cancelLoop]);

  const tick = useCallback(
    (timestamp: number) => {
      const session = sessionRef.current;
      const canvas = canvasRef.current;
      if (!session || !canvas) {
        stop();
        return;
      }

      const state = useStudioStore.getState().renderedPreview;
      if (state.status === "stale" || state.cacheKey !== session.cacheKey) {
        cancelLoop();
        sessionRef.current = null;
        return;
      }

      const cache = getRenderedPreviewCache(session.cacheKey);
      if (!cache) {
        useStudioStore.getState().failRenderedPreviewPlayback("Rendered preview frame cache is no longer available.");
        stop();
        return;
      }

      const elapsedMs = Math.max(0, timestamp - session.startedAt);
      let frameIndex = Math.floor((elapsedMs / 1000) * session.fps);
      if (session.loop) {
        frameIndex %= session.frameCount;
      } else if (frameIndex >= session.frameCount) {
        frameIndex = session.frameCount - 1;
      }

      try {
        if (frameIndex !== session.lastFrameIndex) {
          const drawnFrameIndex = drawCachedFrameAtIndex(canvas, cache, frameIndex, session.clearBeforeDraw);
          session.lastFrameIndex = frameIndex;
          useStudioStore.getState().updateRenderedPreviewPlaybackFrame({
            cacheKey: session.cacheKey,
            currentFrame: drawnFrameIndex
          });
        }
      } catch (error) {
        useStudioStore
          .getState()
          .failRenderedPreviewPlayback(error instanceof Error ? error.message : "Rendered preview playback failed.");
        stop();
        return;
      }

      if (!session.loop && frameIndex >= session.frameCount - 1) {
        stop();
        return;
      }

      frameHandleRef.current = requestPlaybackFrame(tick);
    },
    [cancelLoop, canvasRef, stop]
  );

  const play = useCallback((options?: RenderedAnimationPlaybackPlayOptions) => {
    try {
      const canvas = canvasRef.current;
      if (!canvas) {
        throw new Error("Rendered preview playback needs a target canvas.");
      }
      const state = useStudioStore.getState().renderedPreview;
      if (state.status === "error" || state.status === "stale" || state.status === "rendering") {
        return null;
      }
      const cache = validatePlaybackCache(resolveActiveCache(cacheKey));
      if (state.cacheKey !== cache.key) {
        return null;
      }
      const fps = normalizeAnimationFps(cache.fps);
      const frameCount = Math.min(Math.max(1, cache.frameCount), cache.frames.length);
      const resumeFrame = !options?.restart && state.status === "paused" ? state.currentFrame : 0;
      const currentFrame = Math.max(0, Math.min(frameCount - 1, resumeFrame));
      preparePlaybackCanvas(canvas, cache);
      drawCachedFrameAtIndex(canvas, cache, currentFrame, clearBeforeDraw);
      cancelLoop();
      sessionRef.current = {
        cacheKey: cache.key,
        startedAt: getNow() - (currentFrame / fps) * 1000,
        fps,
        frameCount,
        loop,
        lastFrameIndex: currentFrame,
        clearBeforeDraw
      };
      useStudioStore.getState().startRenderedPreviewPlayback({
        cacheKey: cache.key,
        fps,
        frameCount,
        currentFrame
      });
      frameHandleRef.current = requestPlaybackFrame(tick);
      return cache;
    } catch (error) {
      useStudioStore
        .getState()
        .failRenderedPreviewPlayback(error instanceof Error ? error.message : "Rendered preview playback failed.");
      return null;
    }
  }, [cacheKey, cancelLoop, canvasRef, clearBeforeDraw, loop, tick]);

  const pause = useCallback(() => {
    cancelLoop();
    sessionRef.current = null;
    useStudioStore.getState().pauseRenderedPreviewPlayback();
  }, [cancelLoop]);

  const drawFrame = useCallback(
    (frameIndex: number) => {
      const canvas = canvasRef.current;
      if (!canvas) {
        throw new Error("Rendered preview playback needs a target canvas.");
      }
      const state = useStudioStore.getState().renderedPreview;
      if (
        state.status === "error" ||
        state.status === "stale" ||
        state.status === "rendering" ||
        !state.cacheKey
      ) {
        return null;
      }
      const cache = validatePlaybackCache(resolveActiveCache(cacheKey));
      if (state.cacheKey !== cache.key) {
        return null;
      }
      preparePlaybackCanvas(canvas, cache);
      const drawnFrameIndex = drawCachedFrameAtIndex(canvas, cache, frameIndex, clearBeforeDraw);
      useStudioStore.getState().updateRenderedPreviewPlaybackFrame({
        cacheKey: cache.key,
        currentFrame: drawnFrameIndex
      });
      return drawnFrameIndex;
    },
    [cacheKey, canvasRef, clearBeforeDraw]
  );

  useEffect(() => stop, [stop]);

  return {
    play,
    pause,
    stop,
    cancel: stop,
    drawFrame,
    isPlaying: () => sessionRef.current !== null
  };
};
