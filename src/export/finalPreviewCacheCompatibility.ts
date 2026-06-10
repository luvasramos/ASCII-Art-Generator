import { resolveAnimationFrameCount } from "../renderer/animationTiming";
import type {
  AnimatedExportQuality,
  AnimationPreviewFormat,
  AnimationType,
  RenderedPreviewState
} from "../renderer/types";
import type {
  RenderedPreviewCache,
  RenderedPreviewFrameSource
} from "../renderer/renderedPreviewModel";
import { resolveAnimatedExportFps } from "./exportQuality";

export type FinalPreviewCacheIncompatibilityReason =
  | "no-format"
  | "not-ready"
  | "preview-quality"
  | "preview-format"
  | "missing-cache"
  | "cache-quality"
  | "cache-format"
  | "transparent-video"
  | "fps"
  | "frame-count"
  | "dimensions"
  | "export-scale";

export interface FinalPreviewCacheCompatibility {
  reusable: boolean;
  reason: FinalPreviewCacheIncompatibilityReason | null;
  effectiveFps: number;
  frameCount: number;
}

const canUseRenderedPreviewStatus = (status: RenderedPreviewState["status"]) =>
  status === "ready" || status === "playing" || status === "paused";

const matchesRounded = (actual: number, expected: number) =>
  Math.round(actual) === Math.round(expected);

export const getFinalPreviewCacheCompatibility = ({
  preview,
  cache,
  format,
  fps,
  duration,
  exportQuality,
  animationType,
  outputWidth,
  outputHeight,
  exportScale,
  transparentBackground,
  allowTransparentVideo = true
}: {
  preview: RenderedPreviewState;
  cache: RenderedPreviewCache<RenderedPreviewFrameSource> | null | undefined;
  format: AnimationPreviewFormat | null;
  fps: number;
  duration: number;
  exportQuality: AnimatedExportQuality;
  animationType?: AnimationType;
  outputWidth: number | null;
  outputHeight: number | null;
  exportScale: number;
  transparentBackground: boolean;
  allowTransparentVideo?: boolean;
}): FinalPreviewCacheCompatibility => {
  const effectiveFps = resolveAnimatedExportFps(fps, exportQuality, animationType);
  const frameCount = resolveAnimationFrameCount(duration, effectiveFps);
  const incompatible = (reason: FinalPreviewCacheIncompatibilityReason): FinalPreviewCacheCompatibility => ({
    reusable: false,
    reason,
    effectiveFps,
    frameCount
  });

  if (!format) {
    return incompatible("no-format");
  }
  if (!canUseRenderedPreviewStatus(preview.status) || !preview.cacheKey) {
    return incompatible("not-ready");
  }
  if (preview.quality !== "final") {
    return incompatible("preview-quality");
  }
  if (preview.previewFormat !== format) {
    return incompatible("preview-format");
  }
  if (!cache || cache.key !== preview.cacheKey || !cache.frames.length) {
    return incompatible("missing-cache");
  }
  if (cache.quality !== "final") {
    return incompatible("cache-quality");
  }
  if (cache.previewFormat !== format) {
    return incompatible("cache-format");
  }
  if (!allowTransparentVideo && transparentBackground && (format === "webm" || format === "mp4")) {
    return incompatible("transparent-video");
  }
  if (!matchesRounded(preview.fps, effectiveFps) || !matchesRounded(cache.fps, effectiveFps)) {
    return incompatible("fps");
  }
  if (
    !matchesRounded(preview.frameCount, frameCount) ||
    !matchesRounded(cache.frameCount, frameCount) ||
    cache.frames.length !== frameCount
  ) {
    return incompatible("frame-count");
  }
  if (
    outputWidth === null ||
    outputHeight === null ||
    !matchesRounded(cache.width, outputWidth) ||
    !matchesRounded(cache.height, outputHeight)
  ) {
    return incompatible("dimensions");
  }
  if (!matchesRounded(cache.exportScale * 1000, exportScale * 1000)) {
    return incompatible("export-scale");
  }

  return {
    reusable: true,
    reason: null,
    effectiveFps,
    frameCount
  };
};
