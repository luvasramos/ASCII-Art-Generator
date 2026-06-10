import { useEffect, useRef, type RefObject } from "react";
import { createGlyphAtlas } from "../atlas/glyphAtlas";
import type { GlyphAtlas } from "../atlas/glyphAtlas";
import type { ImageGlyphAtlas } from "../atlas/imageGlyphAtlas";
import { normalizeCharacterSet } from "../ascii/charset";
import { createAnimatedImageRenderer, type AnimatedImageRenderer } from "../processing/animateImage";
import { generateRenderGrid } from "../processing/renderGrid";
import {
  createLivePreviewFrameCacheKey,
  LivePreviewFrameCache,
  type LivePreviewFrameCacheMetadata
} from "./livePreviewFrameCache";
import { clearLivePreviewSourceProxyCache, resolveLivePreviewSourceProxy } from "./livePreviewSourceProxy";
import { resolveAnimatedProcessingSettings } from "./animationEffects";
import { normalizeAnimationFps, resolveAnimationFrameCount } from "./animationTiming";
import { scaleFontForRenderResolution } from "./geometry";
import {
  compositeEchoFrame,
  createEchoFrameHistory,
  isEchoActive,
  pushEchoFrame,
  resetEchoFrameHistory
} from "./echoComposite";
import { renderAsciiLayers } from "./layeredCanvasRenderer";
import type {
  AnimationSettings,
  AsciiSettings,
  BreakupSettings,
  ColorSettings,
  FontSettings,
  FrameSettings,
  GlyphMetric,
  ImageSettings,
  LivePreviewOptimizationLevel,
  RenderGrid,
  WorkerRenderOptions
} from "./types";

export interface LivePreviewStats {
  phase: "optimizing" | "updating" | "live" | "testing";
  targetFps: number;
  actualFps: number;
  averageRenderMs: number;
  droppedFrames: number;
  isSlow: boolean;
  previewScale: number;
  previewWidth: number;
  previewHeight: number;
  outputWidth: number;
  outputHeight: number;
  sourceScale: number;
  proxySourceWidth: number;
  proxySourceHeight: number;
  stripSize: number;
  cacheEnabled: boolean;
  cacheFrames: number;
  cacheFrameCount: number;
  cacheComplete: boolean;
}

interface AnimatedAsciiPreviewArgs {
  active: boolean;
  paused?: boolean;
  editPreviewActive?: boolean;
  renderer: AnimatedImageRenderer | null;
  sourceImageData?: ImageData | null;
  backgroundCanvasRef: RefObject<HTMLCanvasElement>;
  glyphCanvasRef: RefObject<HTMLCanvasElement>;
  baseGrid: RenderGrid | null;
  atlas: GlyphAtlas | null;
  imageGlyphAtlas?: ImageGlyphAtlas | null;
  font: FontSettings;
  ascii: AsciiSettings;
  image: ImageSettings;
  frame: FrameSettings;
  breakup: BreakupSettings;
  color: ColorSettings;
  animation: AnimationSettings;
  optimizationLevel?: LivePreviewOptimizationLevel;
  glyphMetrics: GlyphMetric[];
  onPerformanceWarning?: (message: string) => void;
  onLivePreviewStats?: (stats: LivePreviewStats | null) => void;
}

const createPreviewClockKey = (animation: AnimationSettings) =>
  [
    animation.type,
    animation.fps,
    animation.loopDuration,
    animation.effectLoopsPerLoop,
    animation.spinRotationsPerLoop,
    animation.spinDirection,
    animation.velocity,
    animation.scaleMovement,
    animation.matrixLoopStyle,
    animation.matrixOverlaySpeed,
    animation.matrixOverlayChangeRate,
    animation.direction,
    animation.ambientDirection,
    animation.ambientAngle
  ].join(":");

const LIVE_PREVIEW_SCALE_STOPS = [1, 0.75, 0.66, 0.5, 0.425, 0.33, 0.25, 0.2, 0.16] as const;
const LIVE_PREVIEW_SOURCE_SCALE_STOPS = [1, 0.75, 0.5, 0.33, 0.25, 0.2, 0.16] as const;
const LIVE_PREVIEW_STRIP_SIZE_STOPS = [1, 2, 4, 8, 12, 16, 24] as const;
const LIVE_PREVIEW_STATS_INTERVAL_MS = 420;
const LIVE_PREVIEW_SCALE_COOLDOWN_MS = 1000;
const LIVE_PREVIEW_EDIT_SETTLE_MS = 520;
const LIVE_PREVIEW_DEFAULT_READY_CACHE_RATIO = 0.5;
const LIVE_PREVIEW_SHORT_LOOP_CACHE_FRAME_LIMIT = 48;
const LIVE_PREVIEW_STABLE_PROFILE_TTL_MS = 1000 * 60 * 20;
const LIVE_PREVIEW_SIMILAR_PIXEL_RATIO_MIN = 0.45;
const LIVE_PREVIEW_SIMILAR_PIXEL_RATIO_MAX = 2.2;

const livePreviewOptimizationProfiles: Record<
  LivePreviewOptimizationLevel,
  {
    minPreviewScale: number;
    minSourceScale: number;
    maxStripSize: number;
    minShortSide: number;
    initialMaxSide: number;
    initialPixelBudgetSide: number;
    initialWaveStripSize: number;
    cacheReadyRatio: number;
    stableFpsFactor: number;
    adaptivePreviewScale: boolean;
    sourceProxyEnabled: boolean;
    stripSizeEnabled: boolean;
    frameCacheEnabled: boolean;
  }
> = {
  "super-fast": {
    minPreviewScale: 0.16,
    minSourceScale: 0.2,
    maxStripSize: 24,
    minShortSide: 200,
    initialMaxSide: 240,
    initialPixelBudgetSide: 220,
    initialWaveStripSize: 8,
    cacheReadyRatio: 0.75,
    stableFpsFactor: 0.9,
    adaptivePreviewScale: true,
    sourceProxyEnabled: true,
    stripSizeEnabled: true,
    frameCacheEnabled: true
  },
  fast: {
    minPreviewScale: 0.25,
    minSourceScale: 0.25,
    maxStripSize: 12,
    minShortSide: 280,
    initialMaxSide: 420,
    initialPixelBudgetSide: 360,
    initialWaveStripSize: 2,
    cacheReadyRatio: 0.6,
    stableFpsFactor: 0.82,
    adaptivePreviewScale: true,
    sourceProxyEnabled: true,
    stripSizeEnabled: true,
    frameCacheEnabled: true
  },
  balanced: {
    minPreviewScale: 0.33,
    minSourceScale: 0.33,
    maxStripSize: 8,
    minShortSide: 360,
    initialMaxSide: 620,
    initialPixelBudgetSide: 540,
    initialWaveStripSize: 2,
    cacheReadyRatio: LIVE_PREVIEW_DEFAULT_READY_CACHE_RATIO,
    stableFpsFactor: 0.78,
    adaptivePreviewScale: true,
    sourceProxyEnabled: true,
    stripSizeEnabled: true,
    frameCacheEnabled: true
  },
  high: {
    minPreviewScale: 0.5,
    minSourceScale: 0.5,
    maxStripSize: 4,
    minShortSide: 560,
    initialMaxSide: 900,
    initialPixelBudgetSide: 810,
    initialWaveStripSize: 1,
    cacheReadyRatio: 0.25,
    stableFpsFactor: 0.55,
    adaptivePreviewScale: true,
    sourceProxyEnabled: true,
    stripSizeEnabled: true,
    frameCacheEnabled: true
  },
  off: {
    minPreviewScale: 1,
    minSourceScale: 1,
    maxStripSize: 1,
    minShortSide: 0,
    initialMaxSide: Number.POSITIVE_INFINITY,
    initialPixelBudgetSide: Number.POSITIVE_INFINITY,
    initialWaveStripSize: 1,
    cacheReadyRatio: 0,
    stableFpsFactor: 0,
    adaptivePreviewScale: false,
    sourceProxyEnabled: false,
    stripSizeEnabled: false,
    frameCacheEnabled: true
  }
};

