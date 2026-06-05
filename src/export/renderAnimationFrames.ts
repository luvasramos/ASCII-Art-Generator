import { normalizeCharacterSet } from "../ascii/charset";
import { createGlyphAtlas } from "../atlas/glyphAtlas";
import { createImageGlyphAtlas } from "../atlas/imageGlyphAtlas";
import { waitForFonts } from "../fonts/fontRegistry";
import { getTargetAspectRatio } from "../presets/aspectRatios";
import { generateRenderGrid } from "../processing/renderGrid";
import { applyRenderResolutionToGeometry, measureCellGeometry, scaleFontForRenderResolution } from "../renderer/geometry";
import { resolveAnimatedProcessingSettings } from "../renderer/animationEffects";
import { normalizeAnimationFps, resolveAnimationFrameCount, resolveExportAnimationFrameTiming } from "../renderer/animationTiming";
import {
  compositeEchoFrame,
  createEchoFrameHistory,
  isEchoActive,
  pushEchoFrame,
  resetEchoFrameHistory
} from "../renderer/echoComposite";
import { renderAsciiLayers } from "../renderer/layeredCanvasRenderer";
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
  WorkerRenderOptions
} from "../renderer/types";

export interface RenderedAnimationFrame {
  frameIndex: number;
  totalFrames: number;
  timestamp: number;
  progress: number;
  canvas: HTMLCanvasElement;
}

export interface RenderAsciiAnimationFramesOptions {
  duration: number;
  fps: number;
  font: FontSettings;
  ascii: AsciiSettings;
  image: ImageSettings;
  frame: FrameSettings;
  breakup: BreakupSettings;
  color: ColorSettings;
  exportOptions: ExportOptions;
  exportScale: number;
  glyphMetrics: GlyphMetric[];
  animation?: AnimationSettings;
  renderLikePreview?: boolean;
  signal?: AbortSignal;
  onFrameStart?: (frameIndex: number, totalFrames: number) => void;
  getFrame: (timeSeconds: number, progress: number, frameIndex: number, totalFrames: number) => ImageData | Promise<ImageData>;
}

const createAbortError = () => {
  const error = new Error("Video export canceled.");
  error.name = "AbortError";
  return error;
};

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) {
    throw createAbortError();
  }
};

const scaleGrid = <T extends { cellWidth: number; cellHeight: number; gapX: number; gapY: number; width: number; height: number }>(
  grid: T,
  scale: number
): T => ({
  ...grid,
  cellWidth: grid.cellWidth * scale,
  cellHeight: grid.cellHeight * scale,
  gapX: grid.gapX * scale,
  gapY: grid.gapY * scale,
  width: grid.width * scale,
  height: grid.height * scale
});

