import type { ImageGlyphRecord } from "../renderer/types";
import {
  builtinSelectedSvgGlyphPresetDescription,
  builtinSelectedSvgGlyphPresetGlyphSize,
  builtinSelectedSvgGlyphPresetId,
  builtinSelectedSvgGlyphPresetName,
  builtinSelectedSvgGlyphs,
  createBuiltinSelectedSvgGlyphRecords
} from "./builtinSelectedSvgGlyphPreset";

export interface BuiltInImageGlyphPreset {
  id: string;
  name: string;
  description: string;
  glyphSize: number;
  glyphs: string[];
}

const removedBuiltInImageGlyphPresetIds = new Set([
  "geometric-detail-32",
  "micro-halftone-32",
  "micro-halftone-48",
  "technical-detail-32"
]);

const removedBuiltInImageGlyphPresetNames = new Set([
  "Geometric Detail 32",
  "Micro Halftone 32",
  "Micro Halftone 48",
  "Technical Detail 32"
]);

export const builtInImageGlyphPresets: BuiltInImageGlyphPreset[] = [
  {
    id: builtinSelectedSvgGlyphPresetId,
    name: builtinSelectedSvgGlyphPresetName,
    description: builtinSelectedSvgGlyphPresetDescription,
    glyphSize: builtinSelectedSvgGlyphPresetGlyphSize,
    glyphs: builtinSelectedSvgGlyphs.map((glyph) => glyph.fileName)
  }
];

export const isRemovedBuiltInImageGlyphSourceName = (sourceName: unknown) =>
  typeof sourceName === "string" && removedBuiltInImageGlyphPresetNames.has(sourceName.trim());

export const isRemovedBuiltInImageGlyphAssetSource = (source: unknown) => {
  if (typeof source !== "string") {
    return false;
  }
  return Array.from(removedBuiltInImageGlyphPresetIds).some((id) =>
    new RegExp(`(?:^|[/\\\\])image-glyph-presets[/\\\\]${id}[/\\\\]`, "i").test(source)
  );
};

const mimeTypeForGlyph = (glyph: string): ImageGlyphRecord["mimeType"] => {
  const lower = glyph.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/svg+xml";
};

const resolvePresetAssetUrl = (preset: BuiltInImageGlyphPreset, glyph: string) =>
  new URL(`image-glyph-presets/${preset.id}/${glyph}`, document.baseURI).toString();

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Built-in image glyph preset failed to load."));
    };
    reader.onerror = () => reject(new Error("Built-in image glyph preset failed to load."));
    reader.readAsDataURL(blob);
  });

const fetchGlyphAsDataUrl = async (url: string, mimeType: ImageGlyphRecord["mimeType"]) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load built-in image glyph asset: ${url}`);
  }
  if (mimeType === "image/svg+xml") {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(await response.text())}`;
  }
  return blobToDataUrl(await response.blob());
};

export const loadBuiltInImageGlyphPreset = async (
  preset: BuiltInImageGlyphPreset,
  batchId = Date.now()
): Promise<ImageGlyphRecord[]> => {
  if (preset.id === builtinSelectedSvgGlyphPresetId) {
    return createBuiltinSelectedSvgGlyphRecords(batchId);
  }

  return Promise.all(
    preset.glyphs.map(async (glyph, index) => {
      const mimeType = mimeTypeForGlyph(glyph);
      const assetUrl = resolvePresetAssetUrl(preset, glyph);
      try {
        const dataUrl = await fetchGlyphAsDataUrl(assetUrl, mimeType);
        return {
          id: `built-in-image-glyph-${preset.id}-${batchId}-${index}`,
          name: glyph.replace(/\.[a-z0-9]+$/i, ""),
          dataUrl,
          mimeType
        };
      } catch (error) {
        console.warn("Could not load built-in glyph preset asset.", {
          preset: preset.id,
          glyph,
          assetUrl,
          error
        });
        throw new Error("Could not load built-in glyph preset.");
      }
    })
  );
};
