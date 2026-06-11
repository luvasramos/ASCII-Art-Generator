import type { ImageSettings, SourceToneSettings, ToneRangePreview } from "../renderer/types";
import {
  createToneColorAdjuster,
  hasToneColorAdjustments,
  type SourceRgbColor
} from "../renderer/colorAdjustments";

export type SourceRgb = SourceRgbColor;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const clampByte = (value: number) => Math.min(255, Math.max(0, Math.round(value)));

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const imageDataArray = (source: Uint8ClampedArray): Uint8ClampedArray<ArrayBuffer> => {
  const copy = new Uint8ClampedArray(source.length);
  copy.set(source);
  return copy;
};

const mix = (from: number, to: number, amount: number) => from + (to - from) * amount;

const smootherstep = (edge0: number, edge1: number, value: number) => {
  const t = clamp01((value - edge0) / Math.max(0.0001, edge1 - edge0));
  return t * t * t * (t * (t * 6 - 15) + 10);
};

export const defaultSourceToneSettings: SourceToneSettings = {
  contrast: 1,
  saturation: 0,
  hue: 0,
  shadows: 0,
  shadowsRange: 45,
  midtones: 0,
  midtonesRange: 60,
  highlights: 0,
  highlightsRange: 45
};

const toneRangeWidth = (range: number) => 0.04 + clamp01(range / 100) * 0.34;

const toneStrengthAmount = (control: number) => smootherstep(0, 1, Math.min(1, Math.abs(control) / 100));

const sourceLuminance01 = (color: SourceRgb) =>
  clamp01((0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b) / 255);

const hasSourceDetailAdjustment = (image: ImageSettings) =>
  image.blur > 0.0001 || image.sharpen > 0.0001;

export const invertSourcePixel = (
  red: number,
  green: number,
  blue: number,
  alpha: number
) => ({
  r: 255 - red,
  g: 255 - green,
  b: 255 - blue,
  a: alpha
});

export const resolveSourceExposure = (image: ImageSettings) =>
  clamp(image.exposure + image.brightness * 2, -2, 2) / 2;

export const resolveSourceToneSettings = (image: ImageSettings): SourceToneSettings => ({
  contrast: clamp(image.contrast, 0.35, 2.4),
  saturation: clamp(image.saturation, -100, 100),
  hue: clamp(image.hue, -180, 180),
  shadows: clamp(image.shadows, -100, 100),
  shadowsRange: clamp(image.shadowsRange, 0, 100),
  midtones: clamp(image.midtones, -100, 100),
  midtonesRange: clamp(image.midtonesRange, 0, 100),
  highlights: clamp(image.highlights, -100, 100),
  highlightsRange: clamp(image.highlightsRange, 0, 100)
});

const hasSourceToneAdjustments = (tone: SourceToneSettings) =>
  Math.abs(tone.shadows) > 0.0001 ||
  Math.abs(tone.midtones) > 0.0001 ||
  Math.abs(tone.highlights) > 0.0001;

export const applySourceExposureToChannel = (value: number, exposure: number) => {
  const normalized = clamp(exposure, -1, 1);
  if (normalized < 0) {
    return clampByte(value * (1 + normalized));
  }
  if (normalized > 0) {
    return clampByte(value + (255 - value) * normalized);
  }
  return clampByte(value);
};

export const getSourceToneRangeWeight = (
  luminance: number,
  range: ToneRangePreview,
  tone: SourceToneSettings
) => {
  const luma = clamp01(luminance);

  if (range === "shadows") {
    const width = toneRangeWidth(tone.shadowsRange);
    const distance = Math.max(0, luma - 0.2);
    return 1 - smootherstep(width * 0.25, width, distance);
  }

  if (range === "midtones") {
    const width = toneRangeWidth(tone.midtonesRange);
    const distance = Math.abs(luma - 0.5);
    return 1 - smootherstep(width * 0.25, width, distance);
  }

  const width = toneRangeWidth(tone.highlightsRange);
  const distance = Math.max(0, 0.8 - luma);
  return 1 - smootherstep(width * 0.25, width, distance);
};

