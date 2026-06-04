import type { ImageGlyphRecord } from "../renderer/types";

export const maxImageGlyphs = 128;

const imageGlyphExtensionPattern = /\.(png|svg|jpe?g|webp)$/i;
const zipExtensionPattern = /\.zip$/i;

const mimeFromName = (name: string, fallback = ""): ImageGlyphRecord["mimeType"] | null => {
  const lower = name.toLowerCase();
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (fallback === "image/svg+xml" || fallback === "image/png" || fallback === "image/jpeg" || fallback === "image/webp") {
    return fallback;
  }
  return null;
};

const decodeFileName = (bytes: Uint8Array) => new TextDecoder("utf-8").decode(bytes);

const readUint16 = (view: DataView, offset: number) => view.getUint16(offset, true);
const readUint32 = (view: DataView, offset: number) => view.getUint32(offset, true);

const toArrayBuffer = (bytes: Uint8Array) => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
};

const bytesToDataUrl = (bytes: Uint8Array, mimeType: string) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Image glyph import failed."));
    };
    reader.onerror = () => reject(new Error("Image glyph import failed."));
    reader.readAsDataURL(new Blob([toArrayBuffer(bytes)], { type: mimeType }));
  });

const fileToDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Image glyph import failed."));
    };
    reader.onerror = () => reject(new Error("Image glyph import failed."));
    reader.readAsDataURL(file);
  });

const inflateRaw = async (compressed: Uint8Array) => {
  const Decompression = (
    globalThis as typeof globalThis & {
      DecompressionStream?: new (format: string) => TransformStream<Uint8Array, Uint8Array>;
    }
  ).DecompressionStream;

  if (typeof Decompression !== "function") {
    throw new Error("This browser cannot decompress ZIP archives. Use folder upload or individual image files instead.");
  }

  const stream = new Blob([toArrayBuffer(compressed)]).stream().pipeThrough(new Decompression("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

const findEndOfCentralDirectory = (view: DataView) => {
  const minimumOffset = Math.max(0, view.byteLength - 0xffff - 22);
  for (let offset = view.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (readUint32(view, offset) === 0x06054b50) {
      return offset;
    }
  }
  return -1;
};

const naturalSort = <T extends { name: string }>(items: T[]) =>
  [...items].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));

export const isImageGlyphFile = (file: File) =>
  imageGlyphExtensionPattern.test(file.name) || Boolean(mimeFromName(file.name, file.type));

export const isZipFile = (file: File) => file.type === "application/zip" || zipExtensionPattern.test(file.name);

export const readImageGlyphFiles = async (files: File[], batchId = Date.now()): Promise<ImageGlyphRecord[]> => {
  const selectedFiles = naturalSort(files.filter(isImageGlyphFile).map((file) => ({ file, name: file.webkitRelativePath || file.name })));

  return Promise.all(
    selectedFiles.map(async ({ file, name }, index) => {
      const mimeType = mimeFromName(name, file.type);
      if (!mimeType) {
        throw new Error(`Unsupported image glyph format: ${name}`);
      }
      return {
        id: `image-glyph-${batchId}-${index}-${name}`,
        name: name.replace(/^.*[\\/]/, "").replace(/\.[a-z0-9]+$/i, ""),
        dataUrl: await fileToDataUrl(file),
        mimeType
      };
    })
  );
};

export const readImageGlyphZip = async (file: File, batchId = Date.now()): Promise<ImageGlyphRecord[]> => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = findEndOfCentralDirectory(view);
  if (eocdOffset < 0) {
    throw new Error("Could not read ZIP file.");
  }

  const entryCount = readUint16(view, eocdOffset + 10);
  const centralDirectoryOffset = readUint32(view, eocdOffset + 16);
  const entries: Array<{
    name: string;
    method: number;
    flags: number;
    compressedSize: number;
    localHeaderOffset: number;
    mimeType: ImageGlyphRecord["mimeType"];
  }> = [];
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount && offset < bytes.length; index += 1) {
    if (readUint32(view, offset) !== 0x02014b50) {
      break;
    }

    const flags = readUint16(view, offset + 8);
    const method = readUint16(view, offset + 10);
    const compressedSize = readUint32(view, offset + 20);
    const nameLength = readUint16(view, offset + 28);
    const extraLength = readUint16(view, offset + 30);
    const commentLength = readUint16(view, offset + 32);
    const localHeaderOffset = readUint32(view, offset + 42);
    const name = decodeFileName(bytes.subarray(offset + 46, offset + 46 + nameLength));
    const mimeType = mimeFromName(name);

    if (mimeType && !name.endsWith("/")) {
      entries.push({ name, method, flags, compressedSize, localHeaderOffset, mimeType });
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }

  const glyphs: ImageGlyphRecord[] = [];
  for (const [index, entry] of naturalSort(entries).entries()) {
    if (entry.flags & 1) {
      throw new Error("Encrypted ZIP glyph files are not supported.");
    }
    if (readUint32(view, entry.localHeaderOffset) !== 0x04034b50) {
      throw new Error(`Could not read ZIP entry: ${entry.name}`);
    }

    const localNameLength = readUint16(view, entry.localHeaderOffset + 26);
    const localExtraLength = readUint16(view, entry.localHeaderOffset + 28);
    const dataStart = entry.localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.subarray(dataStart, dataStart + entry.compressedSize);
    const imageBytes =
      entry.method === 0
        ? compressed
        : entry.method === 8
          ? await inflateRaw(compressed)
          : null;

    if (!imageBytes) {
      throw new Error(`Unsupported ZIP compression for ${entry.name}.`);
    }

    glyphs.push({
      id: `image-glyph-zip-${batchId}-${index}-${entry.name}`,
      name: entry.name.replace(/^.*[\\/]/, "").replace(/\.[a-z0-9]+$/i, ""),
      dataUrl: await bytesToDataUrl(imageBytes, entry.mimeType),
      mimeType: entry.mimeType
    });
  }

  return glyphs;
};
