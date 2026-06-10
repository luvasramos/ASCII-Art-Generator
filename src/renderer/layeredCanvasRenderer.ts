import type {
  AnimationSettings,
  AsciiSettings,
  CellRenderData,
  ColorSettings,
  ExportOptions,
  FontSettings,
  GlyphMetric,
  RenderGrid
} from "./types";
import type { GlyphAtlas } from "../atlas/glyphAtlas";
import { getImageGlyphIndexForBrightness, type ImageGlyphAtlas } from "../atlas/imageGlyphAtlas";
import {
  invertCssColor,
  isSourceMatchMode,
  resolveCellColor,
  resolveDisplayCellColor,
  resolveDisplaySourceMatchColor
} from "../quantization/color";
import { resolveRenderAnimationState } from "./animationEffects";
import type { ImageGlyphAtlasEntry } from "../atlas/imageGlyphAtlas";
import { createImageGlyphBrightnessMapper } from "./imageGlyphDistribution";
import {
  resolveDuotoneHitsOfColor,
  resolveDuotoneTransitionColor,
  shouldUseStaticDuotoneHitColor
} from "./duotoneTransitionAccent";
import { matrixTransitionColorCanRender } from "./strictDuotone";

interface LayerRenderArgs {
  backgroundCanvas: HTMLCanvasElement;
  glyphCanvas: HTMLCanvasElement;
  grid: RenderGrid;
  atlas: GlyphAtlas;
  imageGlyphAtlas?: ImageGlyphAtlas | null;
  font: FontSettings;
  ascii: AsciiSettings;
  color: ColorSettings;
  exportOptions?: ExportOptions;
  animation?: AnimationSettings;
  transitionAccent?: AnimationSettings;
  animationTimeSeconds?: number;
  glyphMetrics?: GlyphMetric[];
}

const prepareCanvas = (canvas: HTMLCanvasElement, width: number, height: number) => {
  if (canvas.width !== width) {
    canvas.width = width;
  }
  if (canvas.height !== height) {
    canvas.height = height;
  }
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
};

const quantizeBrightness = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 255) / 255;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const clampByte = (value: number) => Math.min(255, Math.max(0, Math.round(value)));

const hash01 = (x: number, y: number, salt: number) => {
  const value = Math.sin((x + 1) * 127.1 + (y + 1) * 311.7 + salt * 74.7) * 43758.5453123;
  return value - Math.floor(value);
};

const duotoneLayerVisible = (alpha: number, cell: CellRenderData, salt: number) => {
  const value = clamp01(alpha);
  if (value >= 0.999) {
    return true;
  }
  if (value <= 0.001) {
    return false;
  }
  return hash01(cell.x, cell.y, salt) < value;
};

const tintedImageGlyphCache = new Map<string, HTMLCanvasElement>();
const binaryTintedGlyphCache = new Map<string, HTMLCanvasElement>();

const parseCanvasColor = (color: string) => {
  const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (rgbMatch) {
    return {
      r: clampByte(Number(rgbMatch[1])),
      g: clampByte(Number(rgbMatch[2])),
      b: clampByte(Number(rgbMatch[3]))
    };
  }

  const hex = color.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(hex) || /^[0-9a-f]{6}$/i.test(hex)) {
    const full = hex.length === 3 ? hex.split("").map((part) => part + part).join("") : hex;
    return {
      r: Number.parseInt(full.slice(0, 2), 16),
      g: Number.parseInt(full.slice(2, 4), 16),
      b: Number.parseInt(full.slice(4, 6), 16)
    };
  }

  return { r: 255, g: 255, b: 255 };
};