const applyTonePushToChannel = (value: number, control: number, weight: number) => {
  const influence = clamp01(weight) * toneStrengthAmount(control);
  if (influence <= 0.0001) {
    return clampByte(value);
  }
  return clampByte(mix(value, control > 0 ? 255 : 0, influence));
};

const applySourceToneAdjustments = (color: SourceRgb, tone: SourceToneSettings) => {
  if (!hasSourceToneAdjustments(tone)) {
    return {
      r: clampByte(color.r),
      g: clampByte(color.g),
      b: clampByte(color.b)
    };
  }

  const luminance = sourceLuminance01(color);
  const shadowWeight = getSourceToneRangeWeight(luminance, "shadows", tone);
  const midtoneWeight = getSourceToneRangeWeight(luminance, "midtones", tone);
  const highlightWeight = getSourceToneRangeWeight(luminance, "highlights", tone);
  let adjusted = {
    r: clampByte(color.r),
    g: clampByte(color.g),
    b: clampByte(color.b)
  };

  adjusted = {
    r: applyTonePushToChannel(adjusted.r, tone.shadows, shadowWeight),
    g: applyTonePushToChannel(adjusted.g, tone.shadows, shadowWeight),
    b: applyTonePushToChannel(adjusted.b, tone.shadows, shadowWeight)
  };
  adjusted = {
    r: applyTonePushToChannel(adjusted.r, tone.midtones, midtoneWeight),
    g: applyTonePushToChannel(adjusted.g, tone.midtones, midtoneWeight),
    b: applyTonePushToChannel(adjusted.b, tone.midtones, midtoneWeight)
  };
  return {
    r: applyTonePushToChannel(adjusted.r, tone.highlights, highlightWeight),
    g: applyTonePushToChannel(adjusted.g, tone.highlights, highlightWeight),
    b: applyTonePushToChannel(adjusted.b, tone.highlights, highlightWeight)
  };
};

export const applySourceRgbProcessing = (
  color: SourceRgb,
  sourceInverted: boolean,
  sourceExposure: number,
  sourceTone: SourceToneSettings = defaultSourceToneSettings,
  colorAdjuster = createToneColorAdjuster({
    exposure: sourceExposure,
    contrast: sourceTone.contrast,
    saturation: sourceTone.saturation,
    hue: sourceTone.hue
  })
): SourceRgb => {
  const base = sourceInverted
    ? {
        r: 255 - color.r,
        g: 255 - color.g,
        b: 255 - color.b
      }
    : color;

  const colorAdjusted = colorAdjuster(base);
  return applySourceToneAdjustments(colorAdjusted, sourceTone);
};

export const applyImageSourceRgbProcessing = (color: SourceRgb, image: ImageSettings) =>
  applySourceRgbProcessing(color, image.invertTone, resolveSourceExposure(image), resolveSourceToneSettings(image));

const applyLegacySourceRgbProcessing = (
  color: SourceRgb,
  sourceInverted: boolean,
  sourceExposure: number,
  sourceTone: SourceToneSettings = defaultSourceToneSettings
): SourceRgb => {
  const base = sourceInverted
    ? {
        r: 255 - color.r,
        g: 255 - color.g,
        b: 255 - color.b
      }
    : color;

  const exposed = {
    r: applySourceExposureToChannel(base.r, sourceExposure),
    g: applySourceExposureToChannel(base.g, sourceExposure),
    b: applySourceExposureToChannel(base.b, sourceExposure)
  };
  return applySourceToneAdjustments(exposed, sourceTone);
};

