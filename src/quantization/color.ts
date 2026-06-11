import type { CellRenderData, ColorSettings } from "../renderer/types";
import { applySourceRgbProcessing, defaultSourceToneSettings } from "../processing/sourcePixels";

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

const invertRgb = (color: Rgb): Rgb => ({
  r: 255 - color.r,
  g: 255 - color.g,
  b: 255 - color.b
});

const pickPaletteColor = (value: number, palette: string[]) => {
  const index = Math.min(palette.length - 1, Math.max(0, Math.round(clamp01(value) * (palette.length - 1))));
  return parseHexColor(palette[index]);
};

const paletteRgbCache = new Map<string, Rgb[]>();

const paletteCacheKey = (palette: string[]) => palette.join("|").toUpperCase();

const safePaletteRgb = (settings: ColorSettings) => {
  const palette = safePalette(settings);
  const key = paletteCacheKey(palette);
  const cached = paletteRgbCache.get(key);
  if (cached) {
    return cached;
  }
  const parsed = palette.map(parseHexColor);
  if (paletteRgbCache.size > 64) {
    paletteRgbCache.clear();
  }
  paletteRgbCache.set(key, parsed);
  return parsed;
};

const safeDisplayPaletteRgb = (
  settings: ColorSettings,
  cell: Pick<CellRenderData, "sourceInverted" | "sourceExposure" | "sourceTone">
) => {
  const palette = safePaletteRgb(settings);
  if (settings.paletteMode !== "source") {
    return palette;
  }
  return palette.map((color) =>
    applySourceRgbProcessing(
      color,
      cell.sourceInverted,
      cell.sourceExposure,
      cell.sourceTone ?? defaultSourceToneSettings
    )
  );
};

const nearestPaletteRgb = (source: Rgb, palette: Rgb[]) => {
  let nearest = palette[0] ?? { r: 0, g: 0, b: 0 };
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const color of palette) {
    const dr = source.r - color.r;
    const dg = source.g - color.g;
    const db = source.b - color.b;
    const distance = dr * dr + dg * dg + db * db;
    if (distance < bestDistance) {
      bestDistance = distance;
      nearest = color;
    }
  }
  return nearest;
};

const rgbToCss = ({ r, g, b }: Rgb) => `rgb(${clampByte(r)}, ${clampByte(g)}, ${clampByte(b)})`;

export const isSourceMatchMode = (settings: ColorSettings) =>
  settings.paletteMode === "source" && settings.sourceColorMapping === "source-match";

export const resolveDisplaySourceMatchColor = (cell: CellRenderData, settings: ColorSettings) => {
  const source = {
    r: clampByte(cell.sourceR),
    g: clampByte(cell.sourceG),
    b: clampByte(cell.sourceB)
  };
  const matched = nearestPaletteRgb(source, safeDisplayPaletteRgb(settings, cell));
  const color = rgbToCss(matched);
  return settings.invert ? invertCssColor(color) : color;
};

export const resolveCellColor = (
  brightness: number,
  settings: ColorSettings,
  layer: "foreground" | "background",
  sourceInverted = false,
  sourceExposure = 0,
  sourceTone = defaultSourceToneSettings
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
    const palette = safePalette(settings);
    const base =
      settings.paletteMode === "source"
        ? applySourceRgbProcessing(pickPaletteColor(corrected, palette), sourceInverted, sourceExposure, sourceTone)
        : samplePalette(corrected, palette);
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
  layer: "foreground" | "background",
  sourceInverted = false,
  sourceExposure = 0,
  sourceTone = defaultSourceToneSettings
) => {
  const color = resolveCellColor(brightness, settings, layer, sourceInverted, sourceExposure, sourceTone);
  return settings.invert ? invertCssColor(color) : color;
};