const getTintedImageGlyphCanvas = (imageGlyph: ImageGlyphAtlasEntry, color: string, binary = false) => {
  const cacheKey = `${imageGlyph.id}:${color.replace(/\s+/g, "")}:${binary ? "binary" : "soft"}`;
  const cached = tintedImageGlyphCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const canvas = document.createElement("canvas");
  canvas.width = imageGlyph.canvas.width;
  canvas.height = imageGlyph.canvas.height;
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) {
    return imageGlyph.canvas;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(imageGlyph.canvas, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const tint = parseCanvasColor(color);
  for (let index = 0; index < imageData.data.length; index += 4) {
    const alpha = imageData.data[index + 3];
    if (alpha === 0) {
      continue;
    }
    imageData.data[index] = tint.r;
    imageData.data[index + 1] = tint.g;
    imageData.data[index + 2] = tint.b;
    if (binary) {
      imageData.data[index + 3] = alpha >= 128 ? 255 : 0;
    }
  }
  ctx.putImageData(imageData, 0, 0);
  if (tintedImageGlyphCache.size > 2048) {
    tintedImageGlyphCache.clear();
  }
  tintedImageGlyphCache.set(cacheKey, canvas);
  return canvas;
};

const getBinaryTintedGlyphCanvas = (
  source: HTMLCanvasElement | OffscreenCanvas,
  color: string,
  id: string
) => {
  const cacheKey = `${id}:${source.width}x${source.height}:${color.replace(/\s+/g, "")}`;
  const cached = binaryTintedGlyphCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) {
    return source;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const tint = parseCanvasColor(color);
  for (let index = 0; index < imageData.data.length; index += 4) {
    const alpha = imageData.data[index + 3];
    if (alpha < 128) {
      imageData.data[index + 3] = 0;
      continue;
    }
    imageData.data[index] = tint.r;
    imageData.data[index + 1] = tint.g;
    imageData.data[index + 2] = tint.b;
    imageData.data[index + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
  if (binaryTintedGlyphCache.size > 2048) {
    binaryTintedGlyphCache.clear();
  }
  binaryTintedGlyphCache.set(cacheKey, canvas);
  return canvas;
};

const scaleColorBrightness = (color: string, multiplier: number) => {
  const scale = Math.min(1, Math.max(0, multiplier));
  if (scale >= 0.999) {
    return color;
  }

  const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (rgbMatch) {
    const [, r, g, b] = rgbMatch;
    return `rgb(${clampByte(Number(r) * scale)}, ${clampByte(Number(g) * scale)}, ${clampByte(Number(b) * scale)})`;
  }

  const hex = color.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(hex) || /^[0-9a-f]{6}$/i.test(hex)) {
    const full = hex.length === 3 ? hex.split("").map((part) => part + part).join("") : hex;
    const r = Number.parseInt(full.slice(0, 2), 16);
    const g = Number.parseInt(full.slice(2, 4), 16);
    const b = Number.parseInt(full.slice(4, 6), 16);
    return `rgb(${clampByte(r * scale)}, ${clampByte(g * scale)}, ${clampByte(b * scale)})`;
  }

  return color;
};

const blendCssColors = (baseColor: string, tintColor: string, amount: number) => {
  const blend = clamp01(amount);
  if (blend <= 0) {
    return baseColor;
  }
  const base = parseCanvasColor(baseColor);
  const tint = parseCanvasColor(tintColor);
  return `rgb(${clampByte(base.r + (tint.r - base.r) * blend)}, ${clampByte(
    base.g + (tint.g - base.g) * blend
  )}, ${clampByte(base.b + (tint.b - base.b) * blend)})`;
};

const applyMatrixTransitionColor = (
  baseColor: string,
  cell: CellRenderData,
  animation: AnimationSettings | undefined,
  transitionAccent: AnimationSettings | undefined,
  color: ColorSettings,
  ascii: AsciiSettings,
  brightnessMultiplier: number,
  duotoneMode: boolean,
  animationTimeSeconds: number | undefined
) => {
  const strength = clamp01(cell.matrixTransition ?? 0);
  const accentSettings = transitionAccent ?? animation;
  const transitionEnabled = matrixTransitionColorCanRender(accentSettings);
  if (duotoneMode) {
    if (transitionEnabled && strength > 0 && accentSettings) {
      return resolveDuotoneTransitionColor(accentSettings, color);
    }
    if (shouldUseStaticDuotoneHitColor(cell, color, ascii, animation, animationTimeSeconds)) {
      return resolveDuotoneHitsOfColor(color);
    }
    return baseColor;
  }
  if (!transitionEnabled || strength <= 0 || !accentSettings) {
    return baseColor;
  }
  const transitionColor = resolveDuotoneTransitionColor(accentSettings, color);
  const displayTransition = scaleColorBrightness(transitionColor, brightnessMultiplier);
  return blendCssColors(baseColor, displayTransition, Math.min(0.48, strength));
};

const drawImageCover = (
  ctx: CanvasRenderingContext2D,
  image: HTMLCanvasElement,
  x: number,
  y: number,
  width: number,
  height: number,
  crisp: boolean
) => {
  const scale = Math.max(width / image.width, height / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  const drawX = x + (width - drawWidth) / 2;
  const drawY = y + (height - drawHeight) / 2;
  const clipX = crisp ? Math.round(x) : x;
  const clipY = crisp ? Math.round(y) : y;
  const clipWidth = crisp ? Math.max(1, Math.round(width)) : width;
  const clipHeight = crisp ? Math.max(1, Math.round(height)) : height;

  ctx.beginPath();
  ctx.rect(clipX, clipY, clipWidth, clipHeight);
  ctx.clip();
  ctx.drawImage(
    image,
    crisp ? Math.round(drawX) : drawX,
    crisp ? Math.round(drawY) : drawY,
    crisp ? Math.max(1, Math.round(drawWidth)) : drawWidth,
    crisp ? Math.max(1, Math.round(drawHeight)) : drawHeight
  );
};

export const renderAsciiLayers = ({
  backgroundCanvas,
  glyphCanvas,
  grid,
  atlas,
  imageGlyphAtlas,
  font,
  ascii,
  color,
  exportOptions,
  animation,
  transitionAccent,
  animationTimeSeconds,
  glyphMetrics
}: LayerRenderArgs) => {
  const animationState = resolveRenderAnimationState(grid, ascii, animation, animationTimeSeconds, glyphMetrics);
  const renderGrid = animationState.grid;
  const duotoneMode = color.paletteMode === "single";
  const width = Math.max(1, Math.ceil(grid.width));
  const height = Math.max(1, Math.ceil(grid.height));
  const stepX = grid.cellWidth + grid.gapX;
  const stepY = grid.cellHeight + grid.gapY;
  const backgroundCellWidth = grid.gapX > 0 ? grid.cellWidth : grid.cellWidth + 0.5;
  const backgroundCellHeight = grid.gapY > 0 ? grid.cellHeight : grid.cellHeight + 0.5;
  prepareCanvas(backgroundCanvas, width, height);
  prepareCanvas(glyphCanvas, width, height);

  const backgroundCtx = backgroundCanvas.getContext("2d", { alpha: true });
  const glyphCtx = glyphCanvas.getContext("2d", { alpha: true });
  if (!backgroundCtx || !glyphCtx) {
    return;
  }

  backgroundCtx.clearRect(0, 0, width, height);
  glyphCtx.clearRect(0, 0, width, height);
  backgroundCtx.imageSmoothingEnabled = duotoneMode ? false : font.antiAlias;
  glyphCtx.imageSmoothingEnabled = duotoneMode ? false : font.antiAlias;
  glyphCtx.fontKerning = "none";
  glyphCtx.textRendering = duotoneMode || !font.antiAlias ? "optimizeSpeed" : "geometricPrecision";

  const transparentBackground = exportOptions?.transparentBackground ?? false;
  const alphaThreshold = (exportOptions?.alphaThreshold ?? 0) / 100;
  const sourceMatchMode = isSourceMatchMode(color);
  const sourceMatchCellBackground = sourceMatchMode && color.sourceMatchBackground === "cell-background";

  if (!transparentBackground) {
    const baseBackground = duotoneMode
      ? color.backgroundColor
      : exportOptions?.backgroundColor ?? resolveCellColor(0, color, "background");
    const displayBackground = color.invert ? invertCssColor(baseBackground) : baseBackground;
    backgroundCtx.fillStyle = duotoneMode ? displayBackground : scaleColorBrightness(displayBackground, animationState.brightnessMultiplier);
    backgroundCtx.fillRect(0, 0, width, height);
  }

  // Transparent exports omit low-coverage cells so empty silhouettes stay alpha-clean.
  for (const cell of renderGrid.cells) {
    if (sourceMatchMode && !sourceMatchCellBackground) {
      continue;
    }
    if (transparentBackground && !cell.isParticle && cell.coverage < alphaThreshold) {
      continue;
    }
    if (cell.backgroundAlpha <= 0) {
      continue;
    }
    if (duotoneMode && !duotoneLayerVisible(cell.backgroundAlpha, cell, 19)) {
      continue;
    }
    const resolvedBackground = sourceMatchCellBackground
      ? resolveDisplaySourceMatchColor(cell, color)
      : resolveDisplayCellColor(quantizeBrightness(cell.background), color, "background");
    const bg = duotoneMode ? resolvedBackground : scaleColorBrightness(resolvedBackground, animationState.brightnessMultiplier);
    backgroundCtx.fillStyle = bg;
    backgroundCtx.globalAlpha = duotoneMode ? 1 : cell.backgroundAlpha;
    backgroundCtx.fillRect(
      grid.gapX > 0 ? cell.x * stepX : Math.round(cell.x * stepX),
      grid.gapY > 0 ? cell.y * stepY : Math.round(cell.y * stepY),
      grid.gapX > 0 ? backgroundCellWidth : Math.ceil(backgroundCellWidth),
      grid.gapY > 0 ? backgroundCellHeight : Math.ceil(backgroundCellHeight)
    );
  }
  backgroundCtx.globalAlpha = 1;

  const imageGlyphMode = ascii.glyphMode === "images";
  const useImageGlyphs = imageGlyphMode && Boolean(imageGlyphAtlas?.glyphs.length && imageGlyphAtlas.glyphs.length >= 2);
  const imageGlyphMapper =
    useImageGlyphs && imageGlyphAtlas
      ? createImageGlyphBrightnessMapper(renderGrid.cells, imageGlyphAtlas.glyphs.length, ascii.glyphOpacity)
      : null;

  for (const cell of renderGrid.cells) {
    if (imageGlyphMode && !useImageGlyphs) {
      continue;
    }
    if (!imageGlyphMode && (!cell.glyph || cell.glyph === " ")) {
      continue;
    }
    if (transparentBackground && !cell.isParticle && cell.coverage < alphaThreshold) {
      continue;
    }
    if (cell.foregroundAlpha <= 0) {
      continue;
    }
    const effectiveForegroundAlpha = clamp01(cell.foregroundAlpha * animationState.glyphAlphaMultiplier);
    if (duotoneMode && !duotoneLayerVisible(effectiveForegroundAlpha, cell, 37)) {
      continue;
    }
    if (useImageGlyphs && imageGlyphAtlas) {
      const glyphBrightness = imageGlyphMapper
        ? imageGlyphMapper.map(cell)
        : quantizeBrightness(cell.foreground);
      const imageGlyphIndex = getImageGlyphIndexForBrightness(glyphBrightness, imageGlyphAtlas.glyphs.length);
      const imageGlyph = imageGlyphAtlas.glyphs[imageGlyphIndex] ?? null;
      if (!imageGlyph) {
        continue;
      }
      imageGlyphMapper?.record(imageGlyphIndex);
      const resolvedGlyphColor = sourceMatchMode
        ? resolveDisplaySourceMatchColor(cell, color)
        : resolveDisplayCellColor(quantizeBrightness(cell.foreground), color, "foreground");
      const baseGlyphColor = duotoneMode
        ? resolvedGlyphColor
        : scaleColorBrightness(resolvedGlyphColor, animationState.brightnessMultiplier);
      const glyphColor = applyMatrixTransitionColor(
        baseGlyphColor,
        cell,
        animation,
        transitionAccent,
        color,
        ascii,
        animationState.brightnessMultiplier,
        duotoneMode,
        animationTimeSeconds
      );
      const tintedGlyph = getTintedImageGlyphCanvas(imageGlyph, glyphColor, duotoneMode);
      const drawSize =
        Math.min(grid.cellWidth, grid.cellHeight) * ascii.characterScale * animationState.glyphScaleMultiplier;
      const drawX = cell.x * stepX + grid.cellWidth / 2 - drawSize / 2;
      const drawY = cell.y * stepY + grid.cellHeight / 2 - drawSize / 2;
      glyphCtx.save();
      glyphCtx.globalAlpha = duotoneMode ? 1 : effectiveForegroundAlpha;
      drawImageCover(glyphCtx, tintedGlyph, drawX, drawY, drawSize, drawSize, duotoneMode);
      glyphCtx.restore();
      continue;
    }
    const resolvedForeground = sourceMatchMode
      ? resolveDisplaySourceMatchColor(cell, color)
      : resolveDisplayCellColor(quantizeBrightness(cell.foreground), color, "foreground");
    const baseForeground = duotoneMode
      ? resolvedForeground
      : scaleColorBrightness(resolvedForeground, animationState.brightnessMultiplier);
    const fg = applyMatrixTransitionColor(
      baseForeground,
      cell,
      animation,
      transitionAccent,
      color,
      ascii,
      animationState.brightnessMultiplier,
      duotoneMode,
      animationTimeSeconds
    );
    const glyph = duotoneMode ? atlas.glyphs.get(cell.glyph)?.alphaCanvas ?? null : atlas.getTintedGlyph(cell.glyph, fg);
    if (!glyph) {
      continue;
    }
    const drawGlyph = duotoneMode ? getBinaryTintedGlyphCanvas(glyph, fg, cell.glyph) : glyph;
    const drawWidth = grid.cellWidth * animationState.glyphScaleMultiplier;
    const drawHeight = grid.cellHeight * animationState.glyphScaleMultiplier;
    const drawX = cell.x * stepX + (grid.cellWidth - drawWidth) / 2;
    const drawY = cell.y * stepY + (grid.cellHeight - drawHeight) / 2;
    glyphCtx.globalAlpha = duotoneMode ? 1 : effectiveForegroundAlpha;
    glyphCtx.drawImage(
      drawGlyph,
      duotoneMode ? Math.round(drawX) : drawX,
      duotoneMode ? Math.round(drawY) : drawY,
      duotoneMode ? Math.max(1, Math.round(drawWidth)) : drawWidth,
      duotoneMode ? Math.max(1, Math.round(drawHeight)) : drawHeight
    );
  }
  imageGlyphMapper?.flushDebug("canvas");
  glyphCtx.filter = "none";
  glyphCtx.globalAlpha = 1;
};

interface SingleCanvasRenderArgs extends Omit<LayerRenderArgs, "backgroundCanvas" | "glyphCanvas"> {
  scale: number;
}

export const renderAsciiToCanvas = ({
  grid,
  atlas,
  imageGlyphAtlas,
  font,
  ascii,
  color,
  scale,
  exportOptions,
  animation,
  transitionAccent,
  animationTimeSeconds
}: SingleCanvasRenderArgs) => {
  const backgroundCanvas = document.createElement("canvas");
  const glyphCanvas = document.createElement("canvas");
  renderAsciiLayers({
    backgroundCanvas,
    glyphCanvas,
    grid,
    atlas,
    imageGlyphAtlas,
    font,
    ascii,
    color,
    exportOptions,
    animation,
    transitionAccent,
    animationTimeSeconds
  });

  const output = document.createElement("canvas");
  output.width = Math.max(1, Math.round(grid.width * scale));
  output.height = Math.max(1, Math.round(grid.height * scale));
  const ctx = output.getContext("2d");
  if (!ctx) {
    return output;
  }
  ctx.imageSmoothingEnabled = color.paletteMode === "single" ? false : font.antiAlias;
  ctx.drawImage(backgroundCanvas, 0, 0, output.width, output.height);
  ctx.drawImage(glyphCanvas, 0, 0, output.width, output.height);
  return output;
};
