import type {
  RenderedPreviewCache,
  RenderedPreviewFrameSource
} from "../renderer/renderedPreviewModel";
import type { RenderedAnimationFrame } from "./renderAnimationFrames";

interface CachedAnimationFramesArgs {
  cache: RenderedPreviewCache<RenderedPreviewFrameSource>;
  signal?: AbortSignal;
  onFrameStart?: (frameIndex: number, totalFrames: number) => void;
}

const createAbortError = () => {
  const error = new Error("Cached animation export canceled.");
  error.name = "AbortError";
  return error;
};

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) {
    throw createAbortError();
  }
};

const yieldToBrowser = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0));

export const cachedAnimationFrameMatches = (
  cache: RenderedPreviewCache<RenderedPreviewFrameSource> | null | undefined,
  fps: number,
  frameCount: number
) =>
  Boolean(cache) &&
  Math.round(cache?.fps ?? 0) === Math.round(fps) &&
  Math.round(cache?.frameCount ?? 0) === Math.round(frameCount) &&
  (cache?.frames.length ?? 0) === Math.round(frameCount);

export async function* renderCachedAnimationFrames({
  cache,
  signal,
  onFrameStart
}: CachedAnimationFramesArgs): AsyncGenerator<RenderedAnimationFrame> {
  if (!cache.frames.length) {
    throw new Error("Final preview cache has no frames to export.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(cache.width));
  canvas.height = Math.max(1, Math.round(cache.height));
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) {
    throw new Error("Canvas2D is unavailable for cached animation export.");
  }
  context.imageSmoothingEnabled = false;

  const totalFrames = Math.max(1, Math.round(cache.frameCount));
  for (let index = 0; index < totalFrames; index += 1) {
    throwIfAborted(signal);
    const cachedFrame = cache.frames[index];
    if (!cachedFrame) {
      throw new Error(`Final preview cache is missing frame ${index + 1}.`);
    }
    onFrameStart?.(index, totalFrames);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
    context.drawImage(cachedFrame.frame, 0, 0, canvas.width, canvas.height);
    yield {
      frameIndex: index,
      totalFrames,
      timestamp: cachedFrame.timestamp,
      progress: totalFrames > 1 ? index / (totalFrames - 1) : 0,
      canvas
    };
    if (index % 4 === 3) {
      await yieldToBrowser();
    }
  }
}
