import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Maximize2, Minus, Pause, Play, Plus, Redo2, RotateCcw, Undo2, X } from "lucide-react";
import { createGlyphAtlas } from "../atlas/glyphAtlas";
import { createImageGlyphAtlas, type ImageGlyphAtlas } from "../atlas/imageGlyphAtlas";
import { normalizeCharacterSet } from "../ascii/charset";
import { getTonalRangeWeight } from "../luminance/adjustments";
import type { AnimatedImageRenderer } from "../processing/animateImage";
import { renderAsciiLayers } from "../renderer/layeredCanvasRenderer";
import { scaleFontForRenderResolution } from "../renderer/geometry";
import { normalizeAnimationFps } from "../renderer/animationTiming";
import {
  estimateInitialLivePreviewScale,
  useAnimatedAsciiPreview,
  type LivePreviewStats
} from "../renderer/useAnimatedAsciiPreview";
import { useRenderedAnimationPlayback } from "../renderer/useRenderedAnimationPlayback";
import { getRenderedPreviewCache, useRenderedAnimationPreview } from "../renderer/useRenderedAnimationPreview";
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
  AnimationPreviewFormat,
  LivePreviewOptimizationLevel,
  RenderGrid,
  RenderedPreviewState,
  ToneRangePreview,
  VisualEditPreviewState,
  VideoPlaybackState
} from "../renderer/types";
import { useStudioStore } from "../state/useStudioStore";
import { IconButton } from "./controls";

interface StudioCanvasProps {
  grid: RenderGrid | null;
  mediaKey: string;
  font: FontSettings;
  ascii: AsciiSettings;
  color: ColorSettings;
  exportOptions: ExportOptions;
  exportScale: number;
  image: ImageSettings;
  frame: FrameSettings;
  frameFitKey: string;
  breakup: BreakupSettings;
  animation: AnimationSettings;
  glyphMetrics: GlyphMetric[];
  isProcessing: boolean;
  rendererWarning: string | null;
  onMediaFile: (file: File) => void;
  videoPlayback: VideoPlaybackState;
  onToggleVideoPlayback: () => void;
  onVideoSeek: (time: number) => void;
  animatedImageRenderer: AnimatedImageRenderer | null;
  livePreviewSourceImageData?: ImageData | null;
  animateStillImageActive: boolean;
  onAnimationPerformanceWarning: (message: string) => void;
  toneRangePreview: ToneRangePreview | null;
  visualEditPreview: VisualEditPreviewState;
}

const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "0:00";
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
};

const mediaExtensionPattern = /\.(jpe?g|png|webp|mp4|webm|mov|m4v)$/i;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.18;
const AUTO_FIT_SCALE_CHANGE_THRESHOLD = 0.15;
const AUTO_FIT_SCALE_COOLDOWN_MS = 750;
const PAN_ADJUST_THRESHOLD_PX = 2;

const clampZoom = (value: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));

const waitForBrowserFrame = () =>
  new Promise<void>((resolve) => {
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => resolve());
      return;
    }
    globalThis.setTimeout(resolve, 0);
  });

const renderedPreviewQualityLabel = (quality: string) =>
  quality === "fast" ? "Fast" : quality === "final" ? "Final Quality" : "Balanced";

const livePreviewOptimizationOptions: Array<{ value: LivePreviewOptimizationLevel; label: string }> = [
  { value: "super-fast", label: "Super Fast" },
  { value: "fast", label: "Fast" },
  { value: "balanced", label: "Balanced" },
  { value: "high", label: "High" },
  { value: "off", label: "Off" }
];

const livePreviewOptimizationLabel = (level: LivePreviewOptimizationLevel) =>
  livePreviewOptimizationOptions.find((option) => option.value === level)?.label ?? "Balanced";

const animationPreviewFormatOptions: Array<{ value: AnimationPreviewFormat; label: string }> = [
  { value: "webm", label: "WebM" },
  { value: "gif", label: "GIF" },
  { value: "mp4", label: "MP4" },
  { value: "png-sequence", label: "PNG Seq" }
];

const animationPreviewFormatLabel = (format: AnimationPreviewFormat) =>
  animationPreviewFormatOptions.find((option) => option.value === format)?.label ?? "WebM";

const getRenderedPreviewCompletedFrameCount = (preview: RenderedPreviewState) => {
  const frameCount = Math.max(0, preview.frameCount);
  if (frameCount <= 0) {
    return 0;
  }
  if (preview.status === "rendering" && preview.progress <= 0) {
    return 0;
  }
  return Math.min(frameCount, Math.max(0, preview.currentFrame) + 1);
};

const renderedPreviewStatusText = (preview: RenderedPreviewState) => {
  const frameCount = Math.max(0, preview.frameCount);
  const qualityLabel = `${renderedPreviewQualityLabel(preview.quality)} quality`;
  const completedFrames = getRenderedPreviewCompletedFrameCount(preview);

  switch (preview.status) {
    case "rendering":
      return frameCount > 0
        ? `Rendering frame ${completedFrames} / ${frameCount} - ${qualityLabel}`
        : `Rendering preview - ${qualityLabel}`;
    case "ready":
      return `Preview ready - ${qualityLabel}`;
    case "playing":
      return `Playing at ${preview.fps} fps - ${qualityLabel}`;
    case "paused":
      return `Paused - ${qualityLabel}`;
    case "stale":
      return "Preview is outdated";
    case "error":
      return preview.error ?? "Rendered preview failed";
    case "idle":
    default:
      return "Ready to render preview";
  }
};

