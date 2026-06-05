import type { CellMetrics, CropMode, FrameSettings, GlyphMetric, WorkerRenderOptions } from "../renderer/types";
import type { EdgeMaps } from "../edges/sobel";

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const mix = (a: number, b: number, amount: number) => a + (b - a) * amount;
const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = clamp01((value - edge0) / Math.max(0.0001, edge1 - edge0));
  return t * t * (3 - 2 * t);
};
const pureBlackGlyphThreshold = 1 / 255;

export interface ToneMappingProfile {
  low: number;
  high: number;
}

export interface SamplingFrame {
  cropMode: CropMode;
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
  fitX: number;
  fitY: number;
  fitWidth: number;
  fitHeight: number;
  rotationRadians: number;
}

type SamplingFrameBase = Omit<SamplingFrame, "rotationRadians">;

const clampIndex = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const seededRandom = (x: number, y: number, seed: number, salt: number) => {
  const value = Math.sin((x + 1) * 127.1 + (y + 1) * 311.7 + seed * 0.017 + salt * 74.7) * 43758.5453123;
  return value - Math.floor(value);
};

const percentileFromHistogram = (histogram: Uint32Array, total: number, percentile: number) => {
  const target = Math.max(0, Math.min(total - 1, Math.floor(total * percentile)));
  let cumulative = 0;
  for (let index = 0; index < histogram.length; index += 1) {
    cumulative += histogram[index];
    if (cumulative > target) {
      return index / Math.max(1, histogram.length - 1);
    }
  }
  return 1;
};

const mapSourceLuminanceForTone = (luminance: number, options: WorkerRenderOptions) => {
  const sourceLuminance = clamp01(luminance);
  return options.image.invertTone ? 1 - sourceLuminance : sourceLuminance;
};

const getTonalLuminance = (
  metrics: CellMetrics,
  options: WorkerRenderOptions,
  toneProfile?: ToneMappingProfile | null
) => {
  let luminance = mapSourceLuminanceForTone(metrics.luminance, options);

  if (toneProfile) {
    const stretched = clamp01((luminance - toneProfile.low) / Math.max(0.001, toneProfile.high - toneProfile.low));
    luminance = mix(luminance, stretched, 0.72);
  }

  if (options.color.paletteMode === "single") {
    const threshold = clamp01(options.color.duotoneThreshold ?? 0.5);
    luminance =
      luminance < threshold
        ? 0.5 * (luminance / Math.max(0.001, threshold))
        : 0.5 + 0.5 * ((luminance - threshold) / Math.max(0.001, 1 - threshold));
  }

  return clamp01(luminance);
};

export const buildToneMappingProfile = (
  metrics: CellMetrics[],
  options: WorkerRenderOptions
): ToneMappingProfile | null => {
  const histogram = new Uint32Array(256);
  let total = 0;

  for (const cell of metrics) {
    if (cell.alpha <= 0.01 || cell.coverage <= 0.01) {
      continue;
    }
    const luminance = mapSourceLuminanceForTone(cell.luminance, options);
    histogram[Math.round(clamp01(luminance) * 255)] += 1;
    total += 1;
  }

  if (total < 8) {
    return null;
  }

  const low = percentileFromHistogram(histogram, total, 0.02);
  const high = percentileFromHistogram(histogram, total, 0.98);
  if (high - low < 0.06) {
    return null;
  }

  return { low, high };
};

const applyToneRandomness = (
  value: number,
  metrics: CellMetrics,
  edgeSignal: number,
  options: WorkerRenderOptions,
  tonalLuminance: number
) => {
  const randomness = clamp01((options.ascii.randomness ?? 0) / 100);
  if (randomness <= 0) {
    return value;
  }
  const randomWeight = smoothstep(0.3, 1, tonalLuminance);
  if (randomWeight <= 0.001) {
    return value;
  }
  const seed = options.ascii.randomSeed ?? 1337;
  const structureGuard = 0.42 + (1 - edgeSignal) * 0.58;
  const maxShift = 0.2 * Math.pow(randomness * randomWeight, 0.85) * structureGuard;
  const jitter =
    (seededRandom(metrics.x, metrics.y, seed, 101) + seededRandom(metrics.x, metrics.y, seed, 131) - 1) *
    maxShift;
  return clamp01(value + jitter);
};

export const shouldSuppressGlyphForBlackCell = (metrics: CellMetrics, options: WorkerRenderOptions) => {
  if (metrics.alpha <= 0.01) {
    return true;
  }

  if (options.image.invertTone) {
    return false;
  }

  const foregroundOnlyDuotone =
    options.color.paletteMode === "single" && options.ascii.backgroundOpacity <= 0.001;
  if (foregroundOnlyDuotone) {
    return metrics.luminance <= pureBlackGlyphThreshold;
  }

  if (metrics.coverage <= 0.01) {
    return true;
  }

  // Keep true #000000 source cells as untouched background blocks, with no foreground mark.
  return metrics.luminance <= pureBlackGlyphThreshold;
};

