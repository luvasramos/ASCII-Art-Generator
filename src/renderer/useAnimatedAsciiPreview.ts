import { useEffect, useRef, type RefObject } from "react";
import { createGlyphAtlas } from "../atlas/glyphAtlas";
import type { GlyphAtlas } from "../atlas/glyphAtlas";
import type { ImageGlyphAtlas } from "../atlas/imageGlyphAtlas";
import { normalizeCharacterSet } from "../ascii/charset";
import { createAnimatedImageRenderer, type AnimatedImageRenderer } from "../processing/animateImage";
import { generateRenderGrid } from "../processing/renderGrid";
import { createLivePreviewFrameCacheKey, LivePreviewFrameCache } from "./livePreviewFrameCache";
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
  RenderGrid,
  WorkerRenderOptions
} from "./types";

export interface LivePreviewStats {
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
  glyphMetrics: GlyphMetric[];
  onPerformanceWarning?: (message: string) => void;
  onLivePreviewStats?: (stats: LivePreviewStats | null) => void;
}

const createPreviewClockKey = (animation: AnimationSettings) =>
  [
    animation.type,
    animation.fps
  ].join(":");

const LIVE_PREVIEW_SCALE_STOPS = [1, 0.75, 0.5, 0.425, 0.33, 0.25] as const;
const LIVE_PREVIEW_SOURCE_SCALE_STOPS = [1, 0.75, 0.5, 0.33, 0.25] as const;
const LIVE_PREVIEW_STRIP_SIZE_STOPS = [1, 2, 4, 8, 12] as const;
const LIVE_PREVIEW_MIN_SHORT_SIDE = 280;
const LIVE_PREVIEW_STATS_INTERVAL_MS = 420;
const LIVE_PREVIEW_SCALE_COOLDOWN_MS = 1000;
const LIVE_PREVIEW_UPSCALE_SETTLE_MS = 4000;

interface LivePreviewScaleState {
  resetKey: string;
  scaleIndex: number;
  sourceScaleIndex: number;
  stripSizeIndex: number;
  slowWindows: number;
  healthyWindows: number;
  lastScaleChangedAt: number;
  lastSettingsChangedAt: number;
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

const createPreviewGeometryKey = (
  baseGrid: RenderGrid,
  ascii: AsciiSettings,
  animation: AnimationSettings
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
    animation.fps
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
  lastSettingsChangedAt: now
});

const warmStartScaleState = (
  resetKey: string,
  previous: LivePreviewScaleState,
  baseGrid: RenderGrid,
  now: number
): LivePreviewScaleState => {
  const allowedScales = getAllowedScaleStops(baseGrid);
  return {
    resetKey,
    scaleIndex: Math.min(previous.scaleIndex, allowedScales.length - 1),
    sourceScaleIndex: Math.min(previous.sourceScaleIndex, LIVE_PREVIEW_SOURCE_SCALE_STOPS.length - 1),
    stripSizeIndex: Math.min(previous.stripSizeIndex, LIVE_PREVIEW_STRIP_SIZE_STOPS.length - 1),
    slowWindows: 0,
    healthyWindows: 0,
    lastScaleChangedAt: previous.lastScaleChangedAt,
    lastSettingsChangedAt: now
  };
};

const getAllowedScaleStops = (baseGrid: RenderGrid) => {
  const outputWidth = Math.max(1, Math.round(baseGrid.width));
  const outputHeight = Math.max(1, Math.round(baseGrid.height));
  const shortSide = Math.min(outputWidth, outputHeight);
  const minimumShortSide = Math.min(shortSide, LIVE_PREVIEW_MIN_SHORT_SIDE);
  const allowed = LIVE_PREVIEW_SCALE_STOPS.filter(
    (scale) => shortSide * scale >= minimumShortSide || Math.abs(scale - 1) < 0.001
  );
  return allowed.length ? allowed : [1];
};