const livePreviewStatusText = (
  active: boolean,
  paused: boolean,
  targetFps: number,
  stats: LivePreviewStats | null,
  grid: RenderGrid | null,
  optimizationLabel: string
) => {
  const previewWidth = Math.max(1, Math.round(stats?.previewWidth ?? grid?.width ?? 1));
  const previewHeight = Math.max(1, Math.round(stats?.previewHeight ?? grid?.height ?? 1));
  const outputWidth = Math.max(1, Math.round(stats?.outputWidth ?? grid?.width ?? 1));
  const outputHeight = Math.max(1, Math.round(stats?.outputHeight ?? grid?.height ?? 1));
  const outputDimensionsText = `Output ${outputWidth}x${outputHeight}`;
  const outputText = `${optimizationLabel} - ${outputDimensionsText}`;
  if (optimizationLabel === "Off") {
    if (!active) {
      return "Live Preview";
    }
    if (stats?.phase === "updating") {
      return `Updating preview... - ${outputText}`;
    }
    if (stats?.phase === "optimizing") {
      return `Live preview optimization off - ${outputDimensionsText}`;
    }
    if (paused) {
      return `Live paused - target ${targetFps} - ${outputText}`;
    }
    if (!stats) {
      return `Live target ${targetFps} - ${outputText}`;
    }
    const actualFps = Math.max(0, Math.round(stats.actualFps));
    return `Live ${actualFps}/${stats.targetFps} fps - ${outputText}`;
  }
  const sourceText =
    stats && stats.sourceScale < 0.999
      ? ` - Source ${Math.max(1, Math.round(stats.sourceScale * 100))}%`
      : "";
  const stripText =
    stats && stats.stripSize > 1
      ? ` - Strip ${stats.stripSize}px`
      : "";
  const cacheText =
    stats && stats.cacheEnabled && stats.cacheFrameCount > 1
      ? stats.cacheComplete
        ? "Cached - "
        : `Cache ${stats.cacheFrames}/${stats.cacheFrameCount} - `
      : "";
  const sizeText = `${optimizationLabel} - ${cacheText}Preview ${previewWidth}x${previewHeight}${sourceText}${stripText} - Output ${outputWidth}x${outputHeight}`;
  if (!active) {
    return "Live Preview";
  }
  if (stats?.phase === "updating") {
    return `Updating preview... - ${sizeText}`;
  }
  if (stats?.phase === "optimizing") {
    if (stats.cacheEnabled && stats.cacheFrameCount > 1 && stats.cacheFrames > 0 && !stats.cacheComplete) {
      return `Caching live preview ${stats.cacheFrames}/${stats.cacheFrameCount}... - ${optimizationLabel}`;
    }
    return `Optimizing live preview... - ${optimizationLabel}`;
  }
  if (stats?.phase === "testing") {
    return `Testing better preview... - ${sizeText}`;
  }
  if (paused) {
    return `Live paused - target ${targetFps} - ${sizeText}`;
  }
  if (!stats) {
    return `Live target ${targetFps} - ${sizeText}`;
  }
  const actualFps = Math.max(0, Math.round(stats.actualFps));
  return `Live ${actualFps}/${stats.targetFps} fps - ${sizeText}`;
};