export const createSamplingFrame = (
  sourceWidth: number,
  sourceHeight: number,
  targetAspectRatio: number,
  frame: FrameSettings
): SamplingFrame => {
  const sourceAspectRatio = sourceWidth / Math.max(1, sourceHeight);
  const frameAspectRatio = Math.max(0.001, targetAspectRatio);
  const cropMode: CropMode = frame.cropMode;
  const scale = Math.max(0.1, frame.imageScale / 100);
  const offsetX = frame.imageOffsetX / 100;
  const offsetY = frame.imageOffsetY / 100;
  const imageCenterX = 0.5 + offsetX;
  const imageCenterY = 0.5 + offsetY;
  const rotationRadians = (frame.imageRotation / 180) * Math.PI;

  const applyTransform = (base: SamplingFrameBase): SamplingFrame => {
    const fitWidth = base.fitWidth * scale;
    const fitHeight = base.fitHeight * scale;
    return {
      ...base,
      fitX: imageCenterX - fitWidth / 2,
      fitY: imageCenterY - fitHeight / 2,
      fitWidth,
      fitHeight,
      rotationRadians
    };
  };

  if (cropMode === "contain") {
    if (sourceAspectRatio > frameAspectRatio) {
      const fitHeight = frameAspectRatio / sourceAspectRatio;
      return applyTransform({
        cropMode,
        sourceX: 0,
        sourceY: 0,
        sourceWidth,
        sourceHeight,
        fitX: 0,
        fitY: (1 - fitHeight) / 2,
        fitWidth: 1,
        fitHeight
      });
    }

    const fitWidth = sourceAspectRatio / frameAspectRatio;
    return applyTransform({
      cropMode,
      sourceX: 0,
      sourceY: 0,
      sourceWidth,
      sourceHeight,
      fitX: (1 - fitWidth) / 2,
      fitY: 0,
      fitWidth,
      fitHeight: 1
    });
  }

  if (sourceAspectRatio > frameAspectRatio) {
    const cropWidth = sourceHeight * frameAspectRatio;
    return applyTransform({
      cropMode,
      sourceX: (sourceWidth - cropWidth) / 2,
      sourceY: 0,
      sourceWidth: cropWidth,
      sourceHeight,
      fitX: 0,
      fitY: 0,
      fitWidth: 1,
      fitHeight: 1
    });
  }

  const cropHeight = sourceWidth / frameAspectRatio;
  return applyTransform({
    cropMode,
    sourceX: 0,
    sourceY: (sourceHeight - cropHeight) / 2,
    sourceWidth,
    sourceHeight: cropHeight,
    fitX: 0,
    fitY: 0,
    fitWidth: 1,
    fitHeight: 1
  });
};

const emptyMetrics = (cellX: number, cellY: number): CellMetrics => ({
  x: cellX,
  y: cellY,
  luminance: 0,
  sourceR: 0,
  sourceG: 0,
  sourceB: 0,
  alpha: 0,
  coverage: 0,
  localContrast: 0,
  edgeMagnitude: 0,
  variance: 0,
  gradientDirection: 0
});

