import type { ImageGlyphRecord } from "../renderer/types";

export interface ImageGlyphAtlasEntry {
  id: string;
  name: string;
  dataUrl: string;
  canvas: HTMLCanvasElement;
}

export interface ImageGlyphAtlas {
  glyphs: ImageGlyphAtlasEntry[];
  getGlyphForBrightness: (brightness: number) => ImageGlyphAtlasEntry | null;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export const getImageGlyphIndexForBrightness = (brightness: number, glyphCount: number) =>
  Math.min(Math.max(0, glyphCount - 1), Math.max(0, Math.round(clamp01(brightness) * Math.max(0, glyphCount - 1))));

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Image glyph failed to load."));
    image.src = src;
  });

export const createImageGlyphAtlas = async (records: ImageGlyphRecord[]): Promise<ImageGlyphAtlas | null> => {
  if (records.length < 2) {
    return null;
  }

  const glyphs: ImageGlyphAtlasEntry[] = [];
  for (const record of records) {
    const image = await loadImage(record.dataUrl);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, image.naturalWidth || image.width || 1);
    canvas.height = Math.max(1, image.naturalHeight || image.height || 1);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      continue;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    glyphs.push({
      id: record.id,
      name: record.name,
      dataUrl: record.dataUrl,
      canvas
    });
  }

  if (glyphs.length < 2) {
    return null;
  }

  return {
    glyphs,
    getGlyphForBrightness: (brightness: number) => {
      return glyphs[getImageGlyphIndexForBrightness(brightness, glyphs.length)] ?? null;
    }
  };
};