export const StudioCanvas = ({
  grid,
  mediaKey,
  font,
  ascii,
  color,
  exportOptions,
  exportScale,
  image,
  frame,
  frameFitKey,
  breakup,
  animation,
  glyphMetrics,
  isProcessing,
  rendererWarning,
  onMediaFile,
  videoPlayback,
  onToggleVideoPlayback,
  onVideoSeek,
  animatedImageRenderer,
  livePreviewSourceImageData = null,
  animateStillImageActive,
  onAnimationPerformanceWarning,
  toneRangePreview,
  visualEditPreview
}: StudioCanvasProps) => {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const backgroundCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const glyphCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const tonePreviewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderedPreviewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderedPreviewMediaKeyRef = useRef(mediaKey);
  const autoFitRef = useRef<{
    mediaKey: string;
    frameFitKey: string;
    animated: boolean;
    width: number;
    height: number;
    lastFitAt: number;
  } | null>(null);
  const userAdjustedViewportRef = useRef(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragActive, setDragActive] = useState(false);
  const [livePreviewStats, setLivePreviewStats] = useState<LivePreviewStats | null>(null);
  const [stableLivePreviewStats, setStableLivePreviewStats] = useState<LivePreviewStats | null>(null);
  const [livePreviewPlaying, setLivePreviewPlaying] = useState(true);
  const [imageGlyphAtlas, setImageGlyphAtlas] = useState<ImageGlyphAtlas | null>(null);
  const pointerRef = useRef<{ x: number; y: number; panX: number; panY: number; hasMoved: boolean } | null>(null);
  const {
    undoStack,
    redoStack,
    undo,
    redo,
    renderedPreview,
    livePreviewOptimizationLevel,
    markRenderedPreviewStale,
    setAnimationPreviewMode,
    setLivePreviewOptimizationLevel,
    setAnimationPreviewFormat
  } = useStudioStore();
  const canPreviewAnimation = animateStillImageActive && Boolean(animatedImageRenderer) && Boolean(grid);
  const renderedPreviewProgress = Math.min(1, Math.max(0, renderedPreview.progress));
  const renderedPreviewFrameCount = Math.max(0, renderedPreview.frameCount);
  const renderedPreviewRenderedFrames = getRenderedPreviewCompletedFrameCount(renderedPreview);
  const renderedPreviewCache = getRenderedPreviewCache(renderedPreview.cacheKey);
  const renderedPreviewCanUseCache =
    Boolean(renderedPreview.cacheKey) &&
    Boolean(renderedPreviewCache) &&
    renderedPreviewCache?.previewFormat === renderedPreview.previewFormat &&
    renderedPreview.quality === "final" &&
    renderedPreview.frameCount > 0 &&
    (renderedPreview.status === "ready" || renderedPreview.status === "playing" || renderedPreview.status === "paused");
  const renderedPreviewFormatLabel = animationPreviewFormatLabel(renderedPreview.previewFormat);
  const inlineFinalPreviewActive =
    renderedPreview.mode === "rendered" &&
    renderedPreview.quality === "final" &&
    renderedPreview.status !== "idle";
  const inlineFinalPreviewRendering = inlineFinalPreviewActive && renderedPreview.status === "rendering";
  const inlineFinalPreviewVisible =
    inlineFinalPreviewActive &&
    Boolean(renderedPreviewCache) &&
    (renderedPreview.status === "ready" || renderedPreview.status === "playing" || renderedPreview.status === "paused");
  const inlineFinalPreviewStatusVisible =
    inlineFinalPreviewActive &&
    (inlineFinalPreviewRendering ||
      inlineFinalPreviewVisible ||
      renderedPreview.status === "stale" ||
      renderedPreview.status === "error");
  const finalPreviewWidth = Math.max(
    1,
    Math.round(renderedPreviewCache?.width ?? (grid ? grid.width * exportScale : 1))
  );
  const finalPreviewHeight = Math.max(
    1,
    Math.round(renderedPreviewCache?.height ?? (grid ? grid.height * exportScale : 1))
  );
  const visualEditPreviewActive = visualEditPreview.isActive;
  const editPreviewActive = visualEditPreviewActive || Boolean(toneRangePreview);
  const finalQualityStaticPreviewActive =
    animateStillImageActive && !inlineFinalPreviewActive && !livePreviewPlaying;
  const livePreviewOptimizing =
    animateStillImageActive &&
    !inlineFinalPreviewActive &&
    livePreviewPlaying &&
    (!livePreviewStats || livePreviewStats.phase === "optimizing");
  const displayedLivePreviewStats =
    livePreviewOptimizationLevel !== "off" && livePreviewOptimizing && stableLivePreviewStats
      ? stableLivePreviewStats
      : livePreviewStats;
  const livePreviewPaused =
    animateStillImageActive &&
    (!livePreviewPlaying ||
      inlineFinalPreviewRendering ||
      inlineFinalPreviewVisible ||
      renderedPreview.status === "stale" ||
      renderedPreview.status === "error");
  const livePreviewTargetFps = normalizeAnimationFps(animation.fps);
  const livePreviewOptimizationName = livePreviewOptimizationLabel(livePreviewOptimizationLevel);
  const livePreviewLabel = finalQualityStaticPreviewActive
    ? `Paused - Final quality - Output ${Math.max(1, Math.round(grid?.width ?? 1))}x${Math.max(1, Math.round(grid?.height ?? 1))}`
    : visualEditPreviewActive
    ? visualEditPreview.pendingReturnToLivePreview
      ? "Updating final preview..."
      : "Editing preview - Final quality"
    : livePreviewStatusText(
        animateStillImageActive,
        livePreviewPaused,
        livePreviewTargetFps,
        livePreviewStats,
        grid,
        livePreviewOptimizationName
      );
  const initialLivePreviewScale = grid
    ? estimateInitialLivePreviewScale(grid.width, grid.height, livePreviewTargetFps, livePreviewOptimizationLevel)
    : 1;
  const visibleCanvasWidth = grid
    ? inlineFinalPreviewActive
      ? finalPreviewWidth
      : finalQualityStaticPreviewActive || (livePreviewOptimizing && !stableLivePreviewStats)
      ? grid.width
      : animateStillImageActive
      ? Math.max(1, Math.round(displayedLivePreviewStats?.previewWidth ?? grid.width * initialLivePreviewScale))
      : grid.width
    : 1;
  const visibleCanvasHeight = grid
    ? inlineFinalPreviewActive
      ? finalPreviewHeight
      : finalQualityStaticPreviewActive || (livePreviewOptimizing && !stableLivePreviewStats)
      ? grid.height
      : animateStillImageActive
      ? Math.max(1, Math.round(displayedLivePreviewStats?.previewHeight ?? grid.height * initialLivePreviewScale))
      : grid.height
    : 1;
  const livePreviewTransitioning =
    animateStillImageActive &&
    !inlineFinalPreviewActive &&
    !finalQualityStaticPreviewActive &&
    !editPreviewActive &&
    (!livePreviewStats || livePreviewStats.phase === "optimizing" || livePreviewStats.phase === "updating");

  const {
    generate: generateRenderedPreview,
    cancel: cancelRenderedPreviewRender
  } = useRenderedAnimationPreview({
    sourceKey: mediaKey,
    renderer: animatedImageRenderer,
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
    quality: "final",
    previewFormat: renderedPreview.previewFormat
  });
  const {
    play: playRenderedPreview,
    pause: pauseRenderedPreview,
    stop: stopRenderedPreview,
    drawFrame: drawRenderedPreviewFrame
  } = useRenderedAnimationPlayback({
    canvasRef: renderedPreviewCanvasRef,
    loop: true
  });

  const startRenderedPreview = useCallback(async () => {
    if (!canPreviewAnimation) {
      return;
    }
    setAnimationPreviewMode("rendered");
    setLivePreviewPlaying(false);
    stopRenderedPreview();
    await waitForBrowserFrame();
    const cache = await generateRenderedPreview();
    if (cache) {
      await waitForBrowserFrame();
      playRenderedPreview({ restart: true });
    }
  }, [
    canPreviewAnimation,
    generateRenderedPreview,
    playRenderedPreview,
    setAnimationPreviewMode,
    stopRenderedPreview
  ]);

  const backToLivePreview = useCallback(() => {
    if (renderedPreview.status === "rendering") {
      cancelRenderedPreviewRender();
    }
    stopRenderedPreview();
    setAnimationPreviewMode("live");
    setLivePreviewPlaying(true);
  }, [cancelRenderedPreviewRender, renderedPreview.status, setAnimationPreviewMode, stopRenderedPreview]);

  const cancelRenderedPreview = useCallback(() => {
    cancelRenderedPreviewRender();
    stopRenderedPreview();
    setAnimationPreviewMode("live");
    setLivePreviewPlaying(true);
  }, [cancelRenderedPreviewRender, setAnimationPreviewMode, stopRenderedPreview]);

  const replayRenderedPreview = useCallback(() => {
    setAnimationPreviewMode("rendered");
    playRenderedPreview({ restart: true });
  }, [playRenderedPreview, setAnimationPreviewMode]);

  const resumeRenderedPreview = useCallback(() => {
    setAnimationPreviewMode("rendered");
    playRenderedPreview();
  }, [playRenderedPreview, setAnimationPreviewMode]);

  const handleLivePreviewStats = useCallback((stats: LivePreviewStats | null) => {
    setLivePreviewStats(stats);
    if (!stats) {
      setStableLivePreviewStats(null);
      return;
    }
    if (stats.phase === "live") {
      setStableLivePreviewStats(stats);
    }
  }, []);

  useEffect(() => {
    if (!inlineFinalPreviewVisible || renderedPreview.status === "playing") {
      return;
    }
    try {
      drawRenderedPreviewFrame(renderedPreview.currentFrame);
    } catch {
      // Playback hook reports detailed canvas/cache failures through rendered preview state.
    }
  }, [
    drawRenderedPreviewFrame,
    inlineFinalPreviewVisible,
    renderedPreview.currentFrame,
    renderedPreview.status
  ]);

  useEffect(() => {
    setLivePreviewPlaying(true);
    setLivePreviewStats(null);
    setStableLivePreviewStats(null);
  }, [
    animateStillImageActive,
    mediaKey
  ]);

  useEffect(() => {
    setLivePreviewPlaying(true);
    setLivePreviewStats(null);
  }, [
    animation.type,
    livePreviewOptimizationLevel
  ]);

  useEffect(() => {
    if (!animateStillImageActive) {
      setLivePreviewStats(null);
      setStableLivePreviewStats(null);
    }
  }, [
    animateStillImageActive
  ]);

  useEffect(() => {
    if (renderedPreviewMediaKeyRef.current === mediaKey) {
      return;
    }
    renderedPreviewMediaKeyRef.current = mediaKey;
    if (renderedPreview.status !== "idle") {
      markRenderedPreviewStale();
    }
  }, [markRenderedPreviewStale, mediaKey, renderedPreview.status]);

  const atlas = useMemo(() => {
    if (!grid) {
      return null;
    }
    const renderFont = scaleFontForRenderResolution(font, ascii.renderResolution);
    return createGlyphAtlas(
      normalizeCharacterSet(ascii.charset),
      renderFont,
      grid.cellWidth,
      grid.cellHeight,
      ascii.characterScale
    );
  }, [ascii.characterScale, ascii.charset, ascii.renderResolution, font, grid]);

  useEffect(() => {
    let cancelled = false;
    if (ascii.glyphMode !== "images" || ascii.imageGlyphs.length < 2) {
      setImageGlyphAtlas(null);
      return;
    }
    void createImageGlyphAtlas(ascii.imageGlyphs)
      .then((nextAtlas) => {
        if (!cancelled) {
          setImageGlyphAtlas(nextAtlas);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setImageGlyphAtlas(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ascii.glyphMode, ascii.imageGlyphs]);

  const fitToView = useCallback(() => {
    if (!grid || !viewportRef.current) {
      return;
    }
    const rect = viewportRef.current.getBoundingClientRect();
    const exportPanel = document.querySelector<HTMLElement>("[data-ascii-export-panel='true']");
    const exportRect = exportPanel?.getBoundingClientRect();
    const exportPanelOverlaps =
      exportRect &&
      exportRect.right > rect.left &&
      exportRect.left < rect.right &&
      exportRect.bottom > rect.top &&
      exportRect.top < rect.bottom;
    const reservedLeft = exportPanelOverlaps ? Math.max(0, exportRect.right - rect.left + 20) : 0;
    const availableWidth = Math.max(120, rect.width - reservedLeft - 96);
    const availableHeight = Math.max(120, rect.height - 168);
    const fitWidth = Math.max(1, visibleCanvasWidth);
    const fitHeight = Math.max(1, visibleCanvasHeight);
    const nextZoom = clampZoom(Math.min(availableWidth / fitWidth, availableHeight / fitHeight));
    setZoom(nextZoom);
    setPan({
      x: reservedLeft + (availableWidth - fitWidth * nextZoom) / 2,
      y: (rect.height - fitHeight * nextZoom) / 2
    });
    userAdjustedViewportRef.current = false;
    autoFitRef.current = {
      mediaKey,
      frameFitKey,
      animated: animateStillImageActive,
      width: Math.max(1, Math.round(visibleCanvasWidth)),
      height: Math.max(1, Math.round(visibleCanvasHeight)),
      lastFitAt: performance.now()
    };
  }, [
    animateStillImageActive,
    frameFitKey,
    grid,
    mediaKey,
    visibleCanvasHeight,
    visibleCanvasWidth
  ]);

  const zoomAtPoint = useCallback((localX: number, localY: number, resolveZoom: (zoom: number) => number) => {
    setZoom((currentZoom) => {
      const nextZoom = clampZoom(resolveZoom(currentZoom));
      setPan((currentPan) => {
        const worldX = (localX - currentPan.x) / currentZoom;
        const worldY = (localY - currentPan.y) / currentZoom;
        return {
          x: localX - worldX * nextZoom,
          y: localY - worldY * nextZoom
        };
      });
      return nextZoom;
    });
  }, []);

  const zoomFromCenter = useCallback((factor: number) => {
    if (!viewportRef.current) {
      setZoom((value) => clampZoom(value * factor));
      return;
    }
    const rect = viewportRef.current.getBoundingClientRect();
    zoomAtPoint(rect.width / 2, rect.height / 2, (value) => value * factor);
  }, [zoomAtPoint]);

  const userZoomFromCenter = useCallback((factor: number) => {
    userAdjustedViewportRef.current = true;
    zoomFromCenter(factor);
  }, [zoomFromCenter]);

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) {
        return false;
      }
      const tag = target.tagName.toLowerCase();
      return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const modifier = event.ctrlKey || event.metaKey;

      if (!modifier && key === "f" && !isEditableTarget(event.target)) {
        event.preventDefault();
        fitToView();
        return;
      }

      if (!modifier || event.altKey) {
        return;
      }

      if (event.key === "]") {
        event.preventDefault();
        userZoomFromCenter(ZOOM_STEP);
      } else if (event.key === "[") {
        event.preventDefault();
        userZoomFromCenter(1 / ZOOM_STEP);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [fitToView, userZoomFromCenter]);

  useEffect(() => {
    const shouldRenderStaticPreview =
      !inlineFinalPreviewActive &&
      (!animateStillImageActive ||
        finalQualityStaticPreviewActive ||
        (livePreviewOptimizing && !stableLivePreviewStats) ||
        livePreviewStats?.phase === "updating" ||
        editPreviewActive);
    if (
      !shouldRenderStaticPreview ||
      !grid ||
      !atlas ||
      !backgroundCanvasRef.current ||
      !glyphCanvasRef.current
    ) {
      return;
    }
    renderAsciiLayers({
      backgroundCanvas: backgroundCanvasRef.current,
      glyphCanvas: glyphCanvasRef.current,
      grid,
      atlas,
      imageGlyphAtlas,
      font,
      ascii,
      color,
      exportOptions: finalQualityStaticPreviewActive ? exportOptions : undefined
    });
    backgroundCanvasRef.current.style.width = `${Math.max(1, Math.round(visibleCanvasWidth))}px`;
    backgroundCanvasRef.current.style.height = `${Math.max(1, Math.round(visibleCanvasHeight))}px`;
    glyphCanvasRef.current.style.width = `${Math.max(1, Math.round(visibleCanvasWidth))}px`;
    glyphCanvasRef.current.style.height = `${Math.max(1, Math.round(visibleCanvasHeight))}px`;
  }, [
    animateStillImageActive,
    ascii,
    atlas,
    color,
    font,
    grid,
    imageGlyphAtlas,
    editPreviewActive,
    exportOptions,
    finalQualityStaticPreviewActive,
    inlineFinalPreviewActive,
    livePreviewOptimizing,
    livePreviewStats?.phase,
    stableLivePreviewStats,
    visibleCanvasHeight,
    visibleCanvasWidth
  ]);

  useAnimatedAsciiPreview({
    active: animateStillImageActive,
    paused: livePreviewPaused,
    editPreviewActive,
    renderer: animatedImageRenderer,
    sourceImageData: livePreviewSourceImageData,
    backgroundCanvasRef,
    glyphCanvasRef,
    baseGrid: grid,
    atlas,
    imageGlyphAtlas,
    font,
    ascii,
    image,
    frame,
    breakup,
    color,
    animation,
    optimizationLevel: livePreviewOptimizationLevel,
    glyphMetrics,
    onPerformanceWarning: onAnimationPerformanceWarning,
    onLivePreviewStats: handleLivePreviewStats
  });

  useEffect(() => {
    const canvas = tonePreviewCanvasRef.current;
    if (!canvas) {
      return;
    }

    const renderWidth = Math.max(1, Math.round(grid?.width ?? visibleCanvasWidth));
    const renderHeight = Math.max(1, Math.round(grid?.height ?? visibleCanvasHeight));
    const displayWidth = Math.max(1, Math.round(visibleCanvasWidth));
    const displayHeight = Math.max(1, Math.round(visibleCanvasHeight));
    if (canvas.width !== renderWidth) {
      canvas.width = renderWidth;
    }
    if (canvas.height !== renderHeight) {
      canvas.height = renderHeight;
    }
    canvas.style.width = `${displayWidth}px`;
    canvas.style.height = `${displayHeight}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    ctx.clearRect(0, 0, renderWidth, renderHeight);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    if (!grid || !toneRangePreview) {
      return;
    }

    const stepX = grid.cellWidth + grid.gapX;
    const stepY = grid.cellHeight + grid.gapY;
    const baseCellWidth = grid.gapX > 0 ? grid.cellWidth : grid.cellWidth + 0.5;
    const baseCellHeight = grid.gapY > 0 ? grid.cellHeight : grid.cellHeight + 0.5;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, renderWidth, renderHeight);
    ctx.clip();
    ctx.fillStyle = "rgba(0, 0, 0, 0.72)";
    ctx.fillRect(0, 0, renderWidth, renderHeight);
    ctx.fillStyle = "#ffffff";

    for (const cell of grid.cells) {
      if (cell.alpha <= 0.01 || cell.coverage <= 0.01) {
        continue;
      }
      const tonalLuminance = image.invertTone ? 1 - cell.luminance : cell.luminance;
      const weight = getTonalRangeWeight(tonalLuminance, toneRangePreview, image);
      if (weight <= 0.004) {
        continue;
      }
      const x = grid.gapX > 0 ? cell.x * stepX : Math.round(cell.x * stepX);
      const y = grid.gapY > 0 ? cell.y * stepY : Math.round(cell.y * stepY);
      const cellWidth = grid.gapX > 0 ? baseCellWidth : Math.ceil(baseCellWidth);
      const cellHeight = grid.gapY > 0 ? baseCellHeight : Math.ceil(baseCellHeight);
      const drawWidth = Math.max(0, Math.min(cellWidth, renderWidth - x));
      const drawHeight = Math.max(0, Math.min(cellHeight, renderHeight - y));
      if (drawWidth <= 0 || drawHeight <= 0) {
        continue;
      }
      ctx.globalAlpha = Math.min(1, weight * Math.min(1, cell.alpha * 1.15));
      ctx.fillRect(x, y, drawWidth, drawHeight);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }, [
    animateStillImageActive,
    grid,
    image,
    toneRangePreview,
    visibleCanvasHeight,
    visibleCanvasWidth
  ]);

  useEffect(() => {
    if (!grid) {
      autoFitRef.current = null;
      userAdjustedViewportRef.current = false;
      return;
    }

    const width = Math.max(1, Math.round(visibleCanvasWidth));
    const height = Math.max(1, Math.round(visibleCanvasHeight));
    const previous = autoFitRef.current;
    const now = performance.now();
    const mediaChanged = previous?.mediaKey !== mediaKey;
    const frameChanged = previous?.frameFitKey !== frameFitKey;
    const animationModeChanged = previous?.animated !== animateStillImageActive;
    if (mediaChanged) {
      userAdjustedViewportRef.current = false;
    }
    const widthChange = previous ? Math.abs(width - previous.width) / Math.max(1, previous.width) : 1;
    const heightChange = previous ? Math.abs(height - previous.height) / Math.max(1, previous.height) : 1;
    const meaningfulSizeChange = Math.max(widthChange, heightChange) >= AUTO_FIT_SCALE_CHANGE_THRESHOLD;
    const cooldownElapsed = !previous || now - previous.lastFitAt >= AUTO_FIT_SCALE_COOLDOWN_MS;
    const shouldFit =
      !previous ||
      mediaChanged ||
      frameChanged ||
      animationModeChanged ||
      (meaningfulSizeChange && cooldownElapsed);

    if (!shouldFit) {
      return;
    }

    if (userAdjustedViewportRef.current) {
      autoFitRef.current = {
        mediaKey,
        frameFitKey,
        animated: animateStillImageActive,
        width,
        height,
        lastFitAt: previous?.lastFitAt ?? now
      };
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      fitToView();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    animateStillImageActive,
    fitToView,
    frameFitKey,
    grid,
    mediaKey,
    visibleCanvasHeight,
    visibleCanvasWidth
  ]);

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!grid) {
      return;
    }
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;
    const factor = event.deltaY > 0 ? 0.9 : 1.1;
    userAdjustedViewportRef.current = true;
    zoomAtPoint(localX, localY, (value) => value * factor);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerRef.current = {
      x: event.clientX,
      y: event.clientY,
      panX: pan.x,
      panY: pan.y,
      hasMoved: false
    };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointerRef.current) {
      return;
    }
    const deltaX = event.clientX - pointerRef.current.x;
    const deltaY = event.clientY - pointerRef.current.y;
    if (
      !pointerRef.current.hasMoved &&
      Math.hypot(deltaX, deltaY) >= PAN_ADJUST_THRESHOLD_PX
    ) {
      pointerRef.current.hasMoved = true;
      userAdjustedViewportRef.current = true;
    }
    setPan({
      x: pointerRef.current.panX + deltaX,
      y: pointerRef.current.panY + deltaY
    });
  };

  const handlePointerUp = () => {
    pointerRef.current = null;
  };

  const acceptDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    const files = Array.from(event.dataTransfer.files);
    const file =
      files.find(
        (item) =>
          item.type.startsWith("image/") || item.type.startsWith("video/") || mediaExtensionPattern.test(item.name)
      ) ?? files[0];
    if (file) {
      onMediaFile(file);
    }
  };

  return (
    <main className="relative h-full min-w-0 flex-1 overflow-hidden bg-ink">
      <div
        ref={viewportRef}
        className="relative h-full min-h-0 overflow-hidden bg-ink"
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDragOver={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={acceptDrop}
      >
        <div
          className="pointer-events-auto absolute right-6 top-6 z-20 flex items-center gap-2 rounded-2xl border border-white/[0.06] bg-panel p-2"
          onPointerDown={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
        >
          <IconButton title="Undo (Ctrl/Cmd+Z)" disabled={!undoStack.length} onClick={undo}>
            <Undo2 size={16} />
          </IconButton>
          <IconButton title="Redo (Ctrl/Cmd+Shift+Z)" disabled={!redoStack.length} onClick={redo}>
            <Redo2 size={16} />
          </IconButton>
          <IconButton title="Zoom out (Ctrl/Cmd+[)" onClick={() => userZoomFromCenter(1 / ZOOM_STEP)}>
            <Minus size={16} />
          </IconButton>
          <div className="min-w-14 text-center text-xs tabular-nums text-zinc-400">{Math.round(zoom * 100)}%</div>
          <IconButton title="Zoom in (Ctrl/Cmd+])" onClick={() => userZoomFromCenter(ZOOM_STEP)}>
            <Plus size={16} />
          </IconButton>
          <IconButton title="Fit Canvas (F)" onClick={fitToView}>
            <Maximize2 size={16} />
          </IconButton>
        </div>

        {videoPlayback.isVideo && (
          <div className="pointer-events-auto absolute inset-x-8 top-6 z-20 mx-auto flex max-w-3xl items-center gap-3 rounded-2xl border border-white/[0.06] bg-panel p-2">
            <IconButton title={videoPlayback.isPlaying ? "Pause video" : "Play video"} onClick={onToggleVideoPlayback}>
              {videoPlayback.isPlaying ? <Pause size={16} /> : <Play size={16} />}
            </IconButton>
            <input
              className="h-5 min-w-0 flex-1 cursor-pointer"
              type="range"
              min={0}
              max={Math.max(0.001, videoPlayback.duration)}
              step={0.01}
              value={Math.min(videoPlayback.currentTime, Math.max(0.001, videoPlayback.duration))}
              onChange={(event) => onVideoSeek(Number(event.target.value))}
            />
            <div className="min-w-28 text-right text-xs tabular-nums text-zinc-400">
              {formatTime(videoPlayback.currentTime)} / {formatTime(videoPlayback.duration)}
            </div>
          </div>
        )}

        {grid && (
          <motion.div
            className="absolute left-0 top-0 overflow-hidden rounded-xl border border-white/[0.06]"
            animate={{ opacity: 1 }}
            initial={{ opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            style={{
              width: visibleCanvasWidth,
              height: visibleCanvasHeight,
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: "0 0",
              willChange: "transform",
              transition: "transform 140ms ease-out"
            }}
          >
            <canvas
              ref={backgroundCanvasRef}
              className={`absolute inset-0 transition-[filter,opacity] duration-150 ${
                inlineFinalPreviewActive ? "hidden" : ""
              } ${
                font.smoothing ? "" : "[image-rendering:pixelated]"
              }`}
              style={{
                filter: livePreviewTransitioning ? "blur(1px)" : "none",
                opacity: livePreviewTransitioning ? 0.76 : 1
              }}
            />
            <canvas
              ref={glyphCanvasRef}
              className={`absolute inset-0 transition-[filter,opacity] duration-150 ${
                inlineFinalPreviewActive ? "hidden" : ""
              } ${
                font.smoothing ? "" : "[image-rendering:pixelated]"
              }`}
              style={{
                filter: livePreviewTransitioning ? "blur(1px)" : "none",
                opacity: livePreviewTransitioning ? 0.76 : 1
              }}
            />
            <canvas
              ref={tonePreviewCanvasRef}
              className={`pointer-events-none absolute inset-0 ${
                toneRangePreview && !inlineFinalPreviewActive ? "" : "hidden"
              }`}
            />
            <canvas
              ref={renderedPreviewCanvasRef}
              className={`absolute left-0 top-0 ${
                inlineFinalPreviewVisible ? "" : "hidden"
              } ${font.smoothing ? "" : "[image-rendering:pixelated]"}`}
              style={{
                width: finalPreviewWidth,
                height: finalPreviewHeight
              }}
            />
            {livePreviewTransitioning && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/20 backdrop-blur-[1px]">
                <div className="rounded-xl border border-white/[0.08] bg-black/45 px-3 py-2 text-xs font-medium text-zinc-200 shadow-xl">
                  {livePreviewStats?.phase === "updating" ? "Updating preview..." : livePreviewLabel}
                </div>
              </div>
            )}
            {inlineFinalPreviewActive && renderedPreview.status === "error" && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/35">
                <div className="mx-4 max-w-md rounded-2xl border border-red-400/30 bg-panel/95 p-4 text-center text-sm text-red-100 shadow-2xl">
                  {renderedPreview.error ?? "Final preview failed."}
                </div>
              </div>
            )}
          </motion.div>
        )}

        {inlineFinalPreviewRendering && (
          <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center px-6">
            <div
              className="pointer-events-auto w-[min(420px,calc(100vw-48px))] rounded-2xl border border-white/[0.08] bg-panel/95 p-5 text-sm shadow-2xl backdrop-blur"
              style={{ minWidth: "min(300px, calc(100vw - 48px))" }}
            >
              <div className="text-base font-semibold text-zinc-100">Rendering final preview...</div>
              <div className="mt-3 flex items-center justify-between gap-4 text-sm text-zinc-400">
                <span>
                  Frame {renderedPreviewRenderedFrames} of {renderedPreviewFrameCount}
                </span>
                <span className="tabular-nums text-zinc-300">{Math.round(renderedPreviewProgress * 100)}%</span>
              </div>
              <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className="h-full rounded-full bg-signal transition-[width] duration-150"
                  style={{ width: `${Math.round(renderedPreviewProgress * 100)}%` }}
                />
              </div>
              <button
                type="button"
                className="mt-5 h-10 rounded-xl border border-white/[0.08] bg-white/[0.045] px-4 text-sm font-semibold text-zinc-300 transition hover:border-white/[0.14] hover:bg-white/[0.075] hover:text-zinc-100"
                onClick={cancelRenderedPreview}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {grid && animateStillImageActive && (
          <div className="pointer-events-none absolute inset-x-4 bottom-6 z-20 flex justify-center">
            <div
              className="pointer-events-auto flex max-w-[calc(100vw-32px)] flex-wrap items-center justify-center gap-2 rounded-2xl border border-white/[0.06] bg-panel/95 p-2 shadow-2xl backdrop-blur"
              onPointerDown={(event) => event.stopPropagation()}
              onWheel={(event) => event.stopPropagation()}
            >
              {inlineFinalPreviewStatusVisible ? (
                <>
                  {(renderedPreview.status === "playing" || renderedPreview.status === "paused" || renderedPreview.status === "ready") && (
                    <button
                      type="button"
                      aria-label={renderedPreview.status === "playing" ? "Pause final preview" : "Play final preview"}
                      title={renderedPreview.status === "playing" ? "Pause final preview" : "Play final preview"}
                      className="grid h-10 w-10 place-items-center rounded-xl border border-white/[0.06] bg-white/[0.045] text-zinc-300 transition hover:border-white/[0.12] hover:bg-white/[0.075] hover:text-zinc-100"
                      onClick={renderedPreview.status === "playing" ? pauseRenderedPreview : resumeRenderedPreview}
                    >
                      {renderedPreview.status === "playing" ? <Pause size={16} /> : <Play size={16} />}
                    </button>
                  )}
                  {(renderedPreview.status === "playing" || renderedPreview.status === "paused" || renderedPreview.status === "ready") && (
                    <button
                      type="button"
                      className="grid h-10 w-10 place-items-center rounded-xl border border-white/[0.06] bg-white/[0.045] text-zinc-300 transition hover:border-white/[0.12] hover:bg-white/[0.075] hover:text-zinc-100"
                      title="Replay final preview"
                      onClick={replayRenderedPreview}
                    >
                      <RotateCcw size={16} />
                    </button>
                  )}
                  <div className="h-10 rounded-xl border border-white/[0.06] bg-black/20 px-3 text-xs leading-10 tabular-nums text-zinc-400">
                    {renderedPreview.status === "stale"
                      ? "Preview outdated - Render again"
                      : renderedPreview.status === "rendering"
                      ? `Rendering ${renderedPreviewFormatLabel} preview - Frame ${renderedPreviewRenderedFrames} of ${renderedPreviewFrameCount} - ${Math.round(renderedPreviewProgress * 100)}%`
                      : renderedPreview.status === "error"
                      ? "Final preview error"
                      : `Final preview - ${renderedPreviewFormatLabel} - ${renderedPreview.fps} fps - ${finalPreviewWidth}x${finalPreviewHeight}`}
                  </div>
                  {renderedPreviewCanUseCache && (
                    <div className="h-10 rounded-xl border border-signal/20 bg-signal/10 px-3 text-xs font-semibold leading-10 text-signal">
                      Ready to export
                    </div>
                  )}
                  {renderedPreview.status === "rendering" ? (
                    <button
                      type="button"
                      className="flex h-10 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.045] px-3 text-xs font-semibold text-zinc-300 transition hover:border-white/[0.14] hover:bg-white/[0.075] hover:text-zinc-100"
                      onClick={cancelRenderedPreview}
                    >
                      <X size={14} />
                      Cancel
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="flex h-10 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.045] px-3 text-xs font-semibold text-zinc-300 transition hover:border-white/[0.14] hover:bg-white/[0.075] hover:text-zinc-100"
                      onClick={backToLivePreview}
                    >
                      Back to Live
                    </button>
                  )}
                  {(renderedPreview.status === "stale" || renderedPreview.status === "error") && (
                    <button
                      type="button"
                      className="flex h-10 items-center gap-2 rounded-xl border border-signal/35 bg-signal/15 px-3 text-xs font-semibold text-signal transition-colors duration-150 hover:border-signal/55 hover:bg-signal/20"
                      onClick={() => {
                        void startRenderedPreview();
                      }}
                    >
                      <Play size={14} />
                      Render Again
                    </button>
                  )}
                </>
              ) : (
                <>
                  <button
                    type="button"
                    aria-label={livePreviewPaused ? "Play live preview" : "Pause live preview"}
                    title={livePreviewPaused ? "Play live preview" : "Pause live preview"}
                    className="grid h-10 w-10 place-items-center rounded-xl border border-white/[0.06] bg-white/[0.045] text-zinc-300 transition hover:border-white/[0.12] hover:bg-white/[0.075] hover:text-zinc-100"
                    onClick={() => setLivePreviewPlaying((playing) => !playing)}
                  >
                    {livePreviewPaused ? <Play size={16} /> : <Pause size={16} />}
                  </button>
                  <div
                    className={`h-10 rounded-xl border border-white/[0.06] bg-black/20 px-3 text-xs leading-10 tabular-nums ${
                      livePreviewStats?.isSlow && !livePreviewPaused && !visualEditPreviewActive
                        ? "text-amber-200/90"
                        : "text-zinc-400"
                    }`}
                    title="Live preview may scale down or skip frames to stay responsive. Preview Animation renders exact FPS."
                  >
                    {livePreviewLabel}
                  </div>
                  <label
                    className="flex h-10 items-center gap-2 rounded-xl border border-white/[0.06] bg-black/20 px-3 text-xs text-zinc-400"
                    title="Controls optimized live preview quality only. Exports and Preview Animation stay final quality."
                  >
                    <span className="whitespace-nowrap">Live Preview</span>
                    <select
                      className="h-7 rounded-lg border border-white/[0.06] bg-white/[0.045] px-2 text-xs font-semibold text-zinc-200 outline-none transition focus:border-signal/45"
                      value={livePreviewOptimizationLevel}
                      onChange={(event) => {
                        setLivePreviewOptimizationLevel(event.target.value as LivePreviewOptimizationLevel);
                      }}
                    >
                      {livePreviewOptimizationOptions.map((option) => (
                        <option key={option.value} value={option.value} className="bg-panel text-zinc-100">
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {canPreviewAnimation && (
                    <>
                      <label
                        className="flex h-10 items-center gap-2 rounded-xl border border-white/[0.06] bg-black/20 px-3 text-xs text-zinc-400"
                        title="Controls final preview cache compatibility and suggested export format. Frames render at final output quality."
                      >
                        <span className="whitespace-nowrap">Preview as</span>
                        <select
                          className="h-7 rounded-lg border border-white/[0.06] bg-white/[0.045] px-2 text-xs font-semibold text-zinc-200 outline-none transition focus:border-signal/45"
                          value={renderedPreview.previewFormat}
                          onChange={(event) => {
                            setAnimationPreviewFormat(event.target.value as AnimationPreviewFormat);
                          }}
                        >
                          {animationPreviewFormatOptions.map((option) => (
                            <option key={option.value} value={option.value} className="bg-panel text-zinc-100">
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        className="flex h-10 items-center gap-2 rounded-xl border border-signal/35 bg-signal/15 px-3 text-xs font-semibold text-signal transition-colors duration-150 hover:border-signal/55 hover:bg-signal/20 disabled:cursor-not-allowed disabled:opacity-45"
                        disabled={renderedPreview.status === "rendering"}
                        onClick={() => {
                          void startRenderedPreview();
                        }}
                      >
                        <Play size={14} />
                        Preview Animation
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {!grid && (
          <div className="absolute inset-0 grid place-items-center p-8">
            <div className="w-full max-w-md rounded-2xl border border-white/[0.06] bg-panel p-5 text-center text-sm text-zinc-400">
              <div className="font-semibold text-zinc-200">
                {isProcessing ? "Building preview..." : "Drag and drop an image here, or upload from the top-left button."}
              </div>
              {!isProcessing && (
                <div className="mt-2 text-xs leading-5 text-zinc-500">
                  Supports PNG, JPG, WebP, MP4, and WebM.
                </div>
              )}
              {rendererWarning && (
                <div className="mt-3 text-xs leading-5 text-ember/80">{rendererWarning}</div>
              )}
            </div>
          </div>
        )}

        {dragActive && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="pointer-events-none absolute inset-6 z-30 rounded-2xl border border-signal/45 bg-signal/10"
          />
        )}
      </div>
    </main>
  );
};
