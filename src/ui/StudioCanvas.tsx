import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Download, Maximize2, Minus, Pause, Play, Plus, Redo2, RotateCcw, Undo2, X } from "lucide-react";
import { createGlyphAtlas } from "../atlas/glyphAtlas";
import { createImageGlyphAtlas, type ImageGlyphAtlas } from "../atlas/imageGlyphAtlas";
import { normalizeCharacterSet } from "../ascii/charset";
import { getTonalRangeWeight } from "../luminance/adjustments";
import type { AnimatedImageRenderer } from "../processing/animateImage";
import { renderAsciiLayers } from "../renderer/layeredCanvasRenderer";
import { scaleFontForRenderResolution } from "../renderer/geometry";
import { normalizeAnimationFps } from "../renderer/animationTiming";
import { useAnimatedAsciiPreview, type LivePreviewStats } from "../renderer/useAnimatedAsciiPreview";
import { useRenderedAnimationPlayback } from "../renderer/useRenderedAnimationPlayback";
import { useRenderedAnimationPreview } from "../renderer/useRenderedAnimationPreview";
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
  RenderGrid,
  RenderedPreviewQuality,
  RenderedPreviewState,
  ToneRangePreview,
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
  status: string;
  onMediaFile: (file: File) => void;
  videoPlayback: VideoPlaybackState;
  onToggleVideoPlayback: () => void;
  onVideoSeek: (time: number) => void;
  animatedImageRenderer: AnimatedImageRenderer | null;
  livePreviewSourceImageData?: ImageData | null;
  animateStillImageActive: boolean;
  onAnimationPerformanceWarning: (message: string) => void;
  toneRangePreview: ToneRangePreview | null;
  onExportAnimation?: () => void;
  isExportingVideo?: boolean;
  videoExportProgress?: number;
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

const clampZoom = (value: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));

const waitForBrowserFrame = () =>
  new Promise<void>((resolve) => {
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => resolve());
      return;
    }
    globalThis.setTimeout(resolve, 0);
  });