const normalizeLivePreviewOptimizationLevel = (
  level: LivePreviewOptimizationLevel | "speed" | "sharp" | null | undefined
): LivePreviewOptimizationLevel =>
  level === "super-fast"
    ? "super-fast"
    : level === "fast" || level === "speed"
      ? "fast"
      : level === "balanced"
        ? "balanced"
        : level === "high" || level === "sharp"
          ? "high"
          : level === "off"
            ? "off"
            : "balanced";

const getLivePreviewOptimizationProfile = (level: LivePreviewOptimizationLevel | null | undefined) =>
  livePreviewOptimizationProfiles[normalizeLivePreviewOptimizationLevel(level)];

interface LivePreviewScaleState {
  resetKey: string;
  scaleIndex: number;
  sourceScaleIndex: number;
  stripSizeIndex: number;
  slowWindows: number;
  healthyWindows: number;
  lastScaleChangedAt: number;
  lastSettingsChangedAt: number;
  transitionUntil: number;
  transitionReason: "optimizing" | "updating" | null;
}

interface LivePreviewPerformance {
  targetFps: number;
  previewScale: number;
  previewWidth: number;
  previewHeight: number;
  outputWidth: number;
  outputHeight: number;
  sourceScale: number;
  proxySourceWidth: number;
  proxySourceHeight: number;
  stripSize: number;
}

interface StableLivePreviewProfile {
  optimizationLevel: LivePreviewOptimizationLevel;
  scaleIndex: number;
  sourceScaleIndex: number;
  stripSizeIndex: number;
  previewScale: number;
  sourceScale: number;
  stripSize: number;
  actualFps: number;
  targetFps: number;
  averageRenderMs: number;
  outputWidth: number;
  outputHeight: number;
  sourceWidth: number;
  sourceHeight: number;
  updatedAt: number;
}

let lastStableLivePreviewProfile: StableLivePreviewProfile | null = null;

const createPreviewGeometryKey = (
  baseGrid: RenderGrid,
  ascii: AsciiSettings,
  animation: AnimationSettings,
  optimizationLevel: LivePreviewOptimizationLevel
) =>
  [
    baseGrid.columns,
    baseGrid.rows,
    Math.round(baseGrid.width),
    Math.round(baseGrid.height),
    Math.round(baseGrid.cellWidth * 1000) / 1000,
    Math.round(baseGrid.cellHeight * 1000) / 1000,
    Math.round(baseGrid.gapX * 1000) / 1000,
    Math.round(baseGrid.gapY * 1000) / 1000,
    baseGrid.sourceWidth,
    baseGrid.sourceHeight,
    ascii.glyphMode,
    ascii.charset,
    ascii.characterDensity,
    ascii.renderResolution,
    ascii.characterScale,
    ascii.spacingX,
    ascii.spacingY,
    ascii.cellSpacing,
    animation.type,
    animation.fps,
    normalizeLivePreviewOptimizationLevel(optimizationLevel)
  ].join(":");

const createPreviewVisualKey = (
  font: FontSettings,
  ascii: AsciiSettings,
  image: ImageSettings,
  frame: FrameSettings,
  breakup: BreakupSettings,
  color: ColorSettings,
  animation: AnimationSettings
) =>
  JSON.stringify({
    font,
    ascii: {
      ...ascii,
      imageGlyphs: ascii.imageGlyphs.map((glyph) => ({
        id: glyph.id,
        name: glyph.name,
        mimeType: glyph.mimeType
      }))
    },
    image,
    frame,
    breakup,
    color,
    animation
  });

const createInitialScaleState = (resetKey = "", now = 0): LivePreviewScaleState => ({
  resetKey,
  scaleIndex: 0,
  sourceScaleIndex: 0,
  stripSizeIndex: 0,
  slowWindows: 0,
  healthyWindows: 0,
  lastScaleChangedAt: 0,
  lastSettingsChangedAt: now,
  transitionUntil: 0,
  transitionReason: null
});

const resolveScaleIndexForScale = (
  baseGrid: RenderGrid,
  desiredScale: number,
  optimizationLevel: LivePreviewOptimizationLevel
) => {
  const allowedScales = getAllowedScaleStops(baseGrid, optimizationLevel);
  const clampedScale = Math.min(1, Math.max(0.05, desiredScale));
  const exactIndex = allowedScales.findIndex((scale) => Math.abs(scale - clampedScale) < 0.001);
  if (exactIndex >= 0) {
    return exactIndex;
  }
  const lowerOrEqualIndex = allowedScales.findIndex((scale) => scale <= clampedScale + 0.001);
  return lowerOrEqualIndex >= 0 ? lowerOrEqualIndex : allowedScales.length - 1;
};

const resolveStopIndexForValue = <T extends readonly number[]>(stops: T, desiredValue: number) => {
  const exactIndex = stops.findIndex((value) => Math.abs(value - desiredValue) < 0.001);
  if (exactIndex >= 0) {
    return exactIndex;
  }
  const lowerOrEqualIndex = stops.findIndex((value) => value <= desiredValue + 0.001);
  return lowerOrEqualIndex >= 0 ? lowerOrEqualIndex : stops.length - 1;
};

const getAllowedSourceScaleStops = (optimizationLevel: LivePreviewOptimizationLevel) => {
  const profile = getLivePreviewOptimizationProfile(optimizationLevel);
  if (!profile.sourceProxyEnabled) {
    return [1];
  }
  const allowed = LIVE_PREVIEW_SOURCE_SCALE_STOPS.filter((scale) => scale >= profile.minSourceScale);
  return allowed.length ? allowed : [1];
};

const getAllowedStripSizeStops = (optimizationLevel: LivePreviewOptimizationLevel) => {
  const profile = getLivePreviewOptimizationProfile(optimizationLevel);
  if (!profile.stripSizeEnabled) {
    return [1];
  }
  const allowed = LIVE_PREVIEW_STRIP_SIZE_STOPS.filter((stripSize) => stripSize <= profile.maxStripSize);
  return allowed.length ? allowed : [1];
};