export const sampleCellMetrics = (
  luminance: Float32Array,
  sourceData: Uint8ClampedArray,
  edges: EdgeMaps,
  width: number,
  height: number,
  alphaMap: Float32Array,
  coverageMap: Float32Array,
  columns: number,
  rows: number,
  cellX: number,
  cellY: number,
  frame: SamplingFrame
): CellMetrics => {
  let u0 = cellX / columns;
  let u1 = (cellX + 1) / columns;
  let v0 = cellY / rows;
  let v1 = (cellY + 1) / rows;

  const fitRight = frame.fitX + frame.fitWidth;
  const fitBottom = frame.fitY + frame.fitHeight;
  const overlapU0 = Math.max(u0, frame.fitX);
  const overlapU1 = Math.min(u1, fitRight);
  const overlapV0 = Math.max(v0, frame.fitY);
  const overlapV1 = Math.min(v1, fitBottom);

  if (overlapU0 >= overlapU1 || overlapV0 >= overlapV1) {
    return emptyMetrics(cellX, cellY);
  }

  u0 = (overlapU0 - frame.fitX) / Math.max(0.001, frame.fitWidth);
  u1 = (overlapU1 - frame.fitX) / Math.max(0.001, frame.fitWidth);
  v0 = (overlapV0 - frame.fitY) / Math.max(0.001, frame.fitHeight);
  v1 = (overlapV1 - frame.fitY) / Math.max(0.001, frame.fitHeight);

  if (Math.abs(frame.rotationRadians) > 0.0001) {
    const cos = Math.cos(frame.rotationRadians);
    const sin = Math.sin(frame.rotationRadians);
    const corners = [
      [u0, v0],
      [u1, v0],
      [u0, v1],
      [u1, v1]
    ].map(([u, v]) => {
      const dx = u - 0.5;
      const dy = v - 0.5;
      return [0.5 + dx * cos + dy * sin, 0.5 - dx * sin + dy * cos];
    });
    const nextU0 = Math.min(...corners.map(([u]) => u));
    const nextU1 = Math.max(...corners.map(([u]) => u));
    const nextV0 = Math.min(...corners.map(([, v]) => v));
    const nextV1 = Math.max(...corners.map(([, v]) => v));
    if (nextU1 <= 0 || nextU0 >= 1 || nextV1 <= 0 || nextV0 >= 1) {
      return emptyMetrics(cellX, cellY);
    }
    u0 = clamp01(nextU0);
    u1 = clamp01(nextU1);
    v0 = clamp01(nextV0);
    v1 = clamp01(nextV1);
  }

  const startX = clampIndex(Math.floor(frame.sourceX + u0 * frame.sourceWidth), 0, width - 1);
  const endX = clampIndex(
    Math.max(startX + 1, Math.ceil(frame.sourceX + u1 * frame.sourceWidth)),
    startX + 1,
    width
  );
  const startY = clampIndex(Math.floor(frame.sourceY + v0 * frame.sourceHeight), 0, height - 1);
  const endY = clampIndex(
    Math.max(startY + 1, Math.ceil(frame.sourceY + v1 * frame.sourceHeight)),
    startY + 1,
    height
  );

  let sum = 0;
  let alphaSum = 0;
  let coverageSum = 0;
  let sumSq = 0;
  let min = 1;
  let max = 0;
  let edgeSum = 0;
  let gx = 0;
  let gy = 0;
  let sourceR = 0;
  let sourceG = 0;
  let sourceB = 0;
  let sourceWeight = 0;
  let count = 0;

  for (let py = startY; py < endY; py += 1) {
    for (let px = startX; px < endX; px += 1) {
      const index = py * width + px;
      const sourceIndex = index * 4;
      const sourceAlpha = sourceData[sourceIndex + 3] / 255;
      const value = luminance[index];
      sum += value;
      alphaSum += alphaMap[index];
      coverageSum += coverageMap[index];
      sumSq += value * value;
      min = Math.min(min, value);
      max = Math.max(max, value);
      edgeSum += edges.magnitude[index];
      gx += edges.gradientX[index];
      gy += edges.gradientY[index];
      if (sourceAlpha > 0.001) {
        sourceR += sourceData[sourceIndex] * sourceAlpha;
        sourceG += sourceData[sourceIndex + 1] * sourceAlpha;
        sourceB += sourceData[sourceIndex + 2] * sourceAlpha;
        sourceWeight += sourceAlpha;
      }
      count += 1;
    }
  }

  const luminanceAverage = sum / Math.max(1, count);
  const variance = Math.max(0, sumSq / Math.max(1, count) - luminanceAverage * luminanceAverage);
  const safeSourceWeight = Math.max(1, sourceWeight);

  return {
    x: cellX,
    y: cellY,
    luminance: luminanceAverage,
    sourceR: sourceWeight > 0 ? sourceR / safeSourceWeight : 0,
    sourceG: sourceWeight > 0 ? sourceG / safeSourceWeight : 0,
    sourceB: sourceWeight > 0 ? sourceB / safeSourceWeight : 0,
    alpha: alphaSum / Math.max(1, count),
    coverage: coverageSum / Math.max(1, count),
    localContrast: max - min,
    edgeMagnitude: edgeSum / Math.max(1, count),
    variance,
    gradientDirection: Math.atan2(gy, gx)
  };
};