export async function* renderAsciiAnimationFrames({
  duration,
  fps,
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
  renderLikePreview = false,
  signal,
  onFrameStart,
  getFrame
}: RenderAsciiAnimationFramesOptions): AsyncGenerator<RenderedAnimationFrame> {
  const normalizedFps = normalizeAnimationFps(fps);
  const totalFrames = resolveAnimationFrameCount(duration, normalizedFps);
  await waitForFonts(3000);
  throwIfAborted(signal);
  const firstFrame = await getFrame(0, 0, 0, totalFrames);
  const targetAspectRatio = getTargetAspectRatio(
    frame.aspectRatio,
    firstFrame.width,
    firstFrame.height,
    frame.customCanvasWidth,
    frame.customCanvasHeight
  );
  const geometry = applyRenderResolutionToGeometry(
    measureCellGeometry(
      firstFrame.width,
      firstFrame.height,
      targetAspectRatio,
      font,
      ascii.characterDensity,
      ascii.spacingX,
      ascii.spacingY,
      ascii.cellSpacing,
      frame.aspectRatio === "custom"
        ? { width: frame.customCanvasWidth, height: frame.customCanvasHeight }
        : null,
      ascii.glyphMode
    ),
    ascii.renderResolution
  );
  const baseOptions = {
    columns: geometry.columns,
    rows: geometry.rows,
    cellWidth: geometry.cellWidth,
    cellHeight: geometry.cellHeight,
    gapX: geometry.gapX,
    gapY: geometry.gapY,
    ascii,
    color,
    glyphMetrics
  };

  const firstSettings = resolveAnimatedProcessingSettings(image, frame, breakup, animation, 0);
  const firstOptions: WorkerRenderOptions = {
    ...baseOptions,
    image: firstSettings.image,
    frame: firstSettings.frame,
    breakup: firstSettings.breakup
  };

  const firstGrid = scaleGrid(generateRenderGrid(firstFrame, firstOptions), exportScale);
  const renderFont = scaleFontForRenderResolution(font, ascii.renderResolution);
  const exportFont: FontSettings = {
    ...renderFont,
    size: renderFont.size * exportScale,
    letterSpacing: renderFont.letterSpacing * exportScale
  };
  const atlas = createGlyphAtlas(
    normalizeCharacterSet(ascii.charset),
    exportFont,
    firstGrid.cellWidth,
    firstGrid.cellHeight,
    ascii.characterScale
  );
  const imageGlyphAtlas =
    ascii.glyphMode === "images" && ascii.imageGlyphs.length >= 2
      ? await createImageGlyphAtlas(ascii.imageGlyphs)
      : null;

  const backgroundCanvas = document.createElement("canvas");
  const glyphCanvas = document.createElement("canvas");
  const echoGlyphCanvas = document.createElement("canvas");
  const outputCanvas = document.createElement("canvas");
  const echoHistory = createEchoFrameHistory();
  outputCanvas.width = Math.max(1, Math.round(firstGrid.width));
  outputCanvas.height = Math.max(1, Math.round(firstGrid.height));
  const outputCtx = outputCanvas.getContext("2d");
  if (!outputCtx) {
    throw new Error("Canvas2D is unavailable for animation export.");
  }

  const renderFrame = (frameData: ImageData, timestamp: number) => {
    const animatedSettings = resolveAnimatedProcessingSettings(image, frame, breakup, animation, timestamp);
    const options: WorkerRenderOptions = {
      ...baseOptions,
      image: animatedSettings.image,
      frame: animatedSettings.frame,
      breakup: animatedSettings.breakup
    };
    const grid = scaleGrid(generateRenderGrid(frameData, options), exportScale);
    renderAsciiLayers({
      backgroundCanvas,
      glyphCanvas,
      grid,
      atlas,
      imageGlyphAtlas,
      font: exportFont,
      ascii,
      color,
      exportOptions: renderLikePreview ? undefined : exportOptions,
      animation,
      animationTimeSeconds: timestamp,
      glyphMetrics
    });

    outputCtx.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
    outputCtx.drawImage(backgroundCanvas, 0, 0);
    if (isEchoActive(animation)) {
      compositeEchoFrame({
        targetCanvas: echoGlyphCanvas,
        currentLayerCanvas: glyphCanvas,
        history: echoHistory,
        animation
      });
      outputCtx.drawImage(echoGlyphCanvas, 0, 0);
      pushEchoFrame(echoHistory, glyphCanvas, animation);
    } else {
      resetEchoFrameHistory(echoHistory);
      outputCtx.drawImage(glyphCanvas, 0, 0);
    }
  };

  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
    throwIfAborted(signal);
    onFrameStart?.(frameIndex, totalFrames);
    const { timestamp, progress } = resolveExportAnimationFrameTiming(frameIndex, totalFrames, normalizedFps);
    renderFrame(frameIndex === 0 ? firstFrame : await getFrame(timestamp, progress, frameIndex, totalFrames), timestamp);
    yield {
      frameIndex,
      totalFrames,
      timestamp,
      progress,
      canvas: outputCanvas
    };
  }
}