export const estimateInitialLivePreviewScale = (
  outputWidth: number,
  outputHeight: number,
  targetFps: number,
  optimizationLevel: LivePreviewOptimizationLevel = "balanced"
) => {
  const width = Math.max(1, Math.round(outputWidth));
  const height = Math.max(1, Math.round(outputHeight));
  const fps = normalizeAnimationFps(targetFps);
  const profile = getLivePreviewOptimizationProfile(optimizationLevel);
  if (!profile.adaptivePreviewScale) {
    return 1;
  }
  const fpsScale =
    fps >= 50
      ? 0.78
      : fps >= 30
        ? 0.88
        : fps >= 24
          ? 1
          : 1.15;
  const maxSide = profile.initialMaxSide * fpsScale;
  const pixelBudgetSide = profile.initialPixelBudgetSide * fpsScale;
  const pixelBudget = pixelBudgetSide * pixelBudgetSide;
  return Math.min(
    1,
    Math.max(
      profile.minPreviewScale,
      Math.min(
        maxSide / Math.max(width, height),
        Math.sqrt(pixelBudget / Math.max(1, width * height))
      )
    )
  );
};

const createEstimatedScaleState = (
  resetKey: string,
  baseGrid: RenderGrid,
  animation: AnimationSettings,
  sourceImageData: ImageData | null | undefined,
  now: number,
  optimizationLevel: LivePreviewOptimizationLevel
): LivePreviewScaleState => {
  const outputWidth = Math.max(1, Math.round(baseGrid.width));
  const outputHeight = Math.max(1, Math.round(baseGrid.height));
  const sourceWidth = Math.max(1, Math.round(sourceImageData?.width ?? baseGrid.sourceWidth));
  const sourceHeight = Math.max(1, Math.round(sourceImageData?.height ?? baseGrid.sourceHeight));
  const targetFps = normalizeAnimationFps(animation.fps);
  const previous = lastStableLivePreviewProfile;
  const previousStillFresh =
    previous &&
    previous.optimizationLevel === normalizeLivePreviewOptimizationLevel(optimizationLevel) &&
    now - previous.updatedAt <= LIVE_PREVIEW_STABLE_PROFILE_TTL_MS &&
    Math.abs(previous.targetFps - targetFps) <= Math.max(2, targetFps * 0.15);
  const currentPixels = outputWidth * outputHeight;
  const previousPixels = Math.max(1, (previous?.outputWidth ?? outputWidth) * (previous?.outputHeight ?? outputHeight));
  const pixelRatio = currentPixels / previousPixels;
  const sourcePixels = sourceWidth * sourceHeight;
  const previousSourcePixels = Math.max(1, (previous?.sourceWidth ?? sourceWidth) * (previous?.sourceHeight ?? sourceHeight));
  const sourcePixelRatio = sourcePixels / previousSourcePixels;
  let desiredPreviewScale = estimateInitialLivePreviewScale(outputWidth, outputHeight, targetFps, optimizationLevel);
  const allowedSourceScaleStops = getAllowedSourceScaleStops(optimizationLevel);
  const allowedStripSizeStops = getAllowedStripSizeStops(optimizationLevel);
  const optimizationProfile = getLivePreviewOptimizationProfile(optimizationLevel);
  let sourceScaleIndex = optimizationProfile.sourceProxyEnabled
    ? resolveStopIndexForValue(
        allowedSourceScaleStops,
        Math.min(1, Math.max(optimizationProfile.minSourceScale, desiredPreviewScale))
      )
    : 0;
  let stripSizeIndex =
    optimizationProfile.stripSizeEnabled && animation.type === "wave" && targetFps >= 24
      ? resolveStopIndexForValue(allowedStripSizeStops, optimizationProfile.initialWaveStripSize)
      : 0;

  if (
    previousStillFresh &&
    previous &&
    pixelRatio >= LIVE_PREVIEW_SIMILAR_PIXEL_RATIO_MIN &&
    pixelRatio <= LIVE_PREVIEW_SIMILAR_PIXEL_RATIO_MAX &&
    sourcePixelRatio >= LIVE_PREVIEW_SIMILAR_PIXEL_RATIO_MIN &&
    sourcePixelRatio <= LIVE_PREVIEW_SIMILAR_PIXEL_RATIO_MAX
  ) {
    desiredPreviewScale = previous.previewScale * Math.sqrt(previousPixels / currentPixels);
    sourceScaleIndex = previous.sourceScaleIndex;
    stripSizeIndex = animation.type === "wave" ? previous.stripSizeIndex : 0;
  }

  return {
    resetKey,
    scaleIndex: resolveScaleIndexForScale(baseGrid, desiredPreviewScale, optimizationLevel),
    sourceScaleIndex: Math.min(sourceScaleIndex, allowedSourceScaleStops.length - 1),
    stripSizeIndex: Math.min(stripSizeIndex, allowedStripSizeStops.length - 1),
    slowWindows: 0,
    healthyWindows: 0,
    lastScaleChangedAt: now,
    lastSettingsChangedAt: now,
    transitionUntil: now + LIVE_PREVIEW_EDIT_SETTLE_MS,
    transitionReason: "optimizing"
  };
};

const warmStartScaleState = (
  resetKey: string,
  previous: LivePreviewScaleState,
  baseGrid: RenderGrid,
  now: number,
  optimizationLevel: LivePreviewOptimizationLevel
): LivePreviewScaleState => {
  const allowedScales = getAllowedScaleStops(baseGrid, optimizationLevel);
  const allowedSourceScaleStops = getAllowedSourceScaleStops(optimizationLevel);
  const allowedStripSizeStops = getAllowedStripSizeStops(optimizationLevel);
  return {
    resetKey,
    scaleIndex: Math.min(previous.scaleIndex, allowedScales.length - 1),
    sourceScaleIndex: Math.min(previous.sourceScaleIndex, allowedSourceScaleStops.length - 1),
    stripSizeIndex: Math.min(previous.stripSizeIndex, allowedStripSizeStops.length - 1),
    slowWindows: 0,
    healthyWindows: 0,
    lastScaleChangedAt: previous.lastScaleChangedAt,
    lastSettingsChangedAt: now,
    transitionUntil: now + LIVE_PREVIEW_EDIT_SETTLE_MS,
    transitionReason: "optimizing"
  };
};

const getAllowedScaleStops = (
  baseGrid: RenderGrid,
  optimizationLevel: LivePreviewOptimizationLevel
) => {
  const outputWidth = Math.max(1, Math.round(baseGrid.width));
  const outputHeight = Math.max(1, Math.round(baseGrid.height));
  const shortSide = Math.min(outputWidth, outputHeight);
  const profile = getLivePreviewOptimizationProfile(optimizationLevel);
  if (!profile.adaptivePreviewScale) {
    return [1];
  }
  const minimumShortSide = Math.min(shortSide, profile.minShortSide);
  const allowed = LIVE_PREVIEW_SCALE_STOPS.filter(
    (scale) =>
      (scale >= profile.minPreviewScale && shortSide * scale >= minimumShortSide) ||
      Math.abs(scale - 1) < 0.001
  );
  return allowed.length ? allowed : [1];
};

