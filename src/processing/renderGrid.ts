import { computeSobel } from "../edges/sobel";
import { applyBlurAndSharpen, buildLuminanceMap } from "../luminance/adjustments";
import {
  buildToneMappingProfile,
  computeLayerBrightness,
  createSamplingFrame,
  sampleCellMetrics,
  selectGlyph,
  shouldSuppressGlyphForBlackCell
} from "./cellSampling";
import { applyEdgeBreakup } from "./edgeBreakup";
import { buildSubjectMaps } from "./subjectMask";
import { getTargetAspectRatio } from "../presets/aspectRatios";
import type { CellMetrics, CellRenderData, RenderGrid, WorkerRenderOptions } from "../renderer/types";

export const generateRenderGrid = (imageData: ImageData, options: WorkerRenderOptions): RenderGrid => {
  const width = imageData.width;
  const height = imageData.height;
  const luminanceBase = buildLuminanceMap(imageData, options.image);
  const luminance = applyBlurAndSharpen(luminanceBase, width, height, options.image);
  const subjectMaps = buildSubjectMaps(imageData, luminance);
  const edges = computeSobel(luminance, width, height);
  const targetAspectRatio = getTargetAspectRatio(
    options.frame.aspectRatio,
    width,
    height,
    options.frame.customCanvasWidth,
    options.frame.customCanvasHeight
  );
  const samplingFrame = createSamplingFrame(width, height, targetAspectRatio, options.frame);
  const sampledMetrics: CellMetrics[] = [];
  const cells: CellRenderData[] = [];

  for (let y = 0; y < options.rows; y += 1) {
    for (let x = 0; x < options.columns; x += 1) {
      sampledMetrics.push(
        sampleCellMetrics(
          luminance,
          edges,
          width,
          height,
          subjectMaps.alpha,
          subjectMaps.coverage,
          options.columns,
          options.rows,
          x,
          y,
          samplingFrame
        )
      );
    }
  }

  const renderOptions: WorkerRenderOptions = {
    ...options,
    toneProfile: buildToneMappingProfile(sampledMetrics, options)
  };
  const glyphVisibility =
    renderOptions.ascii.glyphOpacity <= 0.001
      ? 0
      : renderOptions.color.paletteMode === "single"
        ? 1
        : Math.min(1, renderOptions.ascii.glyphOpacity / 0.12);
  const backgroundVisibility =
    renderOptions.color.paletteMode === "single" && renderOptions.ascii.backgroundOpacity <= 0.001 ? 0 : 1;

  for (const sampled of sampledMetrics) {
    const metrics = sampled;
    const brightness = computeLayerBrightness(metrics, renderOptions);
    const sourceAlpha = metrics.alpha <= 0.01 ? 0 : Math.min(1, metrics.alpha * 1.2);
    const suppressForeground = shouldSuppressGlyphForBlackCell(metrics, renderOptions);
    cells.push({
      ...metrics,
      glyph: selectGlyph(metrics, options.glyphMetrics, renderOptions),
      foreground: brightness.foreground,
      background: brightness.background,
      foregroundAlpha: suppressForeground ? 0 : sourceAlpha * glyphVisibility,
      backgroundAlpha: sourceAlpha * backgroundVisibility,
      isParticle: false
    });
  }

  applyEdgeBreakup(cells, renderOptions);

  return {
    cells,
    columns: options.columns,
    rows: options.rows,
    cellWidth: options.cellWidth,
    cellHeight: options.cellHeight,
    gapX: options.gapX,
    gapY: options.gapY,
    width: options.columns * options.cellWidth + Math.max(0, options.columns - 1) * options.gapX,
    height: options.rows * options.cellHeight + Math.max(0, options.rows - 1) * options.gapY,
    sourceWidth: width,
    sourceHeight: height,
    computedAt: performance.now()
  };
};
