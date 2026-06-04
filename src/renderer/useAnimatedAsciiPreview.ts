import { useEffect, useRef, type RefObject } from "react";
import type { GlyphAtlas } from "../atlas/glyphAtlas";
import type { ImageGlyphAtlas } from "../atlas/imageGlyphAtlas";
import type { AnimatedImageRenderer } from "../processing/animateImage";
import { generateRenderGrid } from "../processing/renderGrid";
import { resolveAnimatedProcessingSettings } from "./animationEffects";
import {
  compositeEchoFrame,
  copyCanvasFrame,
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
  const clockRef = useRef<{ startedAt: number; renderer: AnimatedImageRenderer | null; type: AnimationSettings["type"] | null }>({
    startedAt: 0,
    renderer: null,
    type: null
  });
  const wasActiveRef = useRef(false);
  const echoHistoryRef = useRef(createEchoFrameHistory());
  const temporaryBackgroundCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const temporaryGlyphCanvasRef = useRef<HTMLCanvasElement | null>(null);

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
    if (!wasActiveRef.current || clockRef.current.renderer !== renderer || clockRef.current.type !== animation.type) {
      clockRef.current = {
        startedAt: performance.now(),
        renderer,
        type: animation.type
      };
      resetEchoFrameHistory(echoHistoryRef.current);
    }
    wasActiveRef.current = true;
  }, [active, renderer, animation.type]);

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
    if (!clockRef.current.startedAt) {
      clockRef.current.startedAt = performance.now();
    }

    const temporaryBackgroundCanvas = temporaryBackgroundCanvasRef.current ?? document.createElement("canvas");
    const temporaryGlyphCanvas = temporaryGlyphCanvasRef.current ?? document.createElement("canvas");
    temporaryBackgroundCanvasRef.current = temporaryBackgroundCanvas;
    temporaryGlyphCanvasRef.current = temporaryGlyphCanvas;

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
        const timeSeconds = (now - clockRef.current.startedAt) / 1000;
        const imageData = renderer.render(latest.animation, timeSeconds);
        const animatedSettings = resolveAnimatedProcessingSettings(
          latest.image,
          latest.frame,
          latest.breakup,
          latest.animation,
          timeSeconds
        );
        const baseOptions = {
          columns: latest.baseGrid.columns,
          rows: latest.baseGrid.rows,
          cellWidth: latest.baseGrid.cellWidth,
          cellHeight: latest.baseGrid.cellHeight,
          gapX: latest.baseGrid.gapX,
          gapY: latest.baseGrid.gapY,
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
          atlas: latest.atlas,
          imageGlyphAtlas: latest.imageGlyphAtlas,
          font: latest.font,
          ascii: latest.ascii,
          color: latest.color,
          animation: latest.animation,
          animationTimeSeconds: timeSeconds,
          glyphMetrics: latest.glyphMetrics
        });

        if (isEchoActive(latest.animation)) {
          copyCanvasFrame(backgroundCanvas, temporaryBackgroundCanvas);
          compositeEchoFrame({
            targetCanvas: glyphCanvas,
            currentLayerCanvas: temporaryGlyphCanvas,
            history: echoHistoryRef.current,
            animation: latest.animation
          });
          pushEchoFrame(echoHistoryRef.current, temporaryGlyphCanvas, latest.animation);
        } else {
          resetEchoFrameHistory(echoHistoryRef.current);
          copyCanvasFrame(backgroundCanvas, temporaryBackgroundCanvas);
          copyCanvasFrame(glyphCanvas, temporaryGlyphCanvas);
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