const resolveLivePreviewPerformance = (
  baseGrid: RenderGrid,
  animation: AnimationSettings,
  scaleState: LivePreviewScaleState,
  optimizationLevel: LivePreviewOptimizationLevel
): LivePreviewPerformance => {
  const outputWidth = Math.max(1, Math.round(baseGrid.width));
  const outputHeight = Math.max(1, Math.round(baseGrid.height));
  const allowedScales = getAllowedScaleStops(baseGrid, optimizationLevel);
  const allowedSourceScaleStops = getAllowedSourceScaleStops(optimizationLevel);
  const allowedStripSizeStops = getAllowedStripSizeStops(optimizationLevel);
  const previewScale = allowedScales[Math.min(scaleState.scaleIndex, allowedScales.length - 1)] ?? 1;
  const sourceScale =
    allowedSourceScaleStops[
      Math.min(scaleState.sourceScaleIndex, allowedSourceScaleStops.length - 1)
    ] ?? 1;
  const stripSize =
    animation.type === "wave"
      ? allowedStripSizeStops[
          Math.min(scaleState.stripSizeIndex, allowedStripSizeStops.length - 1)
        ] ?? 1
      : 1;
  return {
    targetFps: normalizeAnimationFps(animation.fps),
    previewScale,
    previewWidth: Math.max(1, Math.round(outputWidth * previewScale)),
    previewHeight: Math.max(1, Math.round(outputHeight * previewScale)),
    outputWidth,
    outputHeight,
    sourceScale,
    proxySourceWidth: Math.max(1, Math.round(baseGrid.sourceWidth * sourceScale)),
    proxySourceHeight: Math.max(1, Math.round(baseGrid.sourceHeight * sourceScale)),
    stripSize
  };
};

const createLivePreviewStats = (
  phase: LivePreviewStats["phase"],
  performanceProfile: LivePreviewPerformance,
  values: Partial<
    Pick<
      LivePreviewStats,
      | "actualFps"
      | "averageRenderMs"
      | "droppedFrames"
      | "isSlow"
      | "cacheEnabled"
      | "cacheFrames"
      | "cacheFrameCount"
      | "cacheComplete"
    >
  > = {}
): LivePreviewStats => ({
  phase,
  targetFps: performanceProfile.targetFps,
  actualFps: values.actualFps ?? 0,
  averageRenderMs: values.averageRenderMs ?? 0,
  droppedFrames: values.droppedFrames ?? 0,
  isSlow: values.isSlow ?? false,
  previewScale: performanceProfile.previewScale,
  previewWidth: performanceProfile.previewWidth,
  previewHeight: performanceProfile.previewHeight,
  outputWidth: performanceProfile.outputWidth,
  outputHeight: performanceProfile.outputHeight,
  sourceScale: performanceProfile.sourceScale,
  proxySourceWidth: performanceProfile.proxySourceWidth,
  proxySourceHeight: performanceProfile.proxySourceHeight,
  stripSize: performanceProfile.stripSize,
  cacheEnabled: values.cacheEnabled ?? false,
  cacheFrames: values.cacheFrames ?? 0,
  cacheFrameCount: values.cacheFrameCount ?? 0,
  cacheComplete: values.cacheComplete ?? false
});

const rememberStableLivePreviewProfile = (
  scaleState: LivePreviewScaleState,
  profile: LivePreviewPerformance,
  optimizationLevel: LivePreviewOptimizationLevel,
  sourceWidth: number,
  sourceHeight: number,
  actualFps: number,
  averageRenderMs: number,
  now: number
) => {
  const optimizationProfile = getLivePreviewOptimizationProfile(optimizationLevel);
  if (
    actualFps < profile.targetFps * optimizationProfile.stableFpsFactor ||
    profile.targetFps - actualFps > Math.max(2, profile.targetFps * (1 - optimizationProfile.stableFpsFactor))
  ) {
    return;
  }
  lastStableLivePreviewProfile = {
    optimizationLevel: normalizeLivePreviewOptimizationLevel(optimizationLevel),
    scaleIndex: scaleState.scaleIndex,
    sourceScaleIndex: scaleState.sourceScaleIndex,
    stripSizeIndex: scaleState.stripSizeIndex,
    previewScale: profile.previewScale,
    sourceScale: profile.sourceScale,
    stripSize: profile.stripSize,
    actualFps,
    targetFps: profile.targetFps,
    averageRenderMs,
    outputWidth: profile.outputWidth,
    outputHeight: profile.outputHeight,
    sourceWidth: Math.max(1, Math.round(sourceWidth)),
    sourceHeight: Math.max(1, Math.round(sourceHeight)),
    updatedAt: now
  };
};

const isLivePreviewCacheReadyForDisplay = (
  metadata: LivePreviewFrameCacheMetadata | null,
  optimizationLevel: LivePreviewOptimizationLevel
) => {
  if (!metadata?.enabled) {
    return true;
  }
  if (metadata.complete) {
    return true;
  }
  const frameCount = Math.max(1, metadata.frameCount);
  const optimizationProfile = getLivePreviewOptimizationProfile(optimizationLevel);
  if (optimizationProfile.cacheReadyRatio <= 0) {
    return true;
  }
  const minimumFrames =
    frameCount <= LIVE_PREVIEW_SHORT_LOOP_CACHE_FRAME_LIMIT
      ? frameCount
      : Math.max(2, Math.ceil(frameCount * optimizationProfile.cacheReadyRatio));
  return metadata.cachedFrames >= minimumFrames;
};

const adaptLivePreviewScale = (
  baseGrid: RenderGrid,
  scaleState: LivePreviewScaleState,
  targetFps: number,
  actualFps: number,
  averageRenderMs: number,
  canUseSourceProxy: boolean,
  canUseStripSize: boolean,
  now: number,
  optimizationLevel: LivePreviewOptimizationLevel
): boolean => {
  const allowedScales = getAllowedScaleStops(baseGrid, optimizationLevel);
  const allowedSourceScaleStops = getAllowedSourceScaleStops(optimizationLevel);
  const allowedStripSizeStops = getAllowedStripSizeStops(optimizationLevel);
  const frameBudgetMs = 1000 / Math.max(1, targetFps);
  const canAdjust = now - scaleState.lastScaleChangedAt >= LIVE_PREVIEW_SCALE_COOLDOWN_MS;
  const optimizationProfile = getLivePreviewOptimizationProfile(optimizationLevel);
  if (
    !optimizationProfile.adaptivePreviewScale &&
    !optimizationProfile.sourceProxyEnabled &&
    !optimizationProfile.stripSizeEnabled
  ) {
    scaleState.slowWindows = 0;
    scaleState.healthyWindows = 0;
    return false;
  }
  const isFarBelowTarget =
    actualFps < targetFps * optimizationProfile.stableFpsFactor &&
    targetFps - actualFps > Math.max(1, targetFps * (1 - optimizationProfile.stableFpsFactor) * 0.5);
  const isHealthy = actualFps > targetFps * 0.9 && averageRenderMs < frameBudgetMs * 0.65;

  if (isFarBelowTarget) {
    scaleState.slowWindows += 1;
    scaleState.healthyWindows = 0;
  } else if (isHealthy) {
    scaleState.healthyWindows += 1;
    scaleState.slowWindows = 0;
  } else {
    scaleState.slowWindows = 0;
    scaleState.healthyWindows = 0;
  }

  if (
    canAdjust &&
    scaleState.slowWindows >= 2 &&
    optimizationProfile.stripSizeEnabled &&
    canUseStripSize &&
    scaleState.stripSizeIndex < allowedStripSizeStops.length - 1
  ) {
    scaleState.stripSizeIndex += 1;
    scaleState.slowWindows = 0;
    scaleState.healthyWindows = 0;
    scaleState.lastScaleChangedAt = now;
    scaleState.transitionUntil = now + LIVE_PREVIEW_EDIT_SETTLE_MS;
    scaleState.transitionReason = "optimizing";
    return true;
  }

  if (
    canAdjust &&
    scaleState.slowWindows >= 2 &&
    optimizationProfile.sourceProxyEnabled &&
    canUseSourceProxy &&
    scaleState.sourceScaleIndex < allowedSourceScaleStops.length - 1
  ) {
    scaleState.sourceScaleIndex += 1;
    scaleState.slowWindows = 0;
    scaleState.healthyWindows = 0;
    scaleState.lastScaleChangedAt = now;
    scaleState.transitionUntil = now + LIVE_PREVIEW_EDIT_SETTLE_MS;
    scaleState.transitionReason = "optimizing";
    return true;
  }

  if (
    canAdjust &&
    scaleState.slowWindows >= 2 &&
    optimizationProfile.adaptivePreviewScale &&
    scaleState.scaleIndex < allowedScales.length - 1
  ) {
    scaleState.scaleIndex += 1;
    scaleState.slowWindows = 0;
    scaleState.healthyWindows = 0;
    scaleState.lastScaleChangedAt = now;
    scaleState.transitionUntil = now + LIVE_PREVIEW_EDIT_SETTLE_MS;
    scaleState.transitionReason = "optimizing";
    return true;
  }

  return false;
};

