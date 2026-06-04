import type { ImageSettings, ToneRangePreview } from "../renderer/types";

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = clamp01((value - edge0) / Math.max(0.0001, edge1 - edge0));
  return t * t * (3 - 2 * t);
};

const smootherstep = (edge0: number, edge1: number, value: number) => {
  const t = clamp01((value - edge0) / Math.max(0.0001, edge1 - edge0));
  return t * t * t * (t * (t * 6 - 15) + 10);
};

const bellMask = (value: number, center: number, radius: number) => {
  const distance = Math.abs(value - center);
  return 1 - smootherstep(radius * 0.45, radius, distance);
};

const mix = (from: number, to: number, amount: number) => from + (to - from) * amount;

const percentRangeToLuminanceWidth = (range: number, min: number, max: number) =>
  min + clamp01(range / 100) * (max - min);

const tonalControlAmount = (control: number) => smoothstep(0, 1, Math.min(1, Math.abs(control) / 100));

const applyRegionalPush = (value: number, control: number, weight: number) => {
  const amount = tonalControlAmount(control);
  const influence = clamp01(weight) * amount;
  if (influence <= 0.0001) {
    return value;
  }

  return mix(value, control > 0 ? 1 : 0, influence);
};

export const getTonalRangeWeight = (
  value: number,
  range: ToneRangePreview,
  settings: ImageSettings
) => {
  const luminance = clamp01(value);
  const shadowRange = percentRangeToLuminanceWidth(settings.shadowsRange, 0.04, 0.82);
  const midtoneRadius = percentRangeToLuminanceWidth(settings.midtonesRange, 0.04, 0.46);
  const highlightRange = percentRangeToLuminanceWidth(settings.highlightsRange, 0.04, 0.82);

  if (range === "shadows") {
    return Math.pow(1 - smootherstep(shadowRange * 0.45, shadowRange, luminance), 1.05);
  }

  if (range === "midtones") {
    return Math.pow(bellMask(luminance, 0.5, midtoneRadius), 1.05);
  }

  return Math.pow(
    smootherstep(1 - highlightRange, 1 - highlightRange * 0.45, luminance),
    1.05
  );
};

export const applyAdvancedTonalRemap = (value: number, settings: ImageSettings) => {
  let remapped = value;
  const shadowWeight = getTonalRangeWeight(value, "shadows", settings);
  const midtoneWeight = getTonalRangeWeight(value, "midtones", settings);
  const highlightWeight = getTonalRangeWeight(value, "highlights", settings);

  remapped = applyRegionalPush(remapped, settings.shadows, shadowWeight);
  remapped = applyRegionalPush(remapped, settings.midtones, midtoneWeight);
  remapped = applyRegionalPush(remapped, settings.highlights, highlightWeight);

  return clamp01(remapped);
};

export const applyImageSettingsToLuminance = (raw: number, settings: ImageSettings) => {
  let value = raw;

  value = (value - settings.blackPoint) / Math.max(0.001, settings.whitePoint - settings.blackPoint);
  value = clamp01(value);
  value *= Math.pow(2, settings.exposure);
  value += settings.brightness;
  value = (value - 0.5) * settings.contrast + 0.5;
  value = clamp01(value);
  value = applyAdvancedTonalRemap(value, settings);

  if (settings.threshold > 0) {
    const hard = value >= 0.5 ? 1 : 0;
    value = value * (1 - settings.threshold) + hard * settings.threshold;
  }

  if (settings.posterization >= 2) {
    const levels = Math.round(settings.posterization);
    value = Math.round(value * (levels - 1)) / (levels - 1);
  }

  return clamp01(value);
};

export const buildLuminanceMap = (imageData: ImageData, settings: ImageSettings) => {
  const { data, width, height } = imageData;
  const luminance = new Float32Array(width * height);

  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const alpha = data[i + 3] / 255;
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const sourceLuminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const adjustedLuminance = settings.invertColors && alpha > 0 ? 1 - sourceLuminance : sourceLuminance;
    const raw = adjustedLuminance * alpha;
    luminance[p] = applyImageSettingsToLuminance(raw, settings);
  }

  return luminance;
};

export const boxBlur = (source: Float32Array, width: number, height: number, radius: number) => {
  if (radius <= 0) {
    return source;
  }

  const horizontal = new Float32Array(source.length);
  const output = new Float32Array(source.length);

  for (let y = 0; y < height; y += 1) {
    let sum = 0;
    for (let x = -radius; x <= radius; x += 1) {
      sum += source[y * width + Math.min(width - 1, Math.max(0, x))];
    }
    for (let x = 0; x < width; x += 1) {
      horizontal[y * width + x] = sum / (radius * 2 + 1);
      const removeX = Math.max(0, x - radius);
      const addX = Math.min(width - 1, x + radius + 1);
      sum += source[y * width + addX] - source[y * width + removeX];
    }
  }

  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let y = -radius; y <= radius; y += 1) {
      sum += horizontal[Math.min(height - 1, Math.max(0, y)) * width + x];
    }
    for (let y = 0; y < height; y += 1) {
      output[y * width + x] = sum / (radius * 2 + 1);
      const removeY = Math.max(0, y - radius);
      const addY = Math.min(height - 1, y + radius + 1);
      sum += horizontal[addY * width + x] - horizontal[removeY * width + x];
    }
  }

  return output;
};

export const applyBlurAndSharpen = (source: Float32Array, width: number, height: number, settings: ImageSettings) => {
  const blurRadius = Math.round(settings.blur);
  let blurred = source;
  if (blurRadius > 0) {
    const passes = blurRadius >= 10 ? 3 : blurRadius >= 5 ? 2 : 1;
    const passRadius = Math.max(1, Math.round(blurRadius / Math.sqrt(passes)));
    for (let pass = 0; pass < passes; pass += 1) {
      blurred = boxBlur(blurred, width, height, passRadius);
    }
  }

  if (settings.sharpen <= 0) {
    return blurred;
  }

  const soft = boxBlur(blurred, width, height, 1 + Math.round(settings.sharpen));
  const amount = settings.sharpen;
  const output = new Float32Array(source.length);

  for (let i = 0; i < source.length; i += 1) {
    output[i] = clamp01(blurred[i] + (blurred[i] - soft[i]) * amount);
  }

  return output;
};
