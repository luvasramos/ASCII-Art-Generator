import type { FontSettings } from "../renderer/types";
import { colorCacheKey } from "../quantization/color";

interface AtlasGlyph {
  glyph: string;
  alphaCanvas: HTMLCanvasElement | OffscreenCanvas;
}

export interface GlyphAtlas {
  cellWidth: number;
  cellHeight: number;
  scale: number;
  glyphs: Map<string, AtlasGlyph>;
  tinted: Map<string, HTMLCanvasElement>;
  getTintedGlyph: (glyph: string, color: string) => HTMLCanvasElement | null;
}

const createCanvas = (width: number, height: number): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  return canvas;
};

const measureGlyphBox = (ctx: CanvasRenderingContext2D, glyph: string) => {
  const metrics = ctx.measureText(glyph);
  const width = Math.max(1, metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight || metrics.width || 1);
  const height = Math.max(
    1,
    metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent || Number.parseFloat(ctx.font) || 1
  );

  return {
    width,
    height,
    centerOffsetY: (metrics.actualBoundingBoxDescent - metrics.actualBoundingBoxAscent) / 2
  };
};

export const resolveCellFittedFontSize = (
  _characters: string,
  font: FontSettings,
  cellWidth: number,
  cellHeight: number,
  characterScale: number,
  scale: number
) => {
  const probe = createCanvas(128, 128);
  const ctx = probe.getContext("2d");
  if (!ctx) {
    return Math.max(1, cellHeight * characterScale * scale);
  }

  const probeSize = 100;
  ctx.font = `${font.weight} ${probeSize}px "${font.family}", monospace`;
  const reference = measureGlyphBox(ctx, "X");
  const targetWidth = Math.max(1, cellWidth * characterScale * scale);
  const targetHeight = Math.max(1, cellHeight * characterScale * scale);
  const fitScale = Math.min(targetWidth / reference.width, targetHeight / reference.height);

  return Math.max(1, probeSize * fitScale);
};

export const createGlyphAtlas = (
  characters: string,
  font: FontSettings,
  cellWidth: number,
  cellHeight: number,
  characterScale: number
): GlyphAtlas => {
  const scale = window.devicePixelRatio > 1 ? 2 : 1.5;
  const atlasWidth = Math.ceil(cellWidth * scale);
  const atlasHeight = Math.ceil(cellHeight * scale);
  const glyphs = new Map<string, AtlasGlyph>();
  const tinted = new Map<string, HTMLCanvasElement>();
  const renderFontSize = resolveCellFittedFontSize(characters, font, cellWidth, cellHeight, characterScale, scale);

  Array.from(characters).forEach((glyph) => {
    const canvas = createCanvas(atlasWidth, atlasHeight);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${font.weight} ${renderFontSize}px "${font.family}", monospace`;
    const box = measureGlyphBox(ctx, glyph);
    ctx.fillText(glyph, atlasWidth / 2, atlasHeight / 2 - box.centerOffsetY);
    glyphs.set(glyph, { glyph, alphaCanvas: canvas });
  });

  const getTintedGlyph = (glyph: string, color: string) => {
    const entry = glyphs.get(glyph);
    if (!entry) {
      return null;
    }

    const key = `${glyph}:${colorCacheKey(color)}`;
    const existing = tinted.get(key);
    if (existing) {
      return existing;
    }

    if (tinted.size > 2400) {
      const first = tinted.keys().next().value as string | undefined;
      if (first) {
        tinted.delete(first);
      }
    }

    const canvas = createCanvas(atlasWidth, atlasHeight);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return null;
    }
    ctx.clearRect(0, 0, atlasWidth, atlasHeight);
    ctx.drawImage(entry.alphaCanvas, 0, 0);
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, atlasWidth, atlasHeight);
    ctx.globalCompositeOperation = "source-over";
    tinted.set(key, canvas);
    return canvas;
  };

  return {
    cellWidth,
    cellHeight,
    scale,
    glyphs,
    tinted,
    getTintedGlyph
  };
};