const createScaledAtlasKey = (
  font: FontSettings,
  ascii: AsciiSettings,
  cellWidth: number,
  cellHeight: number
) =>
  [
    normalizeCharacterSet(ascii.charset),
    font.family,
    font.weight,
    font.lineHeight,
    font.letterSpacing,
    ascii.renderResolution,
    ascii.characterScale,
    cellWidth.toFixed(3),
    cellHeight.toFixed(3)
  ].join(":");

const preparePreviewCanvas = (
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  displayWidth = width,
  displayHeight = height
) => {
  if (canvas.width !== width) {
    canvas.width = width;
  }
  if (canvas.height !== height) {
    canvas.height = height;
  }
  canvas.style.width = `${displayWidth}px`;
  canvas.style.height = `${displayHeight}px`;
};

const copyPreviewCanvasFrame = (
  targetCanvas: HTMLCanvasElement,
  sourceCanvas: CanvasImageSource,
  width: number,
  height: number,
  displayWidth: number,
  displayHeight: number
) => {
  preparePreviewCanvas(targetCanvas, width, height, displayWidth, displayHeight);
  const context = targetCanvas.getContext("2d", { alpha: true });
  if (!context) {
    return;
  }
  context.clearRect(0, 0, width, height);
  context.globalAlpha = 1;
  context.globalCompositeOperation = "source-over";
  context.imageSmoothingEnabled = false;
  context.drawImage(sourceCanvas, 0, 0, width, height);
};