const renderedPreviewQualityLabel = (quality: RenderedPreviewQuality) =>
  quality === "fast" ? "Fast" : quality === "final" ? "Final Quality" : "Balanced";

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
        ? `Rendering frame ${completedFrames} / ${frameCount} · ${qualityLabel}`
        : `Rendering preview · ${qualityLabel}`;
    case "ready":
      return `Preview ready · ${qualityLabel}`;
    case "playing":
      return `Playing at ${preview.fps} fps · ${qualityLabel}`;
    case "paused":
      return `Paused · ${qualityLabel}`;
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
  grid: RenderGrid | null
) => {
  const previewWidth = Math.max(1, Math.round(stats?.previewWidth ?? grid?.width ?? 1));
  const previewHeight = Math.max(1, Math.round(stats?.previewHeight ?? grid?.height ?? 1));
  const outputWidth = Math.max(1, Math.round(stats?.outputWidth ?? grid?.width ?? 1));
  const outputHeight = Math.max(1, Math.round(stats?.outputHeight ?? grid?.height ?? 1));
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
  const sizeText = `${cacheText}Preview ${previewWidth}x${previewHeight}${sourceText}${stripText} - Output ${outputWidth}x${outputHeight}`;
  if (!active) {
    return "Live Preview";
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
  status,
  onMediaFile,
  videoPlayback,
  onToggleVideoPlayback,
  onVideoSeek,
  animatedImageRenderer,
  livePreviewSourceImageData = null,
  animateStillImageActive,
  onAnimationPerformanceWarning,
  toneRangePreview,
  onExportAnimation,
  isExportingVideo = false,
  videoExportProgress = 0
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
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragActive, setDragActive] = useState(false);
  const [renderedPreviewOpen, setRenderedPreviewOpen] = useState(false);
  const [livePreviewStats, setLivePreviewStats] = useState<LivePreviewStats | null>(null);
  const [livePreviewPlaying, setLivePreviewPlaying] = useState(true);
  const [imageGlyphAtlas, setImageGlyphAtlas] = useState<ImageGlyphAtlas | null>(null);
  const pointerRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const { undoStack, redoStack, undo, redo, renderedPreview, markRenderedPreviewStale } = useStudioStore();
  const canPreviewAnimation = animateStillImageActive && Boolean(animatedImageRenderer) && Boolean(grid);
  const renderedPreviewProgress = Math.min(1, Math.max(0, renderedPreview.progress));
  const renderedPreviewFrameCount = Math.max(0, renderedPreview.frameCount);
  const renderedPreviewRenderedFrames = getRenderedPreviewCompletedFrameCount(renderedPreview);
  const renderedPreviewLabel = renderedPreviewStatusText(renderedPreview);
  const renderedPreviewCanUseCache =
    Boolean(renderedPreview.cacheKey) &&
    renderedPreview.frameCount > 0 &&
    (renderedPreview.status === "ready" || renderedPreview.status === "playing" || renderedPreview.status === "paused");
  const canExportFromRenderedPreview =
    Boolean(onExportAnimation) &&
    renderedPreviewCanUseCache;
  const livePreviewPaused = animateStillImageActive && !livePreviewPlaying;
  const livePreviewTargetFps = normalizeAnimationFps(animation.fps);
  const livePreviewLabel = livePreviewStatusText(
    animateStillImageActive,
    livePreviewPaused,
    livePreviewTargetFps,
    livePreviewStats,
    grid
  );
  const visibleCanvasWidth = grid
    ? animateStillImageActive
      ? Math.max(1, Math.round(livePreviewStats?.previewWidth ?? grid.width))
      : grid.width
    : 1;
  const visibleCanvasHeight = grid
    ? animateStillImageActive
      ? Math.max(1, Math.round(livePreviewStats?.previewHeight ?? grid.height))
      : grid.height
    : 1;

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
    quality: renderedPreview.quality
  });
  const {
    play: playRenderedPreview,
    pause: pauseRenderedPreview,
    stop: stopRenderedPreview
  } = useRenderedAnimationPlayback({
    canvasRef: renderedPreviewCanvasRef,
    loop: true
  });

  const startRenderedPreview = useCallback(async () => {
    if (!canPreviewAnimation) {
      return;
    }
    setRenderedPreviewOpen(true);
    stopRenderedPreview();
    await waitForBrowserFrame();
    const cache = await generateRenderedPreview();
    if (cache) {
      await waitForBrowserFrame();
      playRenderedPreview({ restart: true });
    }
  }, [canPreviewAnimation, generateRenderedPreview, playRenderedPreview, stopRenderedPreview]);

  const closeRenderedPreview = useCallback(() => {
    if (renderedPreview.status === "rendering") {
      cancelRenderedPreviewRender();
    }
    stopRenderedPreview();
    setRenderedPreviewOpen(false);
  }, [cancelRenderedPreviewRender, renderedPreview.status, stopRenderedPreview]);

  const cancelRenderedPreview = useCallback(() => {
    cancelRenderedPreviewRender();
    stopRenderedPreview();
    setRenderedPreviewOpen(false);
  }, [cancelRenderedPreviewRender, stopRenderedPreview]);

  const replayRenderedPreview = useCallback(() => {
    playRenderedPreview({ restart: true });
  }, [playRenderedPreview]);

  const resumeRenderedPreview = useCallback(() => {
    playRenderedPreview();
  }, [playRenderedPreview]);

  const exportRenderedPreviewAnimation = useCallback(() => {
    if (!canExportFromRenderedPreview || isExportingVideo) {
      return;
    }
    onExportAnimation?.();
  }, [canExportFromRenderedPreview, isExportingVideo, onExportAnimation]);

  const handleLivePreviewStats = useCallback((stats: LivePreviewStats | null) => {
    setLivePreviewStats(stats);
  }, []);

  useEffect(() => {
    setLivePreviewPlaying(true);
  }, [
    animateStillImageActive,
    mediaKey,
    animation.type
  ]);

  useEffect(() => {
    if (!animateStillImageActive) {
      setLivePreviewStats(null);
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
  }, [grid, visibleCanvasHeight, visibleCanvasWidth]);

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
        zoomFromCenter(ZOOM_STEP);
      } else if (event.key === "[") {
        event.preventDefault();
        zoomFromCenter(1 / ZOOM_STEP);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [fitToView, zoomFromCenter]);

  useEffect(() => {
    if (
      animateStillImageActive ||
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
      color
    });
  }, [animateStillImageActive, ascii, atlas, color, font, grid, imageGlyphAtlas]);

  useAnimatedAsciiPreview({
    active: animateStillImageActive,
    paused: livePreviewPaused,
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
    glyphMetrics,
    onPerformanceWarning: onAnimationPerformanceWarning,
    onLivePreviewStats: handleLivePreviewStats
  });

  useEffect(() => {
    const canvas = tonePreviewCanvasRef.current;
    if (!canvas || !grid || !toneRangePreview) {
      return;
    }

    const width = Math.max(1, Math.ceil(grid.width));
    const height = Math.max(1, Math.ceil(grid.height));
    if (canvas.width !== width) {
      canvas.width = width;
    }
    if (canvas.height !== height) {
      canvas.height = height;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "rgba(0, 0, 0, 0.72)";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#ffffff";

    const stepX = grid.cellWidth + grid.gapX;
    const stepY = grid.cellHeight + grid.gapY;
    const cellWidth = grid.gapX > 0 ? grid.cellWidth : grid.cellWidth + 0.5;
    const cellHeight = grid.gapY > 0 ? grid.cellHeight : grid.cellHeight + 0.5;

    for (const cell of grid.cells) {
      if (cell.alpha <= 0.01 || cell.coverage <= 0.01) {
        continue;
      }
      const tonalLuminance = image.invertTone ? 1 - cell.luminance : cell.luminance;
      const weight = getTonalRangeWeight(tonalLuminance, toneRangePreview, image);
      if (weight <= 0.004) {
        continue;
      }
      ctx.globalAlpha = Math.min(1, weight * Math.min(1, cell.alpha * 1.15));
      ctx.fillRect(
        grid.gapX > 0 ? cell.x * stepX : Math.round(cell.x * stepX),
        grid.gapY > 0 ? cell.y * stepY : Math.round(cell.y * stepY),
        grid.gapX > 0 ? cellWidth : Math.ceil(cellWidth),
        grid.gapY > 0 ? cellHeight : Math.ceil(cellHeight)
      );
    }
    ctx.globalAlpha = 1;
  }, [grid, image, toneRangePreview]);

  useEffect(() => {
    if (!grid) {
      autoFitRef.current = null;
      return;
    }

    const width = Math.max(1, Math.round(visibleCanvasWidth));
    const height = Math.max(1, Math.round(visibleCanvasHeight));
    const previous = autoFitRef.current;
    const now = performance.now();
    const mediaChanged = previous?.mediaKey !== mediaKey;
    const frameChanged = previous?.frameFitKey !== frameFitKey;
    const animationModeChanged = previous?.animated !== animateStillImageActive;
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

    const frame = window.requestAnimationFrame(() => {
      fitToView();
      autoFitRef.current = {
        mediaKey,
        frameFitKey,
        animated: animateStillImageActive,
        width,
        height,
        lastFitAt: performance.now()
      };
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
    zoomAtPoint(localX, localY, (value) => value * factor);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerRef.current = {
      x: event.clientX,
      y: event.clientY,
      panX: pan.x,
      panY: pan.y
    };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointerRef.current) {
      return;
    }
    setPan({
      x: pointerRef.current.panX + event.clientX - pointerRef.current.x,
      y: pointerRef.current.panY + event.clientY - pointerRef.current.y
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
          <IconButton title="Zoom out (Ctrl/Cmd+[)" onClick={() => zoomFromCenter(1 / ZOOM_STEP)}>
            <Minus size={16} />
          </IconButton>
          <div className="min-w-14 text-center text-xs tabular-nums text-zinc-400">{Math.round(zoom * 100)}%</div>
          <IconButton title="Zoom in (Ctrl/Cmd+])" onClick={() => zoomFromCenter(ZOOM_STEP)}>
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
              className={`absolute inset-0 ${font.smoothing ? "" : "[image-rendering:pixelated]"}`}
            />
            <canvas
              ref={glyphCanvasRef}
              className={`absolute inset-0 ${font.smoothing ? "" : "[image-rendering:pixelated]"}`}
            />
            {toneRangePreview && (
              <canvas
                ref={tonePreviewCanvasRef}
                className="pointer-events-none absolute inset-0"
              />
            )}
          </motion.div>
        )}

        {grid && animateStillImageActive && (
          <div className="pointer-events-none absolute inset-x-4 bottom-6 z-20 flex justify-center">
            <div
              className="pointer-events-auto flex max-w-[calc(100vw-32px)] flex-wrap items-center justify-center gap-2 rounded-2xl border border-white/[0.06] bg-panel/95 p-2 shadow-2xl backdrop-blur"
              onPointerDown={(event) => event.stopPropagation()}
              onWheel={(event) => event.stopPropagation()}
            >
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
                  livePreviewStats?.isSlow && !livePreviewPaused ? "text-amber-200/90" : "text-zinc-400"
                }`}
                title="Live preview may scale down or skip frames to stay responsive. Preview Animation renders exact FPS."
              >
                {livePreviewLabel}
              </div>
              {canPreviewAnimation && (
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

        {renderedPreviewOpen && (
          <div className="fixed inset-0 z-[120] grid place-items-center bg-black/70 p-6 backdrop-blur-sm">
            <motion.div
              className="flex max-h-[calc(100vh-48px)] w-[min(960px,calc(100vw-48px))] flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-panel shadow-2xl"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.16, ease: "easeOut" }}
              onPointerDown={(event) => event.stopPropagation()}
              onWheel={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-4 border-b border-white/[0.06] px-5 py-4">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-zinc-100">Animation Preview</h2>
                  <div className="mt-1 text-xs text-zinc-400">{renderedPreviewLabel}</div>
                </div>
                <button
                  type="button"
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/[0.06] bg-white/[0.045] text-zinc-300 transition hover:border-white/[0.12] hover:bg-white/[0.075] hover:text-zinc-100"
                  title="Close"
                  aria-label="Close animation preview"
                  onClick={closeRenderedPreview}
                >
                  <X size={16} />
                </button>
              </div>

              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
                <div className="relative grid min-h-[260px] place-items-center overflow-hidden rounded-xl border border-white/[0.06] bg-black/35 p-3">
                  <canvas
                    ref={renderedPreviewCanvasRef}
                    className={`block h-auto max-h-[58vh] max-w-full object-contain ${font.smoothing ? "" : "[image-rendering:pixelated]"}`}
                  />
                  {(renderedPreview.status === "idle" || renderedPreview.status === "rendering") && (
                    <div className="pointer-events-none absolute text-xs text-zinc-500">
                      {renderedPreview.status === "rendering" ? "Rendering..." : "Ready"}
                    </div>
                  )}
                </div>

                {renderedPreview.status === "rendering" && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3 text-xs text-zinc-400">
                      <span>
                        Rendering frame {renderedPreviewRenderedFrames} / {renderedPreviewFrameCount}
                      </span>
                      <span>{Math.round(renderedPreviewProgress * 100)}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-black/40">
                      <div
                        className="h-full rounded-full bg-signal transition-all duration-150"
                        style={{ width: `${Math.round(renderedPreviewProgress * 100)}%` }}
                      />
                    </div>
                  </div>
                )}

                {renderedPreview.status === "error" && (
                  <div className="rounded-xl border border-ember/25 bg-ember/10 px-3 py-2 text-xs leading-5 text-ember">
                    {renderedPreview.error ?? "Rendered preview failed."}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-white/[0.06] px-5 py-4">
                {canExportFromRenderedPreview && (
                  <div className="min-w-[220px] flex-1 text-xs leading-5 text-zinc-500">
                    Export uses final export settings, not cached preview frames.
                    {isExportingVideo && (
                      <div className="mt-2 flex items-center gap-2">
                        <div className="h-1.5 min-w-24 flex-1 overflow-hidden rounded-full bg-black/40">
                          <div
                            className="h-full rounded-full bg-signal transition-all duration-150"
                            style={{ width: `${Math.round(Math.min(1, Math.max(0, videoExportProgress)) * 100)}%` }}
                          />
                        </div>
                        <span className="tabular-nums">{Math.round(Math.min(1, Math.max(0, videoExportProgress)) * 100)}%</span>
                      </div>
                    )}
                  </div>
                )}
                {renderedPreview.status === "rendering" && (
                  <button
                    type="button"
                    className="flex h-10 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.055] px-4 text-sm font-semibold text-zinc-200 transition hover:bg-white/[0.085] hover:text-zinc-50"
                    onClick={cancelRenderedPreview}
                  >
                    <X size={15} />
                    Cancel
                  </button>
                )}
                {renderedPreview.status === "playing" && (
                  <button
                    type="button"
                    className="flex h-10 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.055] px-4 text-sm font-semibold text-zinc-200 transition hover:bg-white/[0.085] hover:text-zinc-50"
                    onClick={pauseRenderedPreview}
                  >
                    <Pause size={15} />
                    Pause
                  </button>
                )}
                {renderedPreview.status === "paused" && (
                  <button
                    type="button"
                    className="flex h-10 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.055] px-4 text-sm font-semibold text-zinc-200 transition hover:bg-white/[0.085] hover:text-zinc-50"
                    onClick={resumeRenderedPreview}
                  >
                    <Play size={15} />
                    Play
                  </button>
                )}
                {(renderedPreview.status === "ready" || renderedPreview.status === "paused" || renderedPreview.status === "playing") && (
                  <button
                    type="button"
                    className="flex h-10 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.055] px-4 text-sm font-semibold text-zinc-200 transition hover:bg-white/[0.085] hover:text-zinc-50"
                    onClick={replayRenderedPreview}
                  >
                    <RotateCcw size={15} />
                    Replay
                  </button>
                )}
                {canExportFromRenderedPreview && (
                  <button
                    type="button"
                    className="flex h-10 items-center gap-2 rounded-xl border border-signal/35 bg-signal/15 px-4 text-sm font-semibold text-signal transition hover:border-signal/55 hover:bg-signal/20 disabled:cursor-not-allowed disabled:opacity-45"
                    disabled={isExportingVideo}
                    onClick={exportRenderedPreviewAnimation}
                  >
                    <Download size={15} />
                    {isExportingVideo ? "Exporting..." : "Export Animation"}
                  </button>
                )}
                {(renderedPreview.status === "stale" || renderedPreview.status === "error" || renderedPreview.status === "idle") && (
                  <button
                    type="button"
                    className="flex h-10 items-center gap-2 rounded-xl border border-signal/35 bg-signal/15 px-4 text-sm font-semibold text-signal transition hover:border-signal/55 hover:bg-signal/20 disabled:cursor-not-allowed disabled:opacity-45"
                    disabled={!canPreviewAnimation}
                    onClick={() => {
                      void startRenderedPreview();
                    }}
                  >
                    <RotateCcw size={15} />
                    {renderedPreview.status === "stale" ? "Render Again" : "Render Preview"}
                  </button>
                )}
                <button
                  type="button"
                  className="flex h-10 items-center gap-2 rounded-xl border border-white/[0.08] bg-transparent px-4 text-sm font-semibold text-zinc-300 transition hover:bg-white/[0.055] hover:text-zinc-100"
                  onClick={closeRenderedPreview}
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </div>
    </main>
  );
};