const boxBlurPremultipliedRgb = (data: Uint8ClampedArray, width: number, height: number, radius: number) => {
  const blurRadius = Math.max(0, Math.round(radius));
  if (blurRadius <= 0) {
    return data;
  }

  const pixelCount = width * height;
  const horizontalR = new Float32Array(pixelCount);
  const horizontalG = new Float32Array(pixelCount);
  const horizontalB = new Float32Array(pixelCount);
  const horizontalA = new Float32Array(pixelCount);
  const output = new Uint8ClampedArray(data.length);

  for (let y = 0; y < height; y += 1) {
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let sumA = 0;

    for (let x = -blurRadius; x <= blurRadius; x += 1) {
      const clampedX = clamp(x, 0, width - 1);
      const index = (y * width + clampedX) * 4;
      const alpha = data[index + 3] / 255;
      sumR += data[index] * alpha;
      sumG += data[index + 1] * alpha;
      sumB += data[index + 2] * alpha;
      sumA += alpha;
    }

    for (let x = 0; x < width; x += 1) {
      const pixelIndex = y * width + x;
      const samples = blurRadius * 2 + 1;
      horizontalR[pixelIndex] = sumR / samples;
      horizontalG[pixelIndex] = sumG / samples;
      horizontalB[pixelIndex] = sumB / samples;
      horizontalA[pixelIndex] = sumA / samples;

      const removeX = clamp(x - blurRadius, 0, width - 1);
      const addX = clamp(x + blurRadius + 1, 0, width - 1);
      const removeIndex = (y * width + removeX) * 4;
      const addIndex = (y * width + addX) * 4;
      const removeAlpha = data[removeIndex + 3] / 255;
      const addAlpha = data[addIndex + 3] / 255;
      sumR += data[addIndex] * addAlpha - data[removeIndex] * removeAlpha;
      sumG += data[addIndex + 1] * addAlpha - data[removeIndex + 1] * removeAlpha;
      sumB += data[addIndex + 2] * addAlpha - data[removeIndex + 2] * removeAlpha;
      sumA += addAlpha - removeAlpha;
    }
  }

  for (let x = 0; x < width; x += 1) {
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let sumA = 0;

    for (let y = -blurRadius; y <= blurRadius; y += 1) {
      const clampedY = clamp(y, 0, height - 1);
      const index = clampedY * width + x;
      sumR += horizontalR[index];
      sumG += horizontalG[index];
      sumB += horizontalB[index];
      sumA += horizontalA[index];
    }

    for (let y = 0; y < height; y += 1) {
      const pixelIndex = y * width + x;
      const outputIndex = pixelIndex * 4;
      const samples = blurRadius * 2 + 1;
      const alpha = sumA / samples;
      output[outputIndex] = alpha > 0.0001 ? clampByte((sumR / samples) / alpha) : data[outputIndex];
      output[outputIndex + 1] = alpha > 0.0001 ? clampByte((sumG / samples) / alpha) : data[outputIndex + 1];
      output[outputIndex + 2] = alpha > 0.0001 ? clampByte((sumB / samples) / alpha) : data[outputIndex + 2];
      output[outputIndex + 3] = data[outputIndex + 3];

      const removeY = clamp(y - blurRadius, 0, height - 1);
      const addY = clamp(y + blurRadius + 1, 0, height - 1);
      const removeIndex = removeY * width + x;
      const addIndex = addY * width + x;
      sumR += horizontalR[addIndex] - horizontalR[removeIndex];
      sumG += horizontalG[addIndex] - horizontalG[removeIndex];
      sumB += horizontalB[addIndex] - horizontalB[removeIndex];
      sumA += horizontalA[addIndex] - horizontalA[removeIndex];
    }
  }

  return output;
};

