import { createGlyphAtlas } from "../atlas/glyphAtlas";
import { createImageGlyphAtlas } from "../atlas/imageGlyphAtlas";
import { renderAsciiToCanvas } from "../renderer/layeredCanvasRenderer";
import type { AsciiSettings, ColorSettings, ExportOptions, FontSettings, RenderGrid } from "../renderer/types";
import { normalizeCharacterSet } from "../ascii/charset";
import { downloadBlob } from "./download";
import { scaleFontForRenderResolution } from "../renderer/geometry";

interface ExportPngArgs {
  grid: RenderGrid;
  font: FontSettings;
  ascii: AsciiSettings;
  color: ColorSettings;
  exportOptions: ExportOptions;
  scale: number;
  dpi: number;
  fileName: string;
}

type RenderPngArgs = Omit<ExportPngArgs, "fileName">;

const dataUrlToBlob = (dataUrl: string) => {
  const [header, payload] = dataUrl.split(",");
  if (!header || !payload) {
    throw new Error("PNG export failed");
  }

  const mime = header.match(/data:([^;]+)/)?.[1] ?? "image/png";
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mime });
};

const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10] as const;

let crcTable: Uint32Array | null = null;

const getCrcTable = () => {
  if (crcTable) {
    return crcTable;
  }
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  crcTable = table;
  return table;
};

const crc32 = (bytes: Uint8Array) => {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const writeUint32 = (target: Uint8Array, offset: number, value: number) => {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
};

const createPngChunk = (type: string, data: Uint8Array) => {
  const typeBytes = new TextEncoder().encode(type);
  const chunk = new Uint8Array(12 + data.length);
  writeUint32(chunk, 0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  writeUint32(chunk, 8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
};

const createDpiChunk = (dpi: number) => {
  const pixelsPerMeter = Math.max(1, Math.round(dpi * 39.37007874015748));
  const data = new Uint8Array(9);
  writeUint32(data, 0, pixelsPerMeter);
  writeUint32(data, 4, pixelsPerMeter);
  data[8] = 1;
  return createPngChunk("pHYs", data);
};

const toBlobPart = (bytes: Uint8Array) => {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
};

const applyPngDpi = async (blob: Blob, dpi: number) => {
  if (!Number.isFinite(dpi) || dpi <= 0) {
    return blob;
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length < 33 || !pngSignature.every((value, index) => bytes[index] === value)) {
    return blob;
  }

  const chunks: Uint8Array[] = [bytes.subarray(0, 8)];
  const dpiChunk = createDpiChunk(dpi);
  let offset = 8;
  let inserted = false;

  while (offset + 12 <= bytes.length) {
    const length =
      (bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3];
    const safeLength = length >>> 0;
    const end = offset + 12 + safeLength;
    if (end > bytes.length) {
      return blob;
    }
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    if (type !== "pHYs") {
      chunks.push(bytes.subarray(offset, end));
    }
    if (type === "IHDR" && !inserted) {
      chunks.push(dpiChunk);
      inserted = true;
    }
    offset = end;
    if (type === "IEND") {
      break;
    }
  }

  return inserted ? new Blob(chunks.map(toBlobPart), { type: "image/png" }) : blob;
};

export const createCanvasPngBlob = (canvas: HTMLCanvasElement, dpi?: number) =>
  new Promise<Blob>((resolve, reject) => {
    if (typeof canvas.toBlob === "function") {
      canvas.toBlob((result) => {
        if (result) {
          resolve(result);
        } else {
          reject(new Error("PNG export failed"));
        }
      }, "image/png");
      return;
    }

    try {
      resolve(dataUrlToBlob(canvas.toDataURL("image/png")));
    } catch (error) {
      reject(error instanceof Error ? error : new Error("PNG export failed"));
    }
  }).then((blob) => (typeof dpi === "number" ? applyPngDpi(blob, dpi) : blob));

export const createPngBlob = async ({ grid, font, ascii, color, exportOptions, scale, dpi }: RenderPngArgs) => {
  const renderFont = scaleFontForRenderResolution(font, ascii.renderResolution);
  const exportFont: FontSettings = {
    ...renderFont,
    size: renderFont.size * scale,
    letterSpacing: renderFont.letterSpacing * scale
  };
  const atlas = createGlyphAtlas(
    normalizeCharacterSet(ascii.charset),
    exportFont,
    grid.cellWidth * scale,
    grid.cellHeight * scale,
    ascii.characterScale
  );
  const imageGlyphAtlas =
    ascii.glyphMode === "images" && ascii.imageGlyphs.length >= 2
      ? await createImageGlyphAtlas(ascii.imageGlyphs)
      : null;
  const scaledGrid: RenderGrid = {
    ...grid,
    cellWidth: grid.cellWidth * scale,
    cellHeight: grid.cellHeight * scale,
    gapX: grid.gapX * scale,
    gapY: grid.gapY * scale,
    width: grid.width * scale,
    height: grid.height * scale
  };
  const canvas = renderAsciiToCanvas({
    grid: scaledGrid,
    atlas,
    imageGlyphAtlas,
    font: exportFont,
    ascii,
    color,
    exportOptions,
    scale: 1
  });

  return createCanvasPngBlob(canvas, dpi);
};

export const exportPng = async ({ fileName, ...args }: ExportPngArgs) => {
  const blob = await createPngBlob(args);
  downloadBlob(blob, fileName);
};