const resolveLivePreviewPerformance = (
  baseGrid: RenderGrid,
  animation: AnimationSettings,
  scaleState: LivePreviewScaleState
): LivePreviewPerformance => {
  const outputWidth = Math.max(1, Math.round(baseGrid.width));
  const outputHeight = Math.max(1, Math.round(baseGrid.height));
  const allowedScales = getAllowedScaleStops(baseGrid);
  const previewScale = allowedScales[Math.min(scaleState.scaleIndex, allowedScales.length - 1)] ?? 1;
  const sourceScale =
    LIVE_PREVIEW_SOURCE_SCALE_STOPS[
      Math.min(scaleState.sourceScaleIndex, LIVE_PREVIEW_SOURCE_SCALE_STOPS.length - 1)
    ] ?? 1;
  const stripSize =
    animation.type === "wave"
      ? LIVE_PREVIEW_STRIP_SIZE_STOPS[
          Math.min(scaleState.stripSizeIndex, LIVE_PREVIEW_STRIP_SIZE_STOPS.length - 1)
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

const adaptLivePreviewScale = (
  baseGrid: RenderGrid,
  scaleState: LivePreviewScaleState,
  targetFps: number,
  actualFps: number,
  averageRenderMs: number,
  canUseSourceProxy: boolean,
  canUseStripSize: boolean,
  now: number
) => {
  const allowedScales = getAllowedScaleStops(baseGrid);
  const frameBudgetMs = 1000 / Math.max(1, targetFps);
  const canAdjust = now - scaleState.lastScaleChangedAt >= LIVE_PREVIEW_SCALE_COOLDOWN_MS;
  const canUpscale = now - scaleState.lastSettingsChangedAt >= LIVE_PREVIEW_UPSCALE_SETTLE_MS;
  const isFarBelowTarget = actualFps < targetFps * 0.65 && targetFps - actualFps > 1;
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

  if (canAdjust && scaleState.slowWindows >= 2 && scaleState.scaleIndex < allowedScales.length - 1) {
    scaleState.scaleIndex += 1;
    scaleState.slowWindows = 0;
    scaleState.healthyWindows = 0;
    scaleState.lastScaleChangedAt = now;
    return;
  }

  if (
    canAdjust &&
    scaleState.slowWindows >= 2 &&
    scaleState.scaleIndex >= allowedScales.length - 1 &&
    canUseSourceProxy &&
    scaleState.sourceScaleIndex < LIVE_PREVIEW_SOURCE_SCALE_STOPS.length - 1
  ) {
    scaleState.sourceScaleIndex += 1;
    scaleState.slowWindows = 0;
    scaleState.healthyWindows = 0;
    scaleState.lastScaleChangedAt = now;
    return;
  }

  if (
    canAdjust &&
    scaleState.slowWindows >= 2 &&
    scaleState.scaleIndex >= allowedScales.length - 1 &&
    (!canUseSourceProxy || scaleState.sourceScaleIndex >= LIVE_PREVIEW_SOURCE_SCALE_STOPS.length - 1) &&
    canUseStripSize &&
    scaleState.stripSizeIndex < LIVE_PREVIEW_STRIP_SIZE_STOPS.length - 1
  ) {
    scaleState.stripSizeIndex += 1;
    scaleState.slowWindows = 0;
    scaleState.healthyWindows = 0;
    scaleState.lastScaleChangedAt = now;
    return;
  }

  if (canAdjust && canUpscale && scaleState.healthyWindows >= 5 && scaleState.stripSizeIndex > 0) {
    scaleState.stripSizeIndex -= 1;
    scaleState.slowWindows = 0;
    scaleState.healthyWindows = 0;
    scaleState.lastScaleChangedAt = now;
    return;
  }

  if (canAdjust && canUpscale && scaleState.healthyWindows >= 5 && scaleState.sourceScaleIndex > 0) {
    scaleState.sourceScaleIndex -= 1;
    scaleState.slowWindows = 0;
    scaleState.healthyWindows = 0;
    scaleState.lastScaleChangedAt = now;
    return;
  }

  if (canAdjust && canUpscale && scaleState.healthyWindows >= 5 && scaleState.scaleIndex > 0) {
    scaleState.scaleIndex -= 1;
    scaleState.slowWindows = 0;
    scaleState.healthyWindows = 0;
    scaleState.lastScaleChangedAt = now;
  }
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
  glyphMetrics,
  onPerformanceWarning,
  onLivePreviewStats
}: AnimatedAsciiPreviewArgs) => {
  const latestRef = useRef({
    baseGrid,
    atlas,
    imageGlyphAtlas,
    sourceImageData,
    font,
    ascii,
    image,
    frame,
    breakup,
    color,
    animation,
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
      sourceImageData,
      font,
      ascii,
      image,
      frame,
      breakup,
      color,
      animation,
      glyphMetrics,
      onPerformanceWarning,
      onLivePreviewStats
    };
  }, [
    baseGrid,
    atlas,
    imageGlyphAtlas,
    sourceImageData,
    font,
    ascii,
    image,
    frame,
    breakup,
    color,
    animation,
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
      clearLivePreviewSourceProxyCache();
      resetEchoFrameHistory(echoHistoryRef.current);
      latestRef.current.onLivePreviewStats?.(null);
      return;
    }
    if (paused) {
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
    renderer,
    animation.type,
    animation.fps
  ]);

  useEffect(() => {
    const backgroundCanvas = backgroundCanvasRef.current;
    const glyphCanvas = glyphCanvasRef.current;

    if (!active || paused || !renderer || !backgroundCanvas || !glyphCanvas) {
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
          statsStartedAt = now;
          statsRenderedFrames = 0;
          statsAccumulatedRenderMs = 0;
          statsDroppedFrames = 0;
          resetEchoFrameHistory(echoHistoryRef.current);
        }

        const elapsedSeconds = (now - clockRef.current.startedAt) / 1000;
        const sourceWidth = latest.sourceImageData?.width ?? 0;
        const sourceHeight = latest.sourceImageData?.height ?? 0;
        const previousSourceState = sourceStateRef.current;
        const sourceChanged =
          !previousSourceState ||
          previousSourceState.source !== latest.sourceImageData ||
          previousSourceState.width !== sourceWidth ||
          previousSourceState.height !== sourceHeight;
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
          scaleStateRef.current.lastSettingsChangedAt = now;
          scaleStateRef.current.slowWindows = 0;
          scaleStateRef.current.healthyWindows = 0;
          lastRenderedPreviewFrameIndex = -1;
          resetEchoFrameHistory(echoHistoryRef.current);
        }

        const resetKey = createPreviewGeometryKey(latest.baseGrid, latest.ascii, latest.animation);
        if (scaleStateRef.current.resetKey !== resetKey) {
          const previousScaleState = scaleStateRef.current;
          scaleStateRef.current = previousScaleState.resetKey
            ? warmStartScaleState(resetKey, previousScaleState, latest.baseGrid, now)
            : createInitialScaleState(resetKey, now);
          scaledAtlasRef.current = { key: "", atlas: null };
          statsStartedAt = now;
          statsRenderedFrames = 0;
          statsAccumulatedRenderMs = 0;
          statsDroppedFrames = 0;
          lastRenderedPreviewFrameIndex = -1;
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
          visualKeyRef.current = visualKey;
          scaleStateRef.current.lastSettingsChangedAt = now;
          scaleStateRef.current.slowWindows = 0;
          scaleStateRef.current.healthyWindows = 0;
          lastRenderedPreviewFrameIndex = -1;
          resetEchoFrameHistory(echoHistoryRef.current);
        }

        const livePreview = resolveLivePreviewPerformance(latest.baseGrid, latest.animation, scaleStateRef.current);
        const previewFrameIndex = Math.floor(elapsedSeconds * livePreview.targetFps);
        const cacheFrameCount = resolveAnimationFrameCount(latest.animation.loopDuration, livePreview.targetFps);
        const cacheFrameIndex = ((previewFrameIndex % cacheFrameCount) + cacheFrameCount) % cacheFrameCount;
        const cacheEnabled = cacheFrameCount > 1 && !isEchoActive(latest.animation);
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
          proxySourceHeight: livePreview.proxySourceHeight
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

        const timeSeconds = elapsedSeconds;
        const outputWidth = livePreview.previewWidth;
        const outputHeight = livePreview.previewHeight;
        const displayWidth = livePreview.previewWidth;
        const displayHeight = livePreview.previewHeight;
        const cachedFrame = cacheMetadata?.enabled ? frameCacheRef.current.getFrame(cacheFrameIndex) : null;
        if (cachedFrame) {
          resetEchoFrameHistory(echoHistoryRef.current);
          copyPreviewCanvasFrame(backgroundCanvas, cachedFrame.background, outputWidth, outputHeight, displayWidth, displayHeight);
          copyPreviewCanvasFrame(glyphCanvas, cachedFrame.glyph, outputWidth, outputHeight, displayWidth, displayHeight);
        } else {
          let frameRenderer = renderer;
          if (latest.sourceImageData && (livePreview.sourceScale < 0.999 || livePreview.stripSize > 1)) {
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
            copyPreviewCanvasFrame(backgroundCanvas, temporaryBackgroundCanvas, outputWidth, outputHeight, displayWidth, displayHeight);
            compositeEchoFrame({
              targetCanvas: temporaryEchoCanvas,
              currentLayerCanvas: temporaryGlyphCanvas,
              history: echoHistoryRef.current,
              animation: latest.animation
            });
            copyPreviewCanvasFrame(glyphCanvas, temporaryEchoCanvas, outputWidth, outputHeight, displayWidth, displayHeight);
            pushEchoFrame(echoHistoryRef.current, temporaryGlyphCanvas, latest.animation);
          } else {
            resetEchoFrameHistory(echoHistoryRef.current);
            copyPreviewCanvasFrame(backgroundCanvas, temporaryBackgroundCanvas, outputWidth, outputHeight, displayWidth, displayHeight);
            copyPreviewCanvasFrame(glyphCanvas, temporaryGlyphCanvas, outputWidth, outputHeight, displayWidth, displayHeight);
            if (cacheMetadata?.enabled) {
              frameCacheRef.current.storeFrame(cacheFrameIndex, temporaryBackgroundCanvas, temporaryGlyphCanvas);
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
          ? resolveLivePreviewPerformance(latest.baseGrid, latest.animation, scaleStateRef.current)
          : null;
        if (livePreview && latest.baseGrid) {
          adaptLivePreviewScale(
            latest.baseGrid,
            scaleStateRef.current,
            targetFps,
            actualFps,
            averageRenderMs,
            Boolean(latest.sourceImageData),
            Boolean(latest.sourceImageData) && latest.animation.type === "wave",
            performance.now()
          );
        }
        const updatedLivePreview = latest.baseGrid
          ? resolveLivePreviewPerformance(latest.baseGrid, latest.animation, scaleStateRef.current)
          : null;
        const currentProxyRenderer = proxyRendererRef.current;
        const currentProxyMatchesStats =
          Boolean(currentProxyRenderer) &&
          Math.abs((currentProxyRenderer?.sourceScale ?? 1) - (updatedLivePreview?.sourceScale ?? 1)) <= 0.001 &&
          (currentProxyRenderer?.stripSize ?? 1) === (updatedLivePreview?.stripSize ?? 1);
        const currentCacheMetadata = frameCacheRef.current.getMetadata();
        latest.onLivePreviewStats?.({
          targetFps,
          actualFps,
          averageRenderMs,
          droppedFrames: statsDroppedFrames,
          isSlow: actualFps < targetFps * 0.8 && targetFps - actualFps > 1,
          previewScale: updatedLivePreview?.previewScale ?? 1,
          previewWidth: updatedLivePreview?.previewWidth ?? 1,
          previewHeight: updatedLivePreview?.previewHeight ?? 1,
          outputWidth: updatedLivePreview?.outputWidth ?? 1,
          outputHeight: updatedLivePreview?.outputHeight ?? 1,
          sourceScale: updatedLivePreview?.sourceScale ?? 1,
          proxySourceWidth: currentProxyMatchesStats
            ? currentProxyRenderer?.width ?? 1
            : updatedLivePreview?.proxySourceWidth ?? 1,
          proxySourceHeight: currentProxyMatchesStats
            ? currentProxyRenderer?.height ?? 1
            : updatedLivePreview?.proxySourceHeight ?? 1,
          stripSize: updatedLivePreview?.stripSize ?? 1,
          cacheEnabled: currentCacheMetadata?.enabled ?? false,
          cacheFrames: currentCacheMetadata?.cachedFrames ?? 0,
          cacheFrameCount: currentCacheMetadata?.frameCount ?? 0,
          cacheComplete: currentCacheMetadata?.complete ?? false
        });
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
    renderer,
    backgroundCanvasRef,
    glyphCanvasRef
  ]);
};
