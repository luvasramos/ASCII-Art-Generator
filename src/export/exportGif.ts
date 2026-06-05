import type {
  AnimatedExportQuality,
  AnimationSettings,
  AsciiSettings,
  BreakupSettings,
  ColorSettings,
  ExportOptions,
  FontSettings,
  FrameSettings,
  GlyphMetric,
  ImageSettings
} from "../renderer/types";
import { downloadBlob } from "./download";
import { isEchoActive, resolveEchoLayerAlpha } from "../renderer/echoComposite";
import { resolveAnimationFrameCount } from "../renderer/animationTiming";
import { resolveAnimatedExportFps, resolveAnimatedExportProfile } from "./exportQuality";
import { renderAsciiAnimationFrames } from "./renderAnimationFrames";

interface ExportAsciiGifArgs {
  sourceName: string;
  duration: number;
  font: FontSettings;
  ascii: AsciiSettings;
  image: ImageSettings;
  frame: FrameSettings;
  breakup: BreakupSettings;
  color: ColorSettings;
  exportOptions: ExportOptions;
  exportScale: number;
  glyphMetrics: GlyphMetric[];
  animation?: AnimationSettings;
  fps: number;
  quality?: AnimatedExportQuality;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
  onStatus?: (message: string) => void;
  getFrame: (timeSeconds: number, progress: number, frameIndex: number, totalFrames: number) => ImageData | Promise<ImageData>;
}

interface GifExportResult {
  fileName: string;
  totalFrames: number;
  fps: number;
  bytes: number;
  fallbackUsed: boolean;
}

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

class ByteWriter {
  private bytes: number[] = [];

  writeByte(value: number) {
    this.bytes.push(value & 255);
  }

  writeBytes(values: Iterable<number>) {
    for (const value of values) {
      this.writeByte(value);
    }
  }

  writeString(value: string) {
    for (let index = 0; index < value.length; index += 1) {
      this.writeByte(value.charCodeAt(index));
    }
  }

  writeU16(value: number) {
    this.writeByte(value & 255);
    this.writeByte((value >> 8) & 255);
  }

  toUint8Array() {
    return new Uint8Array(this.bytes);
  }
}

class BitWriter {
  private bytes: number[] = [];
  private bitBuffer = 0;
  private bitCount = 0;

  write(code: number, codeSize: number) {
    this.bitBuffer |= code << this.bitCount;
    this.bitCount += codeSize;
    while (this.bitCount >= 8) {
      this.bytes.push(this.bitBuffer & 255);
      this.bitBuffer >>= 8;
      this.bitCount -= 8;
    }
  }

  finish() {
    if (this.bitCount > 0) {
      this.bytes.push(this.bitBuffer & 255);
      this.bitBuffer = 0;
      this.bitCount = 0;
    }
    return this.bytes;
  }
}

const createAbortError = () => {
  const error = new Error("GIF export canceled.");
  error.name = "AbortError";
  return error;
};

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) {
    throw createAbortError();
  }
};

const yieldToBrowser = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0));

const buildGifFileName = (sourceName: string) => {
  const base = sourceName.replace(/\.[a-z0-9]+$/i, "").replace(/[^a-z0-9-_]+/gi, "-").toLowerCase();
  return `${base || "ascii-render"}-ascii-animation.gif`;
};

const clampByte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

const hexToRgb = (hex: string): RgbColor | null => {
  const match = hex.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!match) {
    return null;
  }
  const value = Number.parseInt(match[1], 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255
  };
};

const interpolateColor = (colors: RgbColor[], value: number): RgbColor => {
  if (colors.length <= 1) {
    return colors[0] ?? { r: 0, g: 0, b: 0 };
  }
  const scaled = Math.max(0, Math.min(1, value)) * (colors.length - 1);
  const low = Math.floor(scaled);
  const high = Math.min(colors.length - 1, low + 1);
  const mix = scaled - low;
  const a = colors[low];
  const b = colors[high];
  return {
    r: clampByte(a.r + (b.r - a.r) * mix),
    g: clampByte(a.g + (b.g - a.g) * mix),
    b: clampByte(a.b + (b.b - a.b) * mix)
  };
};

