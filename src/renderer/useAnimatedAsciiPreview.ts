import { useEffect, useRef, type RefObject } from "react";
import { normalizeCharacterSet } from "../ascii/charset";
import { createGlyphAtlas, type GlyphAtlas } from "../atlas/glyphAtlas";
import type { ImageGlyphAtlas } from "../atlas/imageGlyphAtlas";
import type { AnimatedImageRenderer } from "../processing/animateImage";
import { generateRenderGrid } from "../processing/renderGrid";
import { resolveAnimatedProcessingSettings } from "./animationEffects";
import { resolvePreviewAnimationTiming } from "./animationTiming";
import {
  compositeEchoFrame,
  createEchoFrameHistory,
  isEchoActive,
  pushEchoFrame,
  resetEchoFrameHistory
} from "./echoComposite";
import { scaleFontForRenderResolution } from "./geometry";
import { renderAsciiLayers } from "./layeredCanvasRenderer";
import type {
  AnimationSettings,
  AnimationPreviewResolution,
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

interface AnimatedAsciiPreviewArgs {
  active: boolean;
  renderer: AnimatedImageRenderer | null;
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
}

const previewResolutionScales: Record<AnimationPreviewResolution, number> = {
  low: 0.35,
  medium: 0.5,
  high: 0.75,
  full: 1
};

const createPreviewClockKey = (animation: AnimationSettings) =>
  [
    animation.type,
    animation.fps,
    animation.trueFpsPreview ? "true" : "free",
    animation.previewFps,
    animation.previewResolution
  ].join(":");

const createPreviewGridGeometry = (baseGrid: RenderGrid, scale: number): RenderGrid => {
  if (scale >= 0.999) {
    return baseGrid;
  }

  const width = Math.max(1, Math.round(baseGrid.width * scale));
  const height = Math.max(1, Math.round(baseGrid.height * scale));
  const columns = Math.max(1, Math.round(baseGrid.columns * scale));
  const rows = Math.max(1, Math.round(baseGrid.rows * scale));
  const gapRatioX = baseGrid.cellWidth > 0 ? baseGrid.gapX / baseGrid.cellWidth : 0;
  const gapRatioY = baseGrid.cellHeight > 0 ? baseGrid.gapY / baseGrid.cellHeight : 0;
  const cellWidth = width / Math.max(1, columns + Math.max(0, columns - 1) * gapRatioX);
  const cellHeight = height / Math.max(1, rows + Math.max(0, rows - 1) * gapRatioY);

  return {
    ...baseGrid,
    cells: [],
    columns,
    rows,
    cellWidth,
    cellHeight,
    gapX: cellWidth * gapRatioX,
    gapY: cellHeight * gapRatioY,
    width,
    height
  };
};

const preparePreviewCanvas = (canvas: HTMLCanvasElement, width: number, height: number) => {
  if (canvas.width !== width) {
    canvas.width = width;
  }
  if (canvas.height !== height) {
    canvas.height = height;
  }
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
};

const copyPreviewCanvasFrame = (
  targetCanvas: HTMLCanvasElement,
  sourceCanvas: HTMLCanvasElement,
  width: number,
  height: number
) => {
  preparePreviewCanvas(targetCanvas, width, height);
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

const createPreviewResourceKey = (
  scale: number,
  grid: RenderGrid,
  font: FontSettings,
  ascii: AsciiSettings
) =>
  [
    scale.toFixed(3),
    grid.columns,
    grid.rows,
    grid.cellWidth.toFixed(4),
    grid.cellHeight.toFixed(4),
    grid.gapX.toFixed(4),
    grid.gapY.toFixed(4),
    font.family,
    font.size,
    font.weight,
    font.lineHeight,
    font.letterSpacing,
    ascii.charset,
    ascii.characterScale,
    ascii.renderResolution
  ].join("|");

export const useAnimatedAsciiPreview = ({
  active,
  renderer,
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
  onPerformanceWarning
}: AnimatedAsciiPreviewArgs) => {
  const latestRef = useRef({
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
    onPerformanceWarning
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
  const previewResourcesRef = useRef<{ key: string; atlas: GlyphAtlas; font: FontSettings } | null>(null);

  useEffect(() => {
    latestRef.current = {
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
      onPerformanceWarning
    };
  }, [
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
    onPerformanceWarning
  ]);

  useEffect(() => {
    if (!active) {
      wasActiveRef.current = false;
      resetEchoFrameHistory(echoHistoryRef.current);
      return;
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
    renderer,
    animation.type,
    animation.fps,
    animation.previewFps,
    animation.previewResolution,
    animation.trueFpsPreview
  ]);

  useEffect(() => {
    const backgroundCanvas = backgroundCanvasRef.current;
    const glyphCanvas = glyphCanvasRef.current;

    if (!active || !renderer || !backgroundCanvas || !glyphCanvas) {
      return undefined;
    }

    let frameHandle = 0;
    let cancelled = false;
    let renderedFrames = 0;
    let accumulatedRenderMs = 0;
    let warned = false;
    let lastRenderedPreviewFrameIndex = -1;
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
          resetEchoFrameHistory(echoHistoryRef.current);
        }

        const elapsedSeconds = (now - clockRef.current.startedAt) / 1000;
        const timing = resolvePreviewAnimationTiming({
          elapsedSeconds,
          exportFps: latest.animation.fps,
          previewFps: latest.animation.previewFps,
          deterministic: latest.animation.trueFpsPreview
        });
        if (timing.previewFrameIndex === lastRenderedPreviewFrameIndex) {
          frameHandle = window.requestAnimationFrame(renderFrame);
          return;
        }
        lastRenderedPreviewFrameIndex = timing.previewFrameIndex;

        const timeSeconds = timing.animationTimeSeconds;
        const previewScale = previewResolutionScales[latest.animation.previewResolution] ?? 1;
        const previewGridGeometry = createPreviewGridGeometry(latest.baseGrid, previewScale);
        let previewAtlas = latest.atlas;
        let previewFont = latest.font;
        if (previewScale < 0.999) {
          const previewResourceKey = createPreviewResourceKey(previewScale, previewGridGeometry, latest.font, latest.ascii);
          if (previewResourcesRef.current?.key !== previewResourceKey) {
            const renderFont = scaleFontForRenderResolution(latest.font, latest.ascii.renderResolution);
            const scaledFont: FontSettings = {
              ...renderFont,
              size: Math.max(1, renderFont.size * previewScale),
              letterSpacing: renderFont.letterSpacing * previewScale
            };
            previewResourcesRef.current = {
              key: previewResourceKey,
              atlas: createGlyphAtlas(
                normalizeCharacterSet(latest.ascii.charset),
                scaledFont,
                previewGridGeometry.cellWidth,
                previewGridGeometry.cellHeight,
                latest.ascii.characterScale
              ),
              font: scaledFont
            };
          }
          previewAtlas = previewResourcesRef.current.atlas;
          previewFont = previewResourcesRef.current.font;
        }

        const imageData = renderer.render(latest.animation, timeSeconds);
        const animatedSettings = resolveAnimatedProcessingSettings(
          latest.image,
          latest.frame,
          latest.breakup,
          latest.animation,
          timeSeconds
        );
        const baseOptions = {
          columns: previewGridGeometry.columns,
          rows: previewGridGeometry.rows,
          cellWidth: previewGridGeometry.cellWidth,
          cellHeight: previewGridGeometry.cellHeight,
          gapX: previewGridGeometry.gapX,
          gapY: previewGridGeometry.gapY,
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
        const animatedGrid = generateRenderGrid(imageData, options);
        renderAsciiLayers({
          backgroundCanvas: temporaryBackgroundCanvas,
          glyphCanvas: temporaryGlyphCanvas,
          grid: animatedGrid,
          atlas: previewAtlas,
          imageGlyphAtlas: latest.imageGlyphAtlas,
          font: previewFont,
          ascii: latest.ascii,
          color: latest.color,
          animation: latest.animation,
          animationTimeSeconds: timeSeconds,
          glyphMetrics: latest.glyphMetrics
        });

        const outputWidth = Math.max(1, Math.round(latest.baseGrid.width));
        const outputHeight = Math.max(1, Math.round(latest.baseGrid.height));
        if (isEchoActive(latest.animation)) {
          copyPreviewCanvasFrame(backgroundCanvas, temporaryBackgroundCanvas, outputWidth, outputHeight);
          compositeEchoFrame({
            targetCanvas: temporaryEchoCanvas,
            currentLayerCanvas: temporaryGlyphCanvas,
            history: echoHistoryRef.current,
            animation: latest.animation
          });
          copyPreviewCanvasFrame(glyphCanvas, temporaryEchoCanvas, outputWidth, outputHeight);
          pushEchoFrame(echoHistoryRef.current, temporaryGlyphCanvas, latest.animation);
        } else {
          resetEchoFrameHistory(echoHistoryRef.current);
          copyPreviewCanvasFrame(backgroundCanvas, temporaryBackgroundCanvas, outputWidth, outputHeight);
          copyPreviewCanvasFrame(glyphCanvas, temporaryGlyphCanvas, outputWidth, outputHeight);
        }
      } catch (error) {
        latestRef.current.onPerformanceWarning?.(error instanceof Error ? error.message : "Animated preview failed.");
        return;
      }

      const renderMs = performance.now() - renderStartedAt;
      renderedFrames += 1;
      accumulatedRenderMs += renderMs;
      if (!warned && renderedFrames >= 45 && accumulatedRenderMs / renderedFrames > 30) {
        warned = true;
        latestRef.current.onPerformanceWarning?.("Animation preview quality reduced for performance on this image/settings.");
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
    renderer,
    backgroundCanvasRef,
    glyphCanvasRef
  ]);
};