export const useAnimatedAsciiPreview = ({
  active,
  paused = false,
  editPreviewActive = false,
  renderer,
  sourceImageData = null,
  backgroundCanvasRef,
  glyphCanvasRef,
  baseGrid,
  atlas,
  imageGlyphAtlas,
  font,
  ascii,
  image,
  frame,
  breakup,
  color,
  animation,
  optimizationLevel = "balanced",
  glyphMetrics,
  onPerformanceWarning,
  onLivePreviewStats
}: AnimatedAsciiPreviewArgs) => {
  const livePreviewOptimizationLevel = normalizeLivePreviewOptimizationLevel(optimizationLevel);
  const latestRef = useRef({
    baseGrid,
    atlas,
    imageGlyphAtlas,
    editPreviewActive,
    sourceImageData,
    font,
    ascii,
    image,
    frame,
    breakup,
    color,
    animation,
    optimizationLevel: livePreviewOptimizationLevel,
    glyphMetrics,
    onPerformanceWarning,
    onLivePreviewStats
  });
  const clockRef = useRef<{
    startedAt: number;
    renderer: AnimatedImageRenderer | null;
    type: AnimationSettings["type"] | null;
    key: string;
  }>({
    startedAt: 0,
    renderer: null,
    type: null,
    key: ""
  });
  const wasActiveRef = useRef(false);
  const echoHistoryRef = useRef(createEchoFrameHistory());
  const temporaryBackgroundCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const temporaryGlyphCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const temporaryEchoCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pauseStartedAtRef = useRef<number | null>(null);
  const scaleStateRef = useRef<LivePreviewScaleState>(createInitialScaleState());
  const scaledAtlasRef = useRef<{ key: string; atlas: GlyphAtlas | null }>({ key: "", atlas: null });
  const visualKeyRef = useRef("");
  const sourceVersionRef = useRef(0);
  const sourceStateRef = useRef<{ source: ImageData | null; width: number; height: number; version: number } | null>(null);
  const frameCacheRef = useRef(new LivePreviewFrameCache());
  const displayReadyRef = useRef(false);
  const proxyRendererRef = useRef<{
    source: ImageData;
    sourceScale: number;
    stripSize: number;
    renderer: AnimatedImageRenderer;
    width: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    latestRef.current = {
      baseGrid,
      atlas,
      imageGlyphAtlas,
      editPreviewActive,
      sourceImageData,
      font,
      ascii,
      image,
      frame,
      breakup,
      color,
      animation,
      optimizationLevel: livePreviewOptimizationLevel,
      glyphMetrics,
      onPerformanceWarning,
      onLivePreviewStats
    };
  }, [
    baseGrid,
    atlas,
    imageGlyphAtlas,
    editPreviewActive,
    sourceImageData,
    font,
    ascii,
    image,
    frame,
    breakup,
    color,
    animation,
    livePreviewOptimizationLevel,
    glyphMetrics,
    onPerformanceWarning,
    onLivePreviewStats
  ]);

  useEffect(() => {
    if (!active) {
      wasActiveRef.current = false;
      pauseStartedAtRef.current = null;
      scaleStateRef.current = createInitialScaleState();
      scaledAtlasRef.current = { key: "", atlas: null };
      visualKeyRef.current = "";
      sourceStateRef.current = null;
      proxyRendererRef.current = null;
      frameCacheRef.current.clear();
      displayReadyRef.current = false;
      clearLivePreviewSourceProxyCache();
      resetEchoFrameHistory(echoHistoryRef.current);
      latestRef.current.onLivePreviewStats?.(null);
      return;
    }
    if (paused || editPreviewActive) {
      if (pauseStartedAtRef.current === null) {
        pauseStartedAtRef.current = performance.now();
      }
      return;
    }
    if (pauseStartedAtRef.current !== null) {
      clockRef.current.startedAt += performance.now() - pauseStartedAtRef.current;
      pauseStartedAtRef.current = null;
    }
    const clockKey = createPreviewClockKey(animation);
    if (
      !wasActiveRef.current ||
      clockRef.current.renderer !== renderer ||
      clockRef.current.type !== animation.type ||
      clockRef.current.key !== clockKey
    ) {
      clockRef.current = {
        startedAt: performance.now(),
        renderer,
        type: animation.type,
        key: clockKey
      };
      resetEchoFrameHistory(echoHistoryRef.current);
    }
    wasActiveRef.current = true;
  }, [
    active,
    paused,
    editPreviewActive,
    renderer,
    animation.type,
    animation.fps
  ]);

  useEffect(() => {
    const backgroundCanvas = backgroundCanvasRef.current;
    const glyphCanvas = glyphCanvasRef.current;

    if (!active || (paused && !editPreviewActive) || !renderer || !backgroundCanvas || !glyphCanvas) {
      return undefined;
    }

    let frameHandle = 0;
    let cancelled = false;
    let renderedFrames = 0;
    let accumulatedRenderMs = 0;
    let warned = false;
    let lastRenderedPreviewFrameIndex = -1;
    let statsStartedAt = performance.now();
    let statsRenderedFrames = 0;
    let statsAccumulatedRenderMs = 0;
    let statsDroppedFrames = 0;
    if (!clockRef.current.startedAt) {
      clockRef.current.startedAt = performance.now();
    }

    const temporaryBackgroundCanvas = temporaryBackgroundCanvasRef.current ?? document.createElement("canvas");
    const temporaryGlyphCanvas = temporaryGlyphCanvasRef.current ?? document.createElement("canvas");
    const temporaryEchoCanvas = temporaryEchoCanvasRef.current ?? document.createElement("canvas");
    temporaryBackgroundCanvasRef.current = temporaryBackgroundCanvas;
    temporaryGlyphCanvasRef.current = temporaryGlyphCanvas;
    temporaryEchoCanvasRef.current = temporaryEchoCanvas;

    const bootstrapLatest = latestRef.current;
    if (bootstrapLatest.baseGrid) {
      const resetKey = createPreviewGeometryKey(
        bootstrapLatest.baseGrid,
        bootstrapLatest.ascii,
        bootstrapLatest.animation,
        bootstrapLatest.optimizationLevel
      );
      if (scaleStateRef.current.resetKey !== resetKey) {
        scaleStateRef.current = createEstimatedScaleState(
          resetKey,
          bootstrapLatest.baseGrid,
          bootstrapLatest.animation,
          bootstrapLatest.sourceImageData,
          performance.now(),
          bootstrapLatest.optimizationLevel
        );
      }
      bootstrapLatest.onLivePreviewStats?.(
        createLivePreviewStats(
          bootstrapLatest.editPreviewActive || scaleStateRef.current.transitionReason === "updating"
            ? "updating"
            : "optimizing",
          resolveLivePreviewPerformance(
            bootstrapLatest.baseGrid,
            bootstrapLatest.animation,
            scaleStateRef.current,
            bootstrapLatest.optimizationLevel
          )
        )
      );
    }

    const renderFrame = (now: number) => {
      if (cancelled) {
        return;
      }

      const renderStartedAt = performance.now();
      try {
        const latest = latestRef.current;
        if (!latest.baseGrid || !latest.atlas || !latest.glyphMetrics.length) {
          frameHandle = window.requestAnimationFrame(renderFrame);
          return;
        }
        const clockKey = createPreviewClockKey(latest.animation);
        if (clockRef.current.renderer !== renderer || clockRef.current.key !== clockKey) {
          clockRef.current = {
            startedAt: now,
            renderer,
            type: latest.animation.type,
            key: clockKey
          };
          lastRenderedPreviewFrameIndex = -1;
          displayReadyRef.current = false;
          statsStartedAt = now;
          statsRenderedFrames = 0;
          statsAccumulatedRenderMs = 0;
          statsDroppedFrames = 0;
          resetEchoFrameHistory(echoHistoryRef.current);
        }

        const elapsedSeconds = (now - clockRef.current.startedAt) / 1000;
        const sourceWidth = latest.sourceImageData?.width ?? 0;
        const sourceHeight = latest.sourceImageData?.height ?? 0;
        const resetKey = createPreviewGeometryKey(
          latest.baseGrid,
          latest.ascii,
          latest.animation,
          latest.optimizationLevel
        );
        const previousSourceState = sourceStateRef.current;
        const sourceChanged =
          !previousSourceState ||
          previousSourceState.source !== latest.sourceImageData ||
          previousSourceState.width !== sourceWidth ||
          previousSourceState.height !== sourceHeight;
        const geometryChanged = scaleStateRef.current.resetKey !== resetKey;
        if (sourceChanged) {
          if (previousSourceState?.source) {
            clearLivePreviewSourceProxyCache(previousSourceState.source);
          }
          sourceVersionRef.current += 1;
          sourceStateRef.current = {
            source: latest.sourceImageData,
            width: sourceWidth,
            height: sourceHeight,
            version: sourceVersionRef.current
          };
          proxyRendererRef.current = null;
          frameCacheRef.current.clear();
          displayReadyRef.current = false;
          scaleStateRef.current = createEstimatedScaleState(
            resetKey,
            latest.baseGrid,
            latest.animation,
            latest.sourceImageData,
            now,
            latest.optimizationLevel
          );
          lastRenderedPreviewFrameIndex = -1;
          resetEchoFrameHistory(echoHistoryRef.current);
        }

        if (!sourceChanged && geometryChanged) {
          const previousScaleState = scaleStateRef.current;
          scaleStateRef.current = previousScaleState.resetKey
            ? warmStartScaleState(resetKey, previousScaleState, latest.baseGrid, now, latest.optimizationLevel)
            : createEstimatedScaleState(
                resetKey,
                latest.baseGrid,
                latest.animation,
                latest.sourceImageData,
                now,
                latest.optimizationLevel
              );
          proxyRendererRef.current = null;
          frameCacheRef.current.clear();
          scaledAtlasRef.current = { key: "", atlas: null };
          statsStartedAt = now;
          statsRenderedFrames = 0;
          statsAccumulatedRenderMs = 0;
          statsDroppedFrames = 0;
          lastRenderedPreviewFrameIndex = -1;
          displayReadyRef.current = false;
          resetEchoFrameHistory(echoHistoryRef.current);
        }

        const visualKey = createPreviewVisualKey(
          latest.font,
          latest.ascii,
          latest.image,
          latest.frame,
          latest.breakup,
          latest.color,
          latest.animation
        );
        if (visualKeyRef.current !== visualKey) {
          const hadVisualKey = Boolean(visualKeyRef.current);
          visualKeyRef.current = visualKey;
          scaleStateRef.current.lastSettingsChangedAt = now;
          scaleStateRef.current.slowWindows = 0;
          scaleStateRef.current.healthyWindows = 0;
          if (hadVisualKey) {
            scaleStateRef.current.transitionUntil = now + LIVE_PREVIEW_EDIT_SETTLE_MS;
            scaleStateRef.current.transitionReason = "updating";
          }
          lastRenderedPreviewFrameIndex = -1;
          displayReadyRef.current = false;
          resetEchoFrameHistory(echoHistoryRef.current);
        }

        const livePreview = resolveLivePreviewPerformance(
          latest.baseGrid,
          latest.animation,
          scaleStateRef.current,
          latest.optimizationLevel
        );
        const activeTransition =
          latest.editPreviewActive
            ? "updating"
            : scaleStateRef.current.transitionReason && now < scaleStateRef.current.transitionUntil
              ? scaleStateRef.current.transitionReason
              : null;
        if (!activeTransition) {
          scaleStateRef.current.transitionReason = null;
        }
        if (activeTransition === "updating") {
          latest.onLivePreviewStats?.(createLivePreviewStats("updating", livePreview));
          frameHandle = window.requestAnimationFrame(renderFrame);
          return;
        }
        const previewFrameIndex = Math.floor(elapsedSeconds * livePreview.targetFps);
        const cacheFrameCount = resolveAnimationFrameCount(latest.animation.loopDuration, livePreview.targetFps);
        const cacheFrameIndex = ((previewFrameIndex % cacheFrameCount) + cacheFrameCount) % cacheFrameCount;
        const optimizationProfile = getLivePreviewOptimizationProfile(latest.optimizationLevel);
        const cacheEnabled =
          optimizationProfile.frameCacheEnabled && cacheFrameCount > 1 && !isEchoActive(latest.animation);
        const cacheKey = createLivePreviewFrameCacheKey({
          sourceVersion: sourceStateRef.current?.version ?? sourceVersionRef.current,
          sourceWidth,
          sourceHeight,
          geometryKey: resetKey,
          visualKey,
          fps: livePreview.targetFps,
          loopDuration: latest.animation.loopDuration,
          previewWidth: livePreview.previewWidth,
          previewHeight: livePreview.previewHeight,
          outputWidth: livePreview.outputWidth,
          outputHeight: livePreview.outputHeight,
          previewScale: livePreview.previewScale,
          sourceScale: livePreview.sourceScale,
          stripSize: livePreview.stripSize,
          proxySourceWidth: livePreview.proxySourceWidth,
          proxySourceHeight: livePreview.proxySourceHeight,
          optimizationLevel: latest.optimizationLevel
        });
        const cacheMetadata = cacheEnabled
          ? frameCacheRef.current.setProfile({
              fps: livePreview.targetFps,
              frameCount: cacheFrameCount,
              width: livePreview.previewWidth,
              height: livePreview.previewHeight,
              previewScale: livePreview.previewScale,
              sourceScale: livePreview.sourceScale,
              stripSize: livePreview.stripSize,
              cacheKey
            })
          : null;
        if (!cacheEnabled && frameCacheRef.current.getMetadata()) {
          frameCacheRef.current.clear();
        }
        if (previewFrameIndex === lastRenderedPreviewFrameIndex) {
          frameHandle = window.requestAnimationFrame(renderFrame);
          return;
        }
        if (lastRenderedPreviewFrameIndex >= 0 && previewFrameIndex > lastRenderedPreviewFrameIndex + 1) {
          statsDroppedFrames += previewFrameIndex - lastRenderedPreviewFrameIndex - 1;
        }
        lastRenderedPreviewFrameIndex = previewFrameIndex;

        const timelineFrameIndex = cacheEnabled ? cacheFrameIndex : previewFrameIndex;
        const timeSeconds = timelineFrameIndex / livePreview.targetFps;
        const outputWidth = livePreview.previewWidth;
        const outputHeight = livePreview.previewHeight;
        const displayWidth = livePreview.previewWidth;
        const displayHeight = livePreview.previewHeight;
        const cachedFrame = cacheMetadata?.enabled ? frameCacheRef.current.getFrame(cacheFrameIndex) : null;
        if (cachedFrame) {
          resetEchoFrameHistory(echoHistoryRef.current);
          const readyToDisplay =
            displayReadyRef.current || isLivePreviewCacheReadyForDisplay(cacheMetadata, latest.optimizationLevel);
          displayReadyRef.current = readyToDisplay;
          if (readyToDisplay) {
            copyPreviewCanvasFrame(backgroundCanvas, cachedFrame.background, outputWidth, outputHeight, displayWidth, displayHeight);
            copyPreviewCanvasFrame(glyphCanvas, cachedFrame.glyph, outputWidth, outputHeight, displayWidth, displayHeight);
          }
        } else {
          let frameRenderer = renderer;
          if (
            optimizationProfile.sourceProxyEnabled &&
            latest.sourceImageData &&
            (livePreview.sourceScale < 0.999 || livePreview.stripSize > 1)
          ) {
            const cachedProxyRenderer = proxyRendererRef.current;
            if (
              !cachedProxyRenderer ||
              cachedProxyRenderer.source !== latest.sourceImageData ||
              Math.abs(cachedProxyRenderer.sourceScale - livePreview.sourceScale) > 0.001 ||
              cachedProxyRenderer.stripSize !== livePreview.stripSize
            ) {
              const proxySource = resolveLivePreviewSourceProxy(latest.sourceImageData, livePreview.sourceScale);
              proxyRendererRef.current = {
                source: latest.sourceImageData,
                sourceScale: proxySource.sourceScale,
                stripSize: livePreview.stripSize,
                renderer: createAnimatedImageRenderer(proxySource.imageData, {
                  stripSize: livePreview.stripSize
                }),
                width: proxySource.width,
                height: proxySource.height
              };
            }
            if (proxyRendererRef.current) {
              frameRenderer = proxyRendererRef.current.renderer;
            }
          }
          const imageData = frameRenderer.render(latest.animation, timeSeconds);
          const animatedSettings = resolveAnimatedProcessingSettings(
            latest.image,
            latest.frame,
            latest.breakup,
            latest.animation,
            timeSeconds
          );
          const scaledCellWidth = latest.baseGrid.cellWidth * livePreview.previewScale;
          const scaledCellHeight = latest.baseGrid.cellHeight * livePreview.previewScale;
          const scaledGapX = latest.baseGrid.gapX * livePreview.previewScale;
          const scaledGapY = latest.baseGrid.gapY * livePreview.previewScale;
          const baseOptions = {
            columns: latest.baseGrid.columns,
            rows: latest.baseGrid.rows,
            cellWidth: scaledCellWidth,
            cellHeight: scaledCellHeight,
            gapX: scaledGapX,
            gapY: scaledGapY,
            ascii: latest.ascii,
            color: latest.color,
            glyphMetrics: latest.glyphMetrics
          };
          const options: WorkerRenderOptions = {
            ...baseOptions,
            image: animatedSettings.image,
            frame: animatedSettings.frame,
            breakup: animatedSettings.breakup
          };
          const generatedGrid = generateRenderGrid(imageData, options);
          const animatedGrid: RenderGrid = {
            ...generatedGrid,
            width: livePreview.previewWidth,
            height: livePreview.previewHeight
          };
          let renderAtlas = latest.atlas;
          if (Math.abs(livePreview.previewScale - 1) >= 0.001) {
            const renderFont = scaleFontForRenderResolution(latest.font, latest.ascii.renderResolution);
            const scaledAtlasKey = createScaledAtlasKey(renderFont, latest.ascii, scaledCellWidth, scaledCellHeight);
            if (scaledAtlasRef.current.key !== scaledAtlasKey) {
              scaledAtlasRef.current = {
                key: scaledAtlasKey,
                atlas: createGlyphAtlas(
                  normalizeCharacterSet(latest.ascii.charset),
                  renderFont,
                  scaledCellWidth,
                  scaledCellHeight,
                  latest.ascii.characterScale
                )
              };
            }
            renderAtlas = scaledAtlasRef.current.atlas ?? latest.atlas;
          }
          renderAsciiLayers({
            backgroundCanvas: temporaryBackgroundCanvas,
            glyphCanvas: temporaryGlyphCanvas,
            grid: animatedGrid,
            atlas: renderAtlas,
            imageGlyphAtlas: latest.imageGlyphAtlas,
            font: latest.font,
            ascii: latest.ascii,
            color: latest.color,
            animation: latest.animation,
            animationTimeSeconds: timeSeconds,
            glyphMetrics: latest.glyphMetrics
          });

          if (isEchoActive(latest.animation)) {
            displayReadyRef.current = true;
            copyPreviewCanvasFrame(backgroundCanvas, temporaryBackgroundCanvas, outputWidth, outputHeight, displayWidth, displayHeight);
            compositeEchoFrame({
              targetCanvas: temporaryEchoCanvas,
              currentLayerCanvas: temporaryGlyphCanvas,
              history: echoHistoryRef.current,
              animation: latest.animation,
              binaryAlpha: latest.color.paletteMode === "single"
            });
            copyPreviewCanvasFrame(glyphCanvas, temporaryEchoCanvas, outputWidth, outputHeight, displayWidth, displayHeight);
            pushEchoFrame(echoHistoryRef.current, temporaryGlyphCanvas, latest.animation);
          } else {
            resetEchoFrameHistory(echoHistoryRef.current);
            if (cacheMetadata?.enabled) {
              frameCacheRef.current.storeFrame(cacheFrameIndex, temporaryBackgroundCanvas, temporaryGlyphCanvas);
            }
            const readyToDisplay =
              displayReadyRef.current ||
              isLivePreviewCacheReadyForDisplay(
                frameCacheRef.current.getMetadata() ?? cacheMetadata,
                latest.optimizationLevel
              );
            displayReadyRef.current = readyToDisplay;
            if (readyToDisplay) {
              copyPreviewCanvasFrame(backgroundCanvas, temporaryBackgroundCanvas, outputWidth, outputHeight, displayWidth, displayHeight);
              copyPreviewCanvasFrame(glyphCanvas, temporaryGlyphCanvas, outputWidth, outputHeight, displayWidth, displayHeight);
            }
          }
        }
      } catch (error) {
        latestRef.current.onPerformanceWarning?.(error instanceof Error ? error.message : "Animated preview failed.");
        return;
      }

      const renderMs = performance.now() - renderStartedAt;
      const latest = latestRef.current;
      const targetFps = normalizeAnimationFps(latest.animation.fps);
      renderedFrames += 1;
      accumulatedRenderMs += renderMs;
      statsRenderedFrames += 1;
      statsAccumulatedRenderMs += renderMs;
      const statsElapsedSeconds = Math.max(0.001, (performance.now() - statsStartedAt) / 1000);
      if (statsElapsedSeconds >= LIVE_PREVIEW_STATS_INTERVAL_MS / 1000) {
        const actualFps = statsRenderedFrames / statsElapsedSeconds;
        const averageRenderMs = statsAccumulatedRenderMs / Math.max(1, statsRenderedFrames);
        const livePreview = latest.baseGrid
          ? resolveLivePreviewPerformance(
              latest.baseGrid,
              latest.animation,
              scaleStateRef.current,
              latest.optimizationLevel
            )
          : null;
        let profileChanged = false;
        if (livePreview && latest.baseGrid) {
          profileChanged = adaptLivePreviewScale(
            latest.baseGrid,
            scaleStateRef.current,
            targetFps,
            actualFps,
            averageRenderMs,
            Boolean(latest.sourceImageData),
            Boolean(latest.sourceImageData) && latest.animation.type === "wave",
            performance.now(),
            latest.optimizationLevel
          );
          if (!profileChanged) {
            if (displayReadyRef.current) {
              rememberStableLivePreviewProfile(
                scaleStateRef.current,
                livePreview,
                latest.optimizationLevel,
                latest.sourceImageData?.width ?? latest.baseGrid.sourceWidth,
                latest.sourceImageData?.height ?? latest.baseGrid.sourceHeight,
                actualFps,
                averageRenderMs,
                performance.now()
              );
            }
          } else {
            proxyRendererRef.current = null;
            scaledAtlasRef.current = { key: "", atlas: null };
            frameCacheRef.current.clear();
            displayReadyRef.current = false;
            lastRenderedPreviewFrameIndex = -1;
          }
        }
        const updatedLivePreview = latest.baseGrid
          ? resolveLivePreviewPerformance(
              latest.baseGrid,
              latest.animation,
              scaleStateRef.current,
              latest.optimizationLevel
            )
          : null;
        const currentProxyRenderer = proxyRendererRef.current;
        const currentProxyMatchesStats =
          Boolean(currentProxyRenderer) &&
          Math.abs((currentProxyRenderer?.sourceScale ?? 1) - (updatedLivePreview?.sourceScale ?? 1)) <= 0.001 &&
          (currentProxyRenderer?.stripSize ?? 1) === (updatedLivePreview?.stripSize ?? 1);
        const currentCacheMetadata = frameCacheRef.current.getMetadata();
        if (updatedLivePreview) {
          const cacheReadyForDisplay = isLivePreviewCacheReadyForDisplay(
            currentCacheMetadata,
            latest.optimizationLevel
          );
          const profilePhase =
            scaleStateRef.current.transitionReason && performance.now() < scaleStateRef.current.transitionUntil
              ? scaleStateRef.current.transitionReason
              : !displayReadyRef.current || !cacheReadyForDisplay
                ? "optimizing"
                : "live";
          latest.onLivePreviewStats?.(
            createLivePreviewStats(profilePhase, updatedLivePreview, {
              actualFps,
              averageRenderMs,
              droppedFrames: statsDroppedFrames,
              isSlow: actualFps < targetFps * 0.8 && targetFps - actualFps > 1,
              cacheEnabled: currentCacheMetadata?.enabled ?? false,
              cacheFrames: currentCacheMetadata?.cachedFrames ?? 0,
              cacheFrameCount: currentCacheMetadata?.frameCount ?? 0,
              cacheComplete: currentCacheMetadata?.complete ?? false
            })
          );
        }
        statsStartedAt = performance.now();
        statsRenderedFrames = 0;
        statsAccumulatedRenderMs = 0;
        statsDroppedFrames = 0;
      }
      if (!warned && renderedFrames >= 45 && accumulatedRenderMs / renderedFrames > 30) {
        warned = true;
        latest.onPerformanceWarning?.(
          "Live preview is rendering slowly. It may skip frames to stay responsive; use Preview Animation for true-FPS playback."
        );
      }

      frameHandle = window.requestAnimationFrame(renderFrame);
    };

    frameHandle = window.requestAnimationFrame(renderFrame);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frameHandle);
    };
  }, [
    active,
    paused,
    editPreviewActive,
    renderer,
    backgroundCanvasRef,
    glyphCanvasRef
  ]);
};
