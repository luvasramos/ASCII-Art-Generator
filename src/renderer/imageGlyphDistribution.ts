import type { CellRenderData } from "./types";

interface ImageGlyphBrightnessMapper {
  map: (cell: CellRenderData) => number;
  record: (index: number) => void;
  flushDebug: (label: string) => void;
}

const histogramBins = 256;
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
let lastDebugLogAt = 0;

const isGlyphDebugEnabled = () => {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return (
      new URLSearchParams(window.location.search).has("glyphDebug") ||
      window.localStorage.getItem("ascii-studio-glyph-debug") === "1"
    );
  } catch {
    return false;
  }
};

const percentileFromHistogram = (histogram: Uint32Array, total: number, percentile: number) => {
  const target = Math.max(0, Math.min(total - 1, Math.floor(total * percentile)));
  let cumulative = 0;
  for (let index = 0; index < histogram.length; index += 1) {
    cumulative += histogram[index];
    if (cumulative > target) {
      return index / (histogram.length - 1);
    }
  }
  return 1;
};

const buildVisibleHistogram = (cells: CellRenderData[]) => {
  const histogram = new Uint32Array(histogramBins);
  let total = 0;

  const addCell = (cell: CellRenderData) => {
    const value = clamp01(cell.foreground);
    histogram[Math.round(value * (histogramBins - 1))] += 1;
    total += 1;
  };

  for (const cell of cells) {
    if (cell.isParticle || cell.alpha <= 0.01 || cell.foregroundAlpha <= 0) {
      continue;
    }
    addCell(cell);
  }

  if (total > 1) {
    return { histogram, total };
  }

  for (const cell of cells) {
    if (cell.foregroundAlpha <= 0 || (cell.alpha <= 0.01 && !cell.isParticle)) {
      continue;
    }
    addCell(cell);
  }

  return { histogram, total };
};

export const createImageGlyphBrightnessMapper = (
  cells: CellRenderData[],
  glyphCount: number,
  glyphOpacity = 1
): ImageGlyphBrightnessMapper => {
  const opacity = clamp01(glyphOpacity);
  const { histogram, total } = buildVisibleHistogram(cells);
  const rawLow = total > 1 ? percentileFromHistogram(histogram, total, 0.02) : 0;
  const rawHigh = total > 1 ? percentileFromHistogram(histogram, total, 0.98) : 1;
  const range = rawHigh - rawLow;
  const shouldNormalize =
    opacity > 0.12 &&
    glyphCount > 2 &&
    total > glyphCount &&
    range > 0.015 &&
    (rawLow > 0.04 || rawHigh < 0.96);
  const counts = new Array(glyphCount).fill(0) as number[];

  return {
    map: (cell) => {
      const raw = clamp01(cell.foreground);
      if (!shouldNormalize) {
        return raw;
      }
      return clamp01((raw - rawLow) / Math.max(0.001, range));
    },
    record: (index) => {
      if (index >= 0 && index < counts.length) {
        counts[index] += 1;
      }
    },
    flushDebug: (label) => {
      if (!isGlyphDebugEnabled()) {
        return;
      }
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      if (now - lastDebugLogAt < 1500) {
        return;
      }
      lastDebugLogAt = now;
      console.info(`[ASCII Studio glyph distribution:${label}]`, {
        glyphCount,
        visibleCells: total,
        normalized: shouldNormalize,
        rawLow,
        rawHigh,
        counts
      });
    }
  };
};
