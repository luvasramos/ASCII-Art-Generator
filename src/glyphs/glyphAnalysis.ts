import type { FontSettings, GlyphMetric } from "../renderer/types";
import { normalizeCharacterSet } from "../ascii/charset";

const sampleSize = 42;

const makeCanvas = (width: number, height: number) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

const fallbackDensityRamp = " .`'·,:;-_~!iIl|\\/()[]{}?+*xvczrjft1=<>sokunCYO0QXwqpdbhmNMW&8%B#@$•◉●░▒▓█";

const approximateGlyphDensity = (glyph: string, index: number, count: number) => {
  const rampIndex = fallbackDensityRamp.indexOf(glyph);
  if (rampIndex >= 0) {
    return rampIndex / Math.max(1, fallbackDensityRamp.length - 1);
  }
  return index / Math.max(1, count - 1);
};

const computeAlphaSobel = (alpha: Float32Array, width: number, height: number) => {
  let total = 0;
  let vertical = 0;
  let horizontal = 0;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const gx =
        -alpha[i - width - 1] -
        2 * alpha[i - 1] -
        alpha[i + width - 1] +
        alpha[i - width + 1] +
        2 * alpha[i + 1] +
        alpha[i + width + 1];
      const gy =
        -alpha[i - width - 1] -
        2 * alpha[i - width] -
        alpha[i - width + 1] +
        alpha[i + width - 1] +
        2 * alpha[i + width] +
        alpha[i + width + 1];
      const magnitude = Math.sqrt(gx * gx + gy * gy);
      total += magnitude;
      vertical += Math.abs(gx);
      horizontal += Math.abs(gy);
    }
  }

  return {
    edgeWeight: Math.min(1, total / (width * height * 1.65)),
    directionalStructure: Math.abs(vertical - horizontal) / Math.max(0.0001, vertical + horizontal)
  };
};

export const analyzeGlyphSet = (characters: string, font: FontSettings): GlyphMetric[] => {
  const normalized = normalizeCharacterSet(characters);
  const canvas = makeCanvas(sampleSize, sampleSize);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  if (!ctx) {
    return Array.from(normalized)
      .map((glyph, index, list) => ({
        glyph,
        density: approximateGlyphDensity(glyph, index, list.length),
        edgeWeight: 0,
        fillRatio: 0,
        directionalStructure: 0
      }))
      .sort((a, b) => a.density - b.density);
  }

  const metrics = Array.from(normalized).map((glyph) => {
    ctx.clearRect(0, 0, sampleSize, sampleSize);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${font.weight} ${Math.floor(sampleSize * 0.72)}px "${font.family}", monospace`;
    ctx.fillText(glyph, sampleSize / 2, sampleSize * 0.54);

    const pixels = ctx.getImageData(0, 0, sampleSize, sampleSize).data;
    const alpha = new Float32Array(sampleSize * sampleSize);
    let covered = 0;
    let sum = 0;

    for (let i = 0; i < alpha.length; i += 1) {
      const a = pixels[i * 4 + 3] / 255;
      alpha[i] = a;
      sum += a;
      if (a > 0.08) {
        covered += 1;
      }
    }

    const edge = computeAlphaSobel(alpha, sampleSize, sampleSize);

    return {
      glyph,
      density: Math.min(1, sum / alpha.length / 0.44),
      edgeWeight: edge.edgeWeight,
      fillRatio: covered / alpha.length,
      directionalStructure: edge.directionalStructure
    };
  });

  return metrics.sort((a, b) => a.density - b.density);
};
