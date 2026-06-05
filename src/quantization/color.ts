import type { ColorSettings } from "../renderer/types";

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export const clampByte = (value: number) => Math.min(255, Math.max(0, Math.round(value)));

const asColorString = (color: unknown, fallback = "#000000") =>
  typeof color === "string" && color.trim() ? color : fallback;

export const parseHexColor = (hex: string): Rgb => {
  const normalized = asColorString(hex).replace("#", "").trim();
  const value =
    normalized.length === 3
      ? normalized
          .split("")
          .map((char) => `${char}${char}`)
          .join("")
      : normalized.padEnd(6, "0").slice(0, 6);

  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16)
  };
};

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

const applyBands = (value: number, bands: number) => {
  if (bands < 2) {
    return value;
  }
  return Math.round(value * (bands - 1)) / (bands - 1);
};

// Palette modes map luminance through the full color list, not just two fixed endpoints.
const safePalette = (settings: ColorSettings) => {
  const source = settings.paletteMode === "source" ? settings.sourcePalette : settings.customPalette;
  const palette = source?.filter((color) => typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color)) ?? [];
  if (palette.length >= 2) {
    return palette;
  }
  return [settings.backgroundColor, settings.foregroundColor];
};

const samplePalette = (value: number, palette: string[]) => {
  if (palette.length === 1) {
    return parseHexColor(palette[0]);
  }
  const scaled = clamp01(value) * (palette.length - 1);
  const index = Math.min(palette.length - 2, Math.max(0, Math.floor(scaled)));
  const local = scaled - index;
  const from = parseHexColor(palette[index]);
  const to = parseHexColor(palette[index + 1]);
  return {
    r: clampByte(mix(from.r, to.r, local)),
    g: clampByte(mix(from.g, to.g, local)),
    b: clampByte(mix(from.b, to.b, local))
  };
};

export const resolveCellColor = (
  brightness: number,
  settings: ColorSettings,
  layer: "foreground" | "background"
): string => {
  const curve = layer === "foreground" ? settings.foregroundCurve : settings.backgroundCurve;
  const crushed = Math.max(0, brightness - settings.shadowCrush) / Math.max(0.001, 1 - settings.shadowCrush);
  const clipped = Math.min(1, crushed / Math.max(0.001, 1 - settings.highlightClip));
  const compressed = mix(clipped, 0.5 + (clipped - 0.5) * 0.62, settings.tonalCompression);
  const corrected = applyBands(clamp01(Math.pow(compressed, curve)), settings.tonalBands);

  if (settings.paletteMode === "single") {
    return layer === "foreground" ? settings.foregroundColor : settings.backgroundColor;
  }

  if (settings.paletteMode === "custom" || settings.paletteMode === "source") {
    const base = samplePalette(corrected, safePalette(settings));
    return `rgb(${base.r}, ${base.g}, ${base.b})`;
  }

  const gray = clampByte(corrected * 255);
  return `rgb(${gray}, ${gray}, ${gray})`;
};

export const colorCacheKey = (color: string) => asColorString(color).replace(/\s+/g, "");

export const invertCssColor = (color: string) => {
  const source = asColorString(color);
  if (/^#[0-9a-f]{3,6}$/i.test(source.trim())) {
    const rgb = parseHexColor(source);
    return `rgb(${255 - rgb.r}, ${255 - rgb.g}, ${255 - rgb.b})`;
  }

  const rgbMatch = source.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (rgbMatch) {
    return `rgb(${255 - clampByte(Number(rgbMatch[1]))}, ${255 - clampByte(Number(rgbMatch[2]))}, ${255 - clampByte(Number(rgbMatch[3]))})`;
  }

  return source;
};

export const resolveDisplayCellColor = (
  brightness: number,
  settings: ColorSettings,
  layer: "foreground" | "background"
) => {
  const color = resolveCellColor(brightness, settings, layer);
  return settings.invert ? invertCssColor(color) : color;
};
