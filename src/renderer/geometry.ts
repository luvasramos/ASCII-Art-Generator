import type { AsciiGlyphMode, CellGeometry, FontSettings } from "./types";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const measurementCanvas = document.createElement("canvas");
const measurementCtx = measurementCanvas.getContext("2d");

const fitCellGeometryToLayout = (
  layoutWidth: number,
  layoutHeight: number,
  columns: number,
  rows: number,
  gapFraction: number,
  squareCells: boolean
) => {
  const fittedCellWidth = layoutWidth / Math.max(1, columns + (columns - 1) * gapFraction);
  const fittedCellHeight = layoutHeight / Math.max(1, rows + (rows - 1) * gapFraction);

  if (!squareCells) {
    return {
      cellWidth: fittedCellWidth,
      cellHeight: fittedCellHeight,
      gapX: fittedCellWidth * gapFraction,
      gapY: fittedCellHeight * gapFraction
    };
  }

  const squareCellSize = Math.max(1, Math.min(fittedCellWidth, fittedCellHeight));
  const baseGap = squareCellSize * gapFraction;
  const extraGapX =
    columns > 1 ? Math.max(0, layoutWidth - columns * squareCellSize - (columns - 1) * baseGap) / (columns - 1) : 0;
  const extraGapY =
    rows > 1 ? Math.max(0, layoutHeight - rows * squareCellSize - (rows - 1) * baseGap) / (rows - 1) : 0;

  return {
    cellWidth: squareCellSize,
    cellHeight: squareCellSize,
    gapX: columns > 1 ? baseGap + extraGapX : 0,
    gapY: rows > 1 ? baseGap + extraGapY : 0
  };
};

export const measureCellGeometry = (
  imageWidth: number,
  imageHeight: number,
  targetAspectRatio: number,
  font: FontSettings,
  characterDensity: number,
  spacingX: number,
  spacingY: number,
  cellSpacing: number,
  customCanvasSize?: { width: number; height: number } | null,
  glyphMode: AsciiGlyphMode = "characters"
): CellGeometry => {
  if (measurementCtx) {
    measurementCtx.font = `${font.weight} ${font.size}px "${font.family}", monospace`;
  }

  const measuredWidth = measurementCtx?.measureText("M").width ?? font.size * 0.64;
  const cellWidth = Math.max(3, (measuredWidth + font.letterSpacing) * spacingX);
  const cellHeight =
    glyphMode === "images"
      ? Math.max(4, cellWidth)
      : Math.max(4, font.size * font.lineHeight * spacingY);
  const imageAspect = imageWidth / Math.max(1, imageHeight);
  const frameAspect = targetAspectRatio > 0 ? targetAspectRatio : imageAspect;
  const samplingWidth = imageAspect >= frameAspect ? imageWidth : imageHeight * frameAspect;
  const samplingHeight = imageAspect >= frameAspect ? imageWidth / frameAspect : imageHeight;
  const layoutWidth = customCanvasSize?.width ?? samplingWidth;
  const layoutHeight = customCanvasSize?.height ?? samplingHeight;
  const heightOverWidth = 1 / Math.max(0.001, frameAspect);
  const baseColumns = samplingWidth / Math.max(4, cellWidth);
  const columns = clamp(Math.round(baseColumns * (0.36 + characterDensity * 1.35)), 28, 340);
  const rows = clamp(Math.round(columns * heightOverWidth * (cellWidth / cellHeight)), 18, 260);
  const spacingRatio = clamp(cellSpacing / 100, 0, 1);
  const gapFraction = spacingRatio * 0.55;
  const fitted = fitCellGeometryToLayout(layoutWidth, layoutHeight, columns, rows, gapFraction, glyphMode === "images");

  return {
    cellWidth: fitted.cellWidth,
    cellHeight: fitted.cellHeight,
    gapX: fitted.gapX,
    gapY: fitted.gapY,
    columns,
    rows
  };
};

export const getRenderResolutionScale = (renderResolution = 100) =>
  clamp(renderResolution / 100, 0.01, 3);

export const applyRenderResolutionToGeometry = (
  geometry: CellGeometry,
  renderResolution = 100,
  glyphMode: AsciiGlyphMode = "characters"
): CellGeometry => {
  const scale = getRenderResolutionScale(renderResolution);
  if (Math.abs(scale - 1) < 0.001) {
    return geometry;
  }

  const width = geometry.columns * geometry.cellWidth + Math.max(0, geometry.columns - 1) * geometry.gapX;
  const height = geometry.rows * geometry.cellHeight + Math.max(0, geometry.rows - 1) * geometry.gapY;
  const columns = Math.max(1, Math.round(geometry.columns * scale));
  const rows = Math.max(1, Math.round(geometry.rows * scale));
  const gapRatioX = geometry.cellWidth > 0 ? geometry.gapX / geometry.cellWidth : 0;
  const gapRatioY = geometry.cellHeight > 0 ? geometry.gapY / geometry.cellHeight : 0;
  const gapFraction = glyphMode === "images" ? Math.max(0, Math.min(gapRatioX, gapRatioY)) : 0;
  const fitted =
    glyphMode === "images"
      ? fitCellGeometryToLayout(width, height, columns, rows, gapFraction, true)
      : {
          cellWidth: width / Math.max(1, columns + (columns - 1) * gapRatioX),
          cellHeight: height / Math.max(1, rows + (rows - 1) * gapRatioY),
          gapX: 0,
          gapY: 0
        };

  return {
    columns,
    rows,
    cellWidth: fitted.cellWidth,
    cellHeight: fitted.cellHeight,
    gapX: glyphMode === "images" ? fitted.gapX : fitted.cellWidth * gapRatioX,
    gapY: glyphMode === "images" ? fitted.gapY : fitted.cellHeight * gapRatioY
  };
};

export const scaleFontForRenderResolution = (
  font: FontSettings,
  renderResolution = 100
): FontSettings => {
  const scale = getRenderResolutionScale(renderResolution);
  if (Math.abs(scale - 1) < 0.001) {
    return font;
  }

  return {
    ...font,
    size: font.size / scale,
    letterSpacing: font.letterSpacing / scale
  };
};
