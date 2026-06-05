import type {
  AnimationSettings,
  AsciiSettings,
  BreakupSettings,
  ColorSettings,
  ExportOptions,
  FontSettings,
  FrameSettings,
  ImageSettings,
  RenderedPreviewCachedFramePlaceholder,
  RenderedPreviewQuality,
  RenderedPreviewState
} from "./types";
import { normalizeAnimationFps } from "./animationTiming";

type CacheFrameSource = unknown;

export type RenderedPreviewFrameSource = ImageBitmap | HTMLCanvasElement | OffscreenCanvas;

export interface RenderedPreviewCacheKeyInput {
  sourceKey: string | null;
  quality: RenderedPreviewQuality;
  animation: AnimationSettings;
  font: FontSettings;
  ascii: AsciiSettings;
  image: ImageSettings;
  frame: FrameSettings;
  breakup: BreakupSettings;
  color: ColorSettings;
  exportOptions: ExportOptions;
  exportScale: number;
  glyphMetricsKey?: string | null;
}

export interface RenderedPreviewCachedFrame<TFrame = CacheFrameSource> extends RenderedPreviewCachedFramePlaceholder {
  frame: TFrame;
}

export interface RenderedPreviewCache<TFrame = CacheFrameSource> {
  key: string;
  quality: RenderedPreviewQuality;
  fps: number;
  frameCount: number;
  width: number;
  height: number;
  frames: RenderedPreviewCachedFrame<TFrame>[];
  generatedAt: number;
}

export interface RenderedPreviewCancelHandle {
  id: string;
  signal: AbortSignal;
  cancel: () => void;
  isCancelled: () => boolean;
}

export interface RenderedPreviewRenderStart {
  cacheKey: string;
  fps: number;
  frameCount: number;
  quality: RenderedPreviewQuality;
  cancelRequestId: string;
}

export interface RenderedPreviewProgressUpdate {
  cacheKey: string;
  currentFrame: number;
  progress: number;
}

export interface RenderedPreviewRenderFinish {
  cacheKey: string;
  fps: number;
  frameCount: number;
  quality: RenderedPreviewQuality;
}

export interface RenderedPreviewPlaybackStart {
  cacheKey: string;
  fps: number;
  frameCount: number;
  currentFrame?: number;
}

export interface RenderedPreviewPlaybackFrameUpdate {
  cacheKey: string;
  currentFrame: number;
}

export const renderedPreviewQualityScales: Record<RenderedPreviewQuality, number> = {
  fast: 0.35,
  balanced: 0.5,
  final: 1
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const normalizeFrameIndex = (value: unknown, frameCount: number) => {
  const index = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 0;
  return frameCount > 0 ? clamp(index, 0, Math.max(0, frameCount - 1)) : 0;
};

const normalizeProgress = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? clamp(value, 0, 1) : 0;

export const normalizeRenderedPreviewQuality = (quality: unknown): RenderedPreviewQuality =>
  quality === "fast" || quality === "final" ? quality : "balanced";

export const createRenderedPreviewState = (
  fps = 24,
  quality: RenderedPreviewQuality = "balanced"
): RenderedPreviewState => ({
  mode: "live",
  status: "idle",
  fps: normalizeAnimationFps(fps),
  frameCount: 0,
  currentFrame: 0,
  progress: 0,
  cacheKey: null,
  quality,
  cancelRequestId: null,
  error: null
});

export const normalizeRenderedPreviewState = (value: unknown, fallbackFps = 24): RenderedPreviewState => {
  if (!isRecord(value)) {
    return createRenderedPreviewState(fallbackFps);
  }
  const frameCount = Math.max(
    0,
    typeof value.frameCount === "number" && Number.isFinite(value.frameCount) ? Math.round(value.frameCount) : 0
  );
  const status =
    value.status === "rendering" ||
    value.status === "ready" ||
    value.status === "playing" ||
    value.status === "paused" ||
    value.status === "stale" ||
    value.status === "error"
      ? value.status
      : "idle";
  return {
    mode: value.mode === "rendered" ? "rendered" : "live",
    status,
    fps: normalizeAnimationFps(
      typeof value.fps === "number" && Number.isFinite(value.fps) ? value.fps : fallbackFps
    ),
    frameCount,
    currentFrame: normalizeFrameIndex(value.currentFrame, frameCount),
    progress: normalizeProgress(value.progress),
    cacheKey: typeof value.cacheKey === "string" && value.cacheKey.trim() ? value.cacheKey : null,
    quality: normalizeRenderedPreviewQuality(value.quality),
    cancelRequestId:
      typeof value.cancelRequestId === "string" && value.cancelRequestId.trim() ? value.cancelRequestId : null,
    error: typeof value.error === "string" && value.error.trim() ? value.error : null
  };
};

export const markRenderedPreviewStateStale = (state: RenderedPreviewState): RenderedPreviewState =>
  state.status === "idle"
    ? state
    : {
        ...state,
        status: "stale",
        progress: 0,
        cancelRequestId: null
      };

export const clearRenderedPreviewCacheState = (
  state: RenderedPreviewState,
  fps = state.fps
): RenderedPreviewState => ({
  ...createRenderedPreviewState(fps, state.quality),
  mode: state.mode
});

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
};

const hashString = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

export const createRenderedPreviewCacheKey = (input: RenderedPreviewCacheKeyInput) =>
  `rendered-preview:${hashString(stableStringify(input))}`;

export const createRenderedPreviewCancelHandle = (
  id = `rendered-preview-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
): RenderedPreviewCancelHandle => {
  const controller = new AbortController();
  return {
    id,
    signal: controller.signal,
    cancel: () => controller.abort(),
    isCancelled: () => controller.signal.aborted
  };
};

const disposedRenderedPreviewFrames = new WeakSet<object>();

export const disposeRenderedPreviewFrame = (frame: CacheFrameSource) => {
  if (!frame || typeof frame !== "object" || disposedRenderedPreviewFrames.has(frame)) {
    return;
  }

  disposedRenderedPreviewFrames.add(frame);

  if (typeof ImageBitmap !== "undefined" && frame instanceof ImageBitmap) {
    try {
      frame.close();
    } catch {
      // Ignore already-detached ImageBitmaps; cleanup should stay idempotent.
    }
    return;
  }

  if (typeof HTMLCanvasElement !== "undefined" && frame instanceof HTMLCanvasElement) {
    frame.getContext("2d")?.clearRect(0, 0, frame.width, frame.height);
    frame.width = 1;
    frame.height = 1;
    return;
  }

  if (typeof OffscreenCanvas !== "undefined" && frame instanceof OffscreenCanvas) {
    frame.getContext("2d")?.clearRect(0, 0, frame.width, frame.height);
    frame.width = 1;
    frame.height = 1;
  }
};

export const freeRenderedPreviewCache = (cache: RenderedPreviewCache | null | undefined) => {
  if (!cache) {
    return;
  }
  for (const frame of cache.frames) {
    disposeRenderedPreviewFrame(frame.frame);
  }
  cache.frames.length = 0;
};