export const selectGlyph = (metrics: CellMetrics, glyphs: GlyphMetric[], options: WorkerRenderOptions) => {
  if (!glyphs.length) {
    return " ";
  }

  if (metrics.alpha <= 0.01) {
    return " ";
  }

  if (shouldSuppressGlyphForBlackCell(metrics, options)) {
    return " ";
  }

  const edgeSignal = clamp01(
    metrics.edgeMagnitude * 0.78 +
      metrics.localContrast * 0.34 +
      Math.sqrt(metrics.variance) * 0.22
  );
  const glyphIntensity = clamp01(options.ascii.glyphOpacity);
  if (glyphIntensity <= 0.001) {
    return " ";
  }

  const tonalLuminance = getTonalLuminance(metrics, options, options.toneProfile);
  const tone = Math.pow(tonalLuminance, Math.max(0.15, options.ascii.luminanceCurve));
  const flatPenalty =
    metrics.edgeMagnitude < 0.055 && metrics.localContrast < 0.1 ? 0.2 + (0.1 - metrics.localContrast) : 0;
  const foregroundOnlyDuotone =
    options.color.paletteMode === "single" && options.ascii.backgroundOpacity <= 0.001;
  const densityTone =
    options.ascii.glyphMode === "characters" && !foregroundOnlyDuotone && !options.image.invertTone
      ? 1 - tone
      : tone;
  const densityBias = (options.ascii.characterDensity - 0.82) * 0.055;
  const rawTargetDensity = clamp01(
    densityTone * 0.93 +
      edgeSignal * options.ascii.edgeEmphasis * 0.22 -
      flatPenalty * 0.34 +
      densityBias
  );
  const opacityRange =
    glyphIntensity <= 0.05
      ? glyphIntensity * 0.25
      : Math.pow((glyphIntensity - 0.05) / 0.95, 0.72);
  const targetDensity = clamp01(rawTargetDensity * opacityRange);
  const minGlyphDensity = glyphs[0]?.density ?? 0;
  const maxGlyphDensity = glyphs[glyphs.length - 1]?.density ?? 1;
  const glyphDensityRange = Math.max(0.001, maxGlyphDensity - minGlyphDensity);
  const maxRank = Math.max(1, glyphs.length - 1);
  const targetRank = targetDensity * maxRank;
  const rankInfluence = 0.88;

  let best = glyphs[0];
  let bestScore = Number.POSITIVE_INFINITY;
  let bestIndex = 0;

  for (const [index, glyph] of glyphs.entries()) {
    const normalizedGlyphDensity = clamp01((glyph.density - minGlyphDensity) / glyphDensityRange);
    const densityScore = Math.abs(normalizedGlyphDensity - targetDensity);
    const rankScore = Math.abs(index - targetRank) / maxRank;
    const edgePreference = edgeSignal * glyph.edgeWeight * 0.09;
    const flatPreference = (1 - edgeSignal) * glyph.edgeWeight * 0.035;
    const score =
      rankScore * rankInfluence +
      densityScore * (1 - rankInfluence + 0.18) -
      edgePreference +
      flatPreference;
    if (score < bestScore) {
      bestScore = score;
      best = glyph;
      bestIndex = index;
    }
  }

  const randomness = clamp01((options.ascii.randomness ?? 0) / 100);
  if (randomness > 0 && glyphs.length > 1) {
    const maxNeighborSpan = Math.max(1, Math.ceil(Math.min(6, (glyphs.length - 1) * 0.28)));
    const randomWeight = smoothstep(0.3, 1, tonalLuminance);
    const structureGuard = 0.42 + (1 - edgeSignal) * 0.58;
    const span = Math.round(maxNeighborSpan * Math.pow(randomness * randomWeight, 0.85) * structureGuard);
    if (span > 0) {
      const seed = options.ascii.randomSeed ?? 1337;
      const randomA = seededRandom(metrics.x, metrics.y, seed, 11);
      const randomB = seededRandom(metrics.x, metrics.y, seed, 29);
      const offset = Math.round((randomA + randomB - 1) * span);
      best = glyphs[clampIndex(bestIndex + offset, 0, glyphs.length - 1)] ?? best;
    }
  }

  return best.glyph;
};

export const computeLayerBrightness = (metrics: CellMetrics, options: WorkerRenderOptions) => {
  const lum = getTonalLuminance(metrics, options, options.toneProfile);
  const edgeSignal = clamp01(
    metrics.edgeMagnitude * options.ascii.edgeEmphasis +
      metrics.localContrast * 0.42 +
      Math.sqrt(metrics.variance) * 0.28
  );
  const contourLift = Math.pow(edgeSignal, 0.7) * 1.17;
  const flatness = 1 - clamp01(edgeSignal * 2.5);

  const backgroundIntensity = clamp01(options.ascii.backgroundOpacity);
  const glyphIntensity = clamp01(options.ascii.glyphOpacity);
  const backgroundBase = clamp01(lum - contourLift * 0.215 + flatness * 0.02325);
  const foregroundBase = clamp01(lum + contourLift * 0.54 + Math.pow(lum, 0.65) * 0.1);
  const background = clamp01(backgroundBase * backgroundIntensity);
  const foreground = clamp01(foregroundBase * glyphIntensity);

  return {
    background,
    foreground:
      options.ascii.glyphMode === "images"
        ? applyToneRandomness(foreground, metrics, edgeSignal, options, lum)
        : foreground
  };
};