const applySourceDetailAdjustment = (imageData: ImageData, image: ImageSettings) => {
  const blurRadius = Math.round(clamp(image.blur, 0, 16));
  const sharpenAmount = clamp(image.sharpen, 0, 2.4);
  if (blurRadius <= 0 && sharpenAmount <= 0.0001) {
    return imageData;
  }

  const { data, width, height } = imageData;
  if (blurRadius > 0) {
    const blurred = boxBlurPremultipliedRgb(data, width, height, blurRadius);
    return new ImageData(imageDataArray(blurred), width, height);
  }

  const blurRadiusForMask = 1 + Math.round(sharpenAmount);
  const softened = boxBlurPremultipliedRgb(data, width, height, blurRadiusForMask);
  const output = new Uint8ClampedArray(data);
  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3];
    if (alpha <= 0) {
      continue;
    }
    output[index] = clampByte(data[index] + (data[index] - softened[index]) * sharpenAmount);
    output[index + 1] = clampByte(data[index + 1] + (data[index + 1] - softened[index + 1]) * sharpenAmount);
    output[index + 2] = clampByte(data[index + 2] + (data[index + 2] - softened[index + 2]) * sharpenAmount);
  }
  return new ImageData(imageDataArray(output), width, height);
};

export const applySourcePixelProcessing = (imageData: ImageData, image: ImageSettings) => {
  const sourceExposure = resolveSourceExposure(image);
  const sourceTone = resolveSourceToneSettings(image);
  const needsColorProcessing = image.invertTone || Math.abs(sourceExposure) > 0.0001 || hasSourceToneAdjustments(sourceTone);
  if (!needsColorProcessing && !hasSourceDetailAdjustment(image)) {
    return imageData;
  }

  let processed = new ImageData(imageDataArray(imageData.data), imageData.width, imageData.height);
  if (needsColorProcessing) {
    for (let index = 0; index < processed.data.length; index += 4) {
      const pixel = applyLegacySourceRgbProcessing(
        {
          r: processed.data[index],
          g: processed.data[index + 1],
          b: processed.data[index + 2]
        },
        image.invertTone,
        sourceExposure,
        sourceTone
      );
      processed.data[index] = pixel.r;
      processed.data[index + 1] = pixel.g;
      processed.data[index + 2] = pixel.b;
    }
  }
  processed = applySourceDetailAdjustment(processed, image);
  return processed;
};

export const hasSourceColorPixelAdjustments = (image: ImageSettings) => {
  const sourceExposure = resolveSourceExposure(image);
  const sourceTone = resolveSourceToneSettings(image);
  return (
    image.invertTone ||
    Math.abs(sourceExposure) > 0.0001 ||
    hasSourceToneAdjustments(sourceTone) ||
    hasToneColorAdjustments({
      contrast: sourceTone.contrast,
      saturation: sourceTone.saturation,
      hue: sourceTone.hue
    }) ||
    hasSourceDetailAdjustment(image)
  );
};

export const applySourceColorPixelProcessing = (imageData: ImageData, image: ImageSettings) => {
  const sourceExposure = resolveSourceExposure(image);
  const sourceTone = resolveSourceToneSettings(image);
  const needsColorProcessing =
    image.invertTone ||
    Math.abs(sourceExposure) > 0.0001 ||
    hasSourceToneAdjustments(sourceTone) ||
    hasToneColorAdjustments({
      exposure: sourceExposure,
      contrast: sourceTone.contrast,
      saturation: sourceTone.saturation,
      hue: sourceTone.hue
    });
  if (!needsColorProcessing && !hasSourceDetailAdjustment(image)) {
    return imageData;
  }

  let processed = new ImageData(imageDataArray(imageData.data), imageData.width, imageData.height);
  if (needsColorProcessing) {
    const colorAdjuster = createToneColorAdjuster({
      exposure: sourceExposure,
      contrast: sourceTone.contrast,
      saturation: sourceTone.saturation,
      hue: sourceTone.hue
    });
    for (let index = 0; index < processed.data.length; index += 4) {
      const pixel = applySourceRgbProcessing(
        {
          r: processed.data[index],
          g: processed.data[index + 1],
          b: processed.data[index + 2]
        },
        image.invertTone,
        sourceExposure,
        sourceTone,
        colorAdjuster
      );
      processed.data[index] = pixel.r;
      processed.data[index + 1] = pixel.g;
      processed.data[index + 2] = pixel.b;
    }
  }
  processed = applySourceDetailAdjustment(processed, image);
  return processed;
};
