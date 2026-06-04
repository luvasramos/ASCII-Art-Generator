import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Maximize2, Minus, Pause, Play, Plus, Redo2, Undo2 } from "lucide-react";
import { createGlyphAtlas } from "../atlas/glyphAtlas";
import { createImageGlyphAtlas, type ImageGlyphAtlas } from "../atlas/imageGlyphAtlas";
import { normalizeCharacterSet } from "../ascii/charset";
import { getTonalRangeWeight } from "../luminance/adjustments";
import type { AnimatedImageRenderer } from "../processing/animateImage";
import { renderAsciiLayers } from "../renderer/layeredCanvasRenderer";
import { scaleFontForRenderResolution } from "../renderer/geometry";
import { useAnimatedAsciiPreview } from "../renderer/useAnimatedAsciiPreview";
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
  animateStillImageActive: boolean;
  onAnimationPerformanceWarning: (message: string) => void;
  toneRangePreview: ToneRangePreview | null;
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

const clampZoom = (value: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));

export const StudioCanvas = ({
  grid,
  mediaKey,
  font,
  ascii,
  color,
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
  animateStillImageActive,
  onAnimationPerformanceWarning,
  toneRangePreview
}: StudioCanvasProps) => {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const backgroundCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const glyphCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const tonePreviewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fittedMediaKeyRef = useRef<string | null>(null);
  const fittedFrameKeyRef = useRef<string | null>(null);
  const pendingFrameFitKeyRef = useRef<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragActive, setDragActive] = useState(false);
  const [imageGlyphAtlas, setImageGlyphAtlas] = useState<ImageGlyphAtlas | null>(null);
  const pointerRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const { undoStack, redoStack, undo, redo } = useStudioStore();

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
    const nextZoom = clampZoom(Math.min(availableWidth / grid.width, availableHeight / grid.height));
    setZoom(nextZoom);
    setPan({
      x: reservedLeft + (availableWidth - grid.width * nextZoom) / 2,
      y: (rect.height - grid.height * nextZoom) / 2
    });
  }, [grid]);

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
    renderer: animatedImageRenderer,
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
    onPerformanceWarning: onAnimationPerformanceWarning
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
      fittedMediaKeyRef.current = null;
      return;
    }
    if (fittedMediaKeyRef.current !== mediaKey) {
      fitToView();
      fittedMediaKeyRef.current = mediaKey;
    }
  }, [fitToView, grid, mediaKey]);

  useEffect(() => {
    if (fittedFrameKeyRef.current !== frameFitKey) {
      pendingFrameFitKeyRef.current = frameFitKey;
    }
  }, [frameFitKey]);

  useEffect(() => {
    if (!grid || !pendingFrameFitKeyRef.current) {
      return;
    }
    const fitKey = pendingFrameFitKeyRef.current;
    const frame = window.requestAnimationFrame(() => {
      fitToView();
      fittedFrameKeyRef.current = fitKey;
      if (pendingFrameFitKeyRef.current === fitKey) {
        pendingFrameFitKeyRef.current = null;
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [fitToView, grid?.computedAt, grid]);

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
              width: grid.width,
              height: grid.height,
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

        {!grid && (
          <div className="absolute inset-0 grid place-items-center p-8">
            {(isProcessing || rendererWarning) && (
              <div className="w-full max-w-sm rounded-2xl border border-white/[0.06] bg-panel p-4 text-center text-xs text-zinc-400">
                {isProcessing && <div className="font-semibold text-zinc-300">Building preview...</div>}
                {rendererWarning && <div className="mt-2 text-ember">{rendererWarning}</div>}
              </div>
            )}
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
