export interface ToneColorAdjustmentSettings {
  exposure?: number;
  contrast?: number;
  saturation?: number;
  hue?: number;
}

export interface SourceRgbColor {
  r: number;
  g: number;
  b: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const clampByte = (value: number) => Math.min(255, Math.max(0, Math.round(value)));

const normalizedExposure = (value = 0) => clamp(value, -1, 1);
const normalizedContrast = (value = 1) => clamp(value, 0.35, 2.4);
const normalizedSaturation = (value = 0) => clamp(value, -100, 100);
const normalizedHue = (value = 0) => clamp(value, -180, 180);

export const hasToneColorAdjustments = (settings: ToneColorAdjustmentSettings) =>
  Math.abs(normalizedExposure(settings.exposure)) > 0.0001 ||
  Math.abs(normalizedContrast(settings.contrast) - 1) > 0.0001 ||
  Math.abs(normalizedSaturation(settings.saturation)) > 0.0001 ||
  Math.abs(normalizedHue(settings.hue)) > 0.0001;

export const createToneColorAdjuster = (settings: ToneColorAdjustmentSettings) => {
  const exposure = normalizedExposure(settings.exposure);
  const contrast = normalizedContrast(settings.contrast);
  const saturationScale = 1 + normalizedSaturation(settings.saturation) / 100;
  const hueRadians = (normalizedHue(settings.hue) / 180) * Math.PI;
  const hueCos = Math.cos(hueRadians);
  const hueSin = Math.sin(hueRadians);
  const useExposure = Math.abs(exposure) > 0.0001;
  const useContrast = Math.abs(contrast - 1) > 0.0001;
  const useSaturation = Math.abs(saturationScale - 1) > 0.0001;
  const useHue = Math.abs(hueRadians) > 0.0001;

  return (color: SourceRgbColor): SourceRgbColor => {
    let r = clamp(color.r, 0, 255);
    let g = clamp(color.g, 0, 255);
    let b = clamp(color.b, 0, 255);

    if (useExposure) {
      if (exposure < 0) {
        r *= 1 + exposure;
        g *= 1 + exposure;
        b *= 1 + exposure;
      } else {
        r += (255 - r) * exposure;
        g += (255 - g) * exposure;
        b += (255 - b) * exposure;
      }
    }

    if (useContrast) {
      r = (r - 127.5) * contrast + 127.5;
      g = (g - 127.5) * contrast + 127.5;
      b = (b - 127.5) * contrast + 127.5;
    }

    if (useSaturation) {
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = luma + (r - luma) * saturationScale;
      g = luma + (g - luma) * saturationScale;
      b = luma + (b - luma) * saturationScale;
    }

    if (useHue) {
      const nextR =
        (0.213 + hueCos * 0.787 - hueSin * 0.213) * r +
        (0.715 - hueCos * 0.715 - hueSin * 0.715) * g +
        (0.072 - hueCos * 0.072 + hueSin * 0.928) * b;
      const nextG =
        (0.213 - hueCos * 0.213 + hueSin * 0.143) * r +
        (0.715 + hueCos * 0.285 + hueSin * 0.14) * g +
        (0.072 - hueCos * 0.072 - hueSin * 0.283) * b;
      const nextB =
        (0.213 - hueCos * 0.213 - hueSin * 0.787) * r +
        (0.715 - hueCos * 0.715 + hueSin * 0.715) * g +
        (0.072 + hueCos * 0.928 + hueSin * 0.072) * b;
      r = nextR;
      g = nextG;
      b = nextB;
    }

    return {
      r: clampByte(r),
      g: clampByte(g),
      b: clampByte(b)
    };
  };
};

export const applyToneColorAdjustments = (
  color: SourceRgbColor,
  settings: ToneColorAdjustmentSettings
) => createToneColorAdjuster(settings)(color);
