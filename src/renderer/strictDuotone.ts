import { parseHexColor, resolveDisplayCellColor } from "../quantization/color";
import type { AnimationSettings, ColorSettings, ExportOptions, FontSettings } from "./types";

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

const clampByte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

const parseCssRgb = (color: string): RgbColor | null => {
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!match) {
    return null;
  }
  return {
    r: clampByte(Number(match[1])),
    g: clampByte(Number(match[2])),
    b: clampByte(Number(match[3]))
  };
};

const parseDisplayColor = (color: string): RgbColor => {
  if (/^#[0-9a-f]{3,6}$/i.test(color.trim())) {
    return parseHexColor(color);
  }
  return parseCssRgb(color) ?? { r: 0, g: 0, b: 0 };
};

const squaredDistance = (red: number, green: number, blue: number, color: RgbColor) => {
  const dr = red - color.r;
  const dg = green - color.g;
  const db = blue - color.b;
  return dr * dr + dg * dg + db * db;
};

export const isStrictDuotoneColorMode = (color: ColorSettings) =>
  color.paletteMode === "single" || (color.paletteMode as string) === "duotone";

export const matrixTransitionColorCanRender = (animation?: AnimationSettings | null) =>
  Boolean(
    animation?.enabled &&
      animation.type !== "matrix" &&
      animation.matrixOverlayEnabled &&
      animation.matrixTransitionColorEnabled &&
      animation.matrixTransitionAmount > 0
  );

export const resolveHintsOfColorAmount = (
  color: ColorSettings,
  animation?: AnimationSettings | null,
  animationTimeSeconds?: number
) => {
  if (!color.hitsOfColor.enabled) {
    return 0;
  }
  const animatedFrame =
    color.hitsOfColor.animated &&
    Boolean(animation?.enabled) &&
    typeof animationTimeSeconds === "number" &&
    Number.isFinite(animationTimeSeconds);
  return animatedFrame ? color.hitsOfColor.animatedHintAmount : color.hitsOfColor.amount;
};

export const hintsOfColorCanRender = (color: ColorSettings, animation?: AnimationSettings | null) => {
  if (!color.hitsOfColor.enabled) {
    return false;
  }
  if (animation?.enabled && color.hitsOfColor.animated) {
    return color.hitsOfColor.animatedHintAmount > 0;
  }
  return color.hitsOfColor.amount > 0;
};

export const matrixTransitionColorCanRenderForColor = (
  animation: AnimationSettings | undefined | null,
  color: ColorSettings
) =>
  !isStrictDuotoneColorMode(color) &&
  matrixTransitionColorCanRender(animation) &&
  !hintsOfColorCanRender(color, animation);

export const hasDuotoneColorExceptions = (
  color: ColorSettings,
  animation?: AnimationSettings | null
) => hintsOfColorCanRender(color, animation);

export const isStrictDuotoneWithoutColorExceptions = (
  color: ColorSettings,
  animation?: AnimationSettings | null
) => isStrictDuotoneColorMode(color) && !hasDuotoneColorExceptions(color, animation);

export const shouldForceStrictDuotonePixels = ({
  color,
  animation,
  font
}: {
  color: ColorSettings;
  animation?: AnimationSettings | null;
  font: FontSettings;
}) =>
  isStrictDuotoneWithoutColorExceptions(color, animation) &&
  !font.antiAlias &&
  !font.smoothing;

export const getStrictDuotoneDisplayPalette = (color: ColorSettings) => ({
  background: parseDisplayColor(resolveDisplayCellColor(0, color, "background")),
  foreground: parseDisplayColor(resolveDisplayCellColor(1, color, "foreground"))
});

export const forceStrictDuotoneCanvas = (
  canvas: HTMLCanvasElement,
  color: ColorSettings,
  exportOptions?: ExportOptions
) => {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context || canvas.width <= 0 || canvas.height <= 0) {
    return;
  }

  const { background, foreground } = getStrictDuotoneDisplayPalette(color);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const transparent = Boolean(exportOptions?.transparentBackground);
  const alphaThreshold = ((exportOptions?.alphaThreshold ?? 0) / 100) * 255;

  for (let index = 0; index < image.data.length; index += 4) {
    const alpha = image.data[index + 3];
    if (transparent && alpha <= alphaThreshold) {
      image.data[index + 3] = 0;
      continue;
    }
    const nearest =
      squaredDistance(image.data[index], image.data[index + 1], image.data[index + 2], foreground) <=
      squaredDistance(image.data[index], image.data[index + 1], image.data[index + 2], background)
        ? foreground
        : background;
    image.data[index] = nearest.r;
    image.data[index + 1] = nearest.g;
    image.data[index + 2] = nearest.b;
  }

  context.putImageData(image, 0, 0);
};