const dedupePalette = (palette: RgbColor[]) => {
  const seen = new Set<string>();
  return palette.filter((color) => {
    const key = `${color.r},${color.g},${color.b}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

const invertRgb = (color: RgbColor): RgbColor => ({
  r: 255 - color.r,
  g: 255 - color.g,
  b: 255 - color.b
});

const buildEchoBlendStops = (animation: AnimationSettings, desiredCount: number) => {
  const count = Math.max(0, Math.round(animation.echoCount));
  const stops = new Set<number>([0, 1]);
  for (let index = 0; index < count; index += 1) {
    stops.add(Math.max(0, Math.min(1, resolveEchoLayerAlpha(animation, index, count))));
  }
  for (let index = 1; stops.size < desiredCount && index < desiredCount - 1; index += 1) {
    stops.add(index / Math.max(1, desiredCount - 1));
  }
  return [...stops].sort((a, b) => a - b);
};

const buildPalette = (
  color: ColorSettings,
  exportOptions: ExportOptions,
  quality: AnimatedExportQuality,
  animation?: AnimationSettings
) => {
  const profile = resolveAnimatedExportProfile(quality, animation?.type);
  const transparent = exportOptions.transparentBackground;
  const usableColors = Math.max(2, Math.min(255, profile.paletteSize - (transparent ? 1 : 0)));
  const background = hexToRgb(exportOptions.backgroundColor) ?? hexToRgb(color.backgroundColor) ?? { r: 0, g: 0, b: 0 };
  const duotoneBackground = hexToRgb(color.backgroundColor) ?? background;
  const foreground = hexToRgb(color.foregroundColor) ?? { r: 255, g: 255, b: 255 };
  const mode = color.paletteMode as string;
  const echoAnimation = isEchoActive(animation) ? animation : null;
  let palette: RgbColor[];

  if (mode === "single" || mode === "duotone") {
    if (echoAnimation) {
      const desiredCount = Math.max(
        2,
        Math.min(usableColors, Math.max(8, Math.min(profile.paletteSize, Math.round(echoAnimation.echoCount) + 3)))
      );
      palette = buildEchoBlendStops(echoAnimation, desiredCount).map((value) =>
        interpolateColor([duotoneBackground, foreground], value)
      );
    } else {
      palette = [duotoneBackground, foreground].slice(0, usableColors);
    }
  } else if (mode === "source" && color.sourceColorMapping === "source-match") {
    const stops = (color.sourcePalette.length ? color.sourcePalette : [color.backgroundColor, color.foregroundColor])
      .map(hexToRgb)
      .filter((entry): entry is RgbColor => Boolean(entry));
    palette = [background, ...(stops.length ? stops : [foreground])].slice(0, usableColors);
  } else if (mode === "custom" || mode === "source") {
    const paletteSource = mode === "source" ? color.sourcePalette : color.customPalette;
    const stops = (paletteSource.length ? paletteSource : [color.backgroundColor, color.foregroundColor])
      .map(hexToRgb)
      .filter((entry): entry is RgbColor => Boolean(entry));
    const safeStops = stops.length ? stops : [background, foreground];
    const count = Math.max(2, Math.min(usableColors, Math.max(safeStops.length, Math.min(profile.paletteSize, usableColors))));
    palette = Array.from({ length: count }, (_, index) => interpolateColor(safeStops, count <= 1 ? 0 : index / (count - 1)));
  } else {
    const count = Math.max(2, usableColors);
    palette = Array.from({ length: count }, (_, index) => {
      const value = count <= 1 ? 0 : Math.round((index / (count - 1)) * 255);
      return { r: value, g: value, b: value };
    });
  }

  const activePalette = dedupePalette(color.invert ? palette.map(invertRgb) : palette).slice(0, usableColors);
  return transparent ? [{ r: 0, g: 0, b: 0 }, ...activePalette] : activePalette;
};

const gifFrameDelayCentiseconds = (frameIndex: number, fps: number) => {
  const currentTime = Math.round(((frameIndex + 1) / fps) * 100);
  const previousTime = Math.round((frameIndex / fps) * 100);
  return Math.max(1, currentTime - previousTime);
};

const colorTablePower = (paletteLength: number) => Math.max(1, Math.ceil(Math.log2(Math.max(2, paletteLength))));

const encodeLzwRawSafe = (indexedPixels: Uint8Array, minCodeSize: number) => {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  const codeSize = minCodeSize + 1;
  const writer = new BitWriter();
  const maxDataCodesBeforeClear = Math.max(1, clearCode - 2);
  let runLength = 0;

  writer.write(clearCode, codeSize);
  for (const index of indexedPixels) {
    if (runLength >= maxDataCodesBeforeClear) {
      writer.write(clearCode, codeSize);
      runLength = 0;
    }
    writer.write(index, codeSize);
    runLength += 1;
  }
  writer.write(endCode, codeSize);
  return writer.finish();
};

const encodeLzw = (indexedPixels: Uint8Array, minCodeSize: number) => {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  const resetDictionary = () => {
    const dictionary = new Map<string, number>();
    for (let index = 0; index < clearCode; index += 1) {
      dictionary.set(String.fromCharCode(index), index);
    }
    return dictionary;
  };

  let dictionary = resetDictionary();
  let nextCode = endCode + 1;
  let codeSize = minCodeSize + 1;
  const writer = new BitWriter();
  writer.write(clearCode, codeSize);

  if (indexedPixels.length === 0) {
    writer.write(endCode, codeSize);
    return writer.finish();
  }

  let prefix = String.fromCharCode(indexedPixels[0]);
  for (let index = 1; index < indexedPixels.length; index += 1) {
    const character = String.fromCharCode(indexedPixels[index]);
    const combined = prefix + character;
    if (dictionary.has(combined)) {
      prefix = combined;
      continue;
    }

    writer.write(dictionary.get(prefix) ?? indexedPixels[index - 1], codeSize);
    if (nextCode < 4096) {
      dictionary.set(combined, nextCode);
      nextCode += 1;
      if (nextCode === 1 << codeSize && codeSize < 12) {
        codeSize += 1;
      }
    } else {
      writer.write(clearCode, codeSize);
      dictionary = resetDictionary();
      nextCode = endCode + 1;
      codeSize = minCodeSize + 1;
    }
    prefix = character;
  }

  writer.write(dictionary.get(prefix) ?? indexedPixels[indexedPixels.length - 1], codeSize);
  writer.write(endCode, codeSize);
  return writer.finish();
};

class PaletteQuantizer {
  private cache = new Map<number, number>();
  private firstVisibleIndex: number;

  constructor(private palette: RgbColor[], private transparentIndex: number | null) {
    this.firstVisibleIndex = transparentIndex === null ? 0 : 1;
  }

  nearest(red: number, green: number, blue: number) {
    const key = (red << 16) | (green << 8) | blue;
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    let bestIndex = this.firstVisibleIndex;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = this.firstVisibleIndex; index < this.palette.length; index += 1) {
      const color = this.palette[index];
      const redDistance = red - color.r;
      const greenDistance = green - color.g;
      const blueDistance = blue - color.b;
      const distance = redDistance * redDistance + greenDistance * greenDistance + blueDistance * blueDistance;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }

    this.cache.set(key, bestIndex);
    return bestIndex;
  }
}

class GifEncoder {
  private writer = new ByteWriter();
  private tablePower: number;
  private tableSize: number;
  private minCodeSize: number;
  private previousFrame: Uint8Array | null = null;
  private pendingDelay = 0;

  constructor(
    private width: number,
    private height: number,
    private palette: RgbColor[],
    private transparentIndex: number | null,
    private safeLzw = false
  ) {
    if (width <= 0 || height <= 0) {
      throw new Error("GIF dimensions must be positive.");
    }
    this.tablePower = colorTablePower(palette.length);
    this.tableSize = 1 << this.tablePower;
    this.minCodeSize = Math.max(2, this.tablePower);

    this.writer.writeString("GIF89a");
    this.writer.writeU16(width);
    this.writer.writeU16(height);
    this.writer.writeByte(0x80 | 0x70 | (this.tablePower - 1));
    this.writer.writeByte(0);
    this.writer.writeByte(0);

    for (let index = 0; index < this.tableSize; index += 1) {
      const color = palette[index] ?? palette[palette.length - 1] ?? { r: 0, g: 0, b: 0 };
      this.writer.writeBytes([color.r, color.g, color.b]);
    }

    this.writer.writeByte(0x21);
    this.writer.writeByte(0xff);
    this.writer.writeByte(0x0b);
    this.writer.writeString("NETSCAPE2.0");
    this.writer.writeByte(0x03);
    this.writer.writeByte(0x01);
    this.writer.writeU16(0);
    this.writer.writeByte(0x00);
  }

  addFrame(indexedPixels: Uint8Array, delayCentiseconds: number, useFrameDiff: boolean) {
    if (!this.previousFrame || !useFrameDiff) {
      this.writeFrame(0, 0, this.width, this.height, indexedPixels, delayCentiseconds + this.pendingDelay, useFrameDiff ? 1 : 2);
      this.pendingDelay = 0;
      this.previousFrame = indexedPixels.slice();
      return;
    }

    let minX = this.width;
    let minY = this.height;
    let maxX = -1;
    let maxY = -1;
    for (let index = 0; index < indexedPixels.length; index += 1) {
      if (indexedPixels[index] === this.previousFrame[index]) {
        continue;
      }
      const x = index % this.width;
      const y = Math.floor(index / this.width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }

    if (maxX < minX || maxY < minY) {
      this.pendingDelay += delayCentiseconds;
      return;
    }

    const rectWidth = maxX - minX + 1;
    const rectHeight = maxY - minY + 1;
    const rectPixels = new Uint8Array(rectWidth * rectHeight);
    for (let y = 0; y < rectHeight; y += 1) {
      const sourceOffset = (minY + y) * this.width + minX;
      rectPixels.set(indexedPixels.subarray(sourceOffset, sourceOffset + rectWidth), y * rectWidth);
    }

    this.writeFrame(minX, minY, rectWidth, rectHeight, rectPixels, delayCentiseconds + this.pendingDelay, 1);
    this.pendingDelay = 0;
    this.previousFrame = indexedPixels.slice();
  }

  private writeFrame(
    left: number,
    top: number,
    width: number,
    height: number,
    indexedPixels: Uint8Array,
    delayCentiseconds: number,
    disposalMethod: 0 | 1 | 2
  ) {
    if (width <= 0 || height <= 0 || indexedPixels.length !== width * height) {
      throw new Error("GIF frame dimensions are invalid.");
    }
    const transparent = this.transparentIndex !== null;
    this.writer.writeByte(0x21);
    this.writer.writeByte(0xf9);
    this.writer.writeByte(0x04);
    this.writer.writeByte((disposalMethod << 2) | (transparent ? 0x01 : 0));
    this.writer.writeU16(Math.max(1, delayCentiseconds));
    this.writer.writeByte(this.transparentIndex ?? 0);
    this.writer.writeByte(0);

    this.writer.writeByte(0x2c);
    this.writer.writeU16(left);
    this.writer.writeU16(top);
    this.writer.writeU16(width);
    this.writer.writeU16(height);
    this.writer.writeByte(0);

    this.writer.writeByte(this.minCodeSize);
    const lzwData = this.safeLzw
      ? encodeLzwRawSafe(indexedPixels, this.minCodeSize)
      : encodeLzw(indexedPixels, this.minCodeSize);
    for (let offset = 0; offset < lzwData.length; offset += 255) {
      const block = lzwData.slice(offset, offset + 255);
      this.writer.writeByte(block.length);
      this.writer.writeBytes(block);
    }
    this.writer.writeByte(0);
  }

  finish() {
    if (this.pendingDelay > 0) {
      this.writeFrame(0, 0, 1, 1, new Uint8Array([this.transparentIndex ?? 0]), this.pendingDelay, 1);
      this.pendingDelay = 0;
    }
    this.writer.writeByte(0x3b);
    return this.writer.toUint8Array();
  }
}

const indexCanvas = (
  canvas: HTMLCanvasElement,
  quantizer: PaletteQuantizer,
  transparentIndex: number | null,
  alphaThreshold: number
) => {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("Canvas2D is unavailable for GIF export.");
  }

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const indexedPixels = new Uint8Array(canvas.width * canvas.height);
  for (let sourceIndex = 0, targetIndex = 0; sourceIndex < image.data.length; sourceIndex += 4, targetIndex += 1) {
    const alpha = image.data[sourceIndex + 3];
    if (transparentIndex !== null && alpha <= alphaThreshold) {
      indexedPixels[targetIndex] = transparentIndex;
      continue;
    }
    indexedPixels[targetIndex] = quantizer.nearest(
      image.data[sourceIndex],
      image.data[sourceIndex + 1],
      image.data[sourceIndex + 2]
    );
  }
  return indexedPixels;
};

const readU16 = (bytes: Uint8Array, offset: number) => bytes[offset] | (bytes[offset + 1] << 8);

const readSubBlocks = (bytes: Uint8Array, offset: number) => {
  const chunks: number[] = [];
  let cursor = offset;
  while (cursor < bytes.length) {
    const size = bytes[cursor];
    cursor += 1;
    if (size === 0) {
      return { data: new Uint8Array(chunks), offset: cursor };
    }
    if (cursor + size > bytes.length) {
      throw new Error("GIF data sub-block is truncated.");
    }
    for (let index = 0; index < size; index += 1) {
      chunks.push(bytes[cursor + index]);
    }
    cursor += size;
  }
  throw new Error("GIF data sub-block is missing a terminator.");
};

const createBitReader = (bytes: Uint8Array) => {
  let bitOffset = 0;
  return {
    read(codeSize: number) {
      if (bitOffset + codeSize > bytes.length * 8) {
        return null;
      }
      let code = 0;
      for (let bit = 0; bit < codeSize; bit += 1) {
        const absoluteBit = bitOffset + bit;
        if ((bytes[absoluteBit >> 3] >> (absoluteBit & 7)) & 1) {
          code |= 1 << bit;
        }
      }
      bitOffset += codeSize;
      return code;
    }
  };
};

const validateGifLzw = (data: Uint8Array, minCodeSize: number, expectedPixels: number) => {
  if (minCodeSize < 2 || minCodeSize > 8) {
    throw new Error("GIF frame has an invalid LZW minimum code size.");
  }

  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  const resetDictionary = () => {
    const dictionary: number[][] = [];
    for (let index = 0; index < clearCode; index += 1) {
      dictionary[index] = [index];
    }
    dictionary[clearCode] = [];
    dictionary[endCode] = [];
    return dictionary;
  };

  const reader = createBitReader(data);
  let dictionary = resetDictionary();
  let codeSize = minCodeSize + 1;
  let nextCode = endCode + 1;
  let previous: number[] | null = null;
  let outputPixels = 0;

  while (true) {
    const code = reader.read(codeSize);
    if (code === null) {
      throw new Error("GIF LZW stream ended before an end code.");
    }

    if (code === clearCode) {
      dictionary = resetDictionary();
      codeSize = minCodeSize + 1;
      nextCode = endCode + 1;
      previous = null;
      continue;
    }

    if (code === endCode) {
      if (outputPixels !== expectedPixels) {
        throw new Error("GIF LZW stream decoded an unexpected number of pixels.");
      }
      return;
    }

    let entry = dictionary[code];
    if (!entry && previous && code === nextCode) {
      entry = [...previous, previous[0]];
    }
    if (!entry) {
      throw new Error("GIF LZW stream references an invalid code.");
    }

    outputPixels += entry.length;
    if (outputPixels > expectedPixels) {
      throw new Error("GIF LZW stream decodes beyond the frame bounds.");
    }

    if (previous) {
      dictionary[nextCode] = [...previous, entry[0]];
      nextCode += 1;
      if (nextCode === 1 << codeSize && codeSize < 12) {
        codeSize += 1;
      }
    }
    previous = entry;
  }
};

const validateGifBytes = (bytes: Uint8Array) => {
  const header = String.fromCharCode(...bytes.slice(0, 6));
  if (header !== "GIF87a" && header !== "GIF89a") {
    throw new Error("Encoded file is not a GIF87a/GIF89a stream.");
  }
  if (bytes.length < 14) {
    throw new Error("Encoded GIF is too small to contain a valid screen descriptor.");
  }

  const logicalWidth = readU16(bytes, 6);
  const logicalHeight = readU16(bytes, 8);
  if (logicalWidth <= 0 || logicalHeight <= 0) {
    throw new Error("Encoded GIF has invalid logical dimensions.");
  }

  const packed = bytes[10];
  let offset = 13;
  if (packed & 0x80) {
    offset += 3 * (1 << ((packed & 0x07) + 1));
  }

  let frames = 0;
  let sawTrailer = false;
  while (offset < bytes.length) {
    const block = bytes[offset];
    offset += 1;

    if (block === 0x3b) {
      sawTrailer = true;
      break;
    }

    if (block === 0x21) {
      if (offset >= bytes.length) {
        throw new Error("GIF extension block is truncated.");
      }
      const label = bytes[offset];
      offset += 1;
      if (label === 0xf9) {
        if (bytes[offset] !== 4 || offset + 6 > bytes.length) {
          throw new Error("GIF graphic control extension is malformed.");
        }
        const delay = readU16(bytes, offset + 2);
        if (delay <= 0) {
          throw new Error("GIF frame delay must be greater than zero.");
        }
        offset += 6;
        continue;
      }
      offset = readSubBlocks(bytes, offset).offset;
      continue;
    }

    if (block !== 0x2c) {
      throw new Error("GIF contains an unknown block.");
    }

    if (offset + 9 > bytes.length) {
      throw new Error("GIF image descriptor is truncated.");
    }
    const left = readU16(bytes, offset);
    const top = readU16(bytes, offset + 2);
    const width = readU16(bytes, offset + 4);
    const height = readU16(bytes, offset + 6);
    const imagePacked = bytes[offset + 8];
    offset += 9;
    if (width <= 0 || height <= 0 || left + width > logicalWidth || top + height > logicalHeight) {
      throw new Error("GIF frame rectangle is outside the logical screen.");
    }
    if (imagePacked & 0x80) {
      offset += 3 * (1 << ((imagePacked & 0x07) + 1));
    }
    if (offset >= bytes.length) {
      throw new Error("GIF image data is missing.");
    }
    const minCodeSize = bytes[offset];
    offset += 1;
    const imageData = readSubBlocks(bytes, offset);
    offset = imageData.offset;
    validateGifLzw(imageData.data, minCodeSize, width * height);
    frames += 1;
  }

  if (!sawTrailer) {
    throw new Error("GIF trailer was not written.");
  }
  if (frames <= 0) {
    throw new Error("GIF contains no frames.");
  }
  return { frames, width: logicalWidth, height: logicalHeight };
};

export const exportAsciiGif = async ({
  sourceName,
  duration,
  font,
  ascii,
  image,
  frame,
  breakup,
  color,
  exportOptions,
  exportScale,
  glyphMetrics,
  animation,
  fps,
  quality,
  signal,
  onProgress,
  onStatus,
  getFrame
}: ExportAsciiGifArgs): Promise<GifExportResult> => {
  const exportQuality = quality ?? exportOptions.animatedExportQuality;
  const normalizedFps = resolveAnimatedExportFps(fps, exportQuality, animation?.type);
  const totalFrames = resolveAnimationFrameCount(duration, normalizedFps);
  const palette = buildPalette(color, exportOptions, exportQuality, animation);
  const transparentIndex = exportOptions.transparentBackground ? 0 : null;
  const alphaThreshold = (exportOptions.alphaThreshold / 100) * 255;

  const encode = async (mode: "optimized" | "safe") => {
    const quantizer = new PaletteQuantizer(palette, transparentIndex);
    let encoder: GifEncoder | null = null;
    const safeMode = mode === "safe";

    onStatus?.(
      safeMode
        ? `Rendering safe GIF fallback: ${totalFrames} full frames, ${palette.length} colors, ${normalizedFps}fps`
        : `Rendering optimized GIF: ${totalFrames} frames, ${palette.length} active colors, ${normalizedFps}fps`
    );

    for await (const renderedFrame of renderAsciiAnimationFrames({
      duration,
      fps: normalizedFps,
      font,
      ascii,
      image,
      frame,
      breakup,
      color,
      exportOptions,
      exportScale,
      glyphMetrics,
      animation,
      signal,
      getFrame
    })) {
      throwIfAborted(signal);
      if (!encoder) {
        encoder = new GifEncoder(
          renderedFrame.canvas.width,
          renderedFrame.canvas.height,
          palette,
          transparentIndex,
          safeMode
        );
      }
      const indexedPixels = indexCanvas(renderedFrame.canvas, quantizer, transparentIndex, alphaThreshold);
      encoder.addFrame(
        indexedPixels,
        gifFrameDelayCentiseconds(renderedFrame.frameIndex, normalizedFps),
        !safeMode && !exportOptions.transparentBackground
      );
      onProgress?.((renderedFrame.frameIndex + 1) / renderedFrame.totalFrames);
      onStatus?.(
        safeMode
          ? `Encoding safe GIF frame ${renderedFrame.frameIndex + 1} of ${renderedFrame.totalFrames}`
          : `Encoding optimized GIF frame ${renderedFrame.frameIndex + 1} of ${renderedFrame.totalFrames}`
      );
      if (renderedFrame.frameIndex % 2 === 1) {
        await yieldToBrowser();
      }
    }

    if (!encoder) {
      throw new Error("GIF export produced no frames.");
    }

    const bytes = encoder.finish();
    validateGifBytes(bytes);
    return bytes;
  };

  let fallbackUsed = false;
  let bytes: Uint8Array;
  try {
    bytes = await encode("optimized");
  } catch (error) {
    throwIfAborted(signal);
    fallbackUsed = true;
    onStatus?.(
      `Optimized GIF validation failed; retrying with safe full-frame encoding. ${
        error instanceof Error ? error.message : ""
      }`.trim()
    );
    bytes = await encode("safe");
  }

  const validation = validateGifBytes(bytes);
  if (validation.frames <= 0) {
    throw new Error("GIF validation failed before download.");
  }

  const fileName = buildGifFileName(sourceName);
  const blobBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(blobBuffer).set(bytes);
  downloadBlob(new Blob([blobBuffer], { type: "image/gif" }), fileName);
  return {
    fileName,
    totalFrames,
    fps: normalizedFps,
    bytes: bytes.byteLength,
    fallbackUsed
  };
};
