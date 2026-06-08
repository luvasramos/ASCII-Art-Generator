import type { ImageGlyphRecord } from "../renderer/types";

export const builtinSelectedSvgGlyphPresetId = "selected-1x1";
export const builtinSelectedSvgGlyphPresetName = "Selected 1x1 Glyphs";
export const builtinSelectedSvgGlyphPresetDescription = "A curated set of bundled square SVG image glyphs.";
export const builtinSelectedSvgGlyphPresetGlyphSize = 1;

export const builtinSelectedSvgGlyphs = [
  {
    name: "0_glyph",
    fileName: "0_glyph.svg",
    svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"64\" height=\"64\" viewBox=\"0 0 1 1\" preserveAspectRatio=\"xMidYMid meet\" shape-rendering=\"geometricPrecision\"><title>empty</title><g></g></svg>"
  },
  {
    name: "1_glyph",
    fileName: "1_glyph.svg",
    svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"64\" height=\"64\" viewBox=\"0 0 1 1\" preserveAspectRatio=\"xMidYMid meet\" shape-rendering=\"geometricPrecision\"><title>small dot</title><g transform=\"scale(0.015625)\"><circle cx=\"32\" cy=\"32\" r=\"4\" fill=\"#FFFFFF\" /></g></svg>"
  },
  {
    name: "2_glyph",
    fileName: "2_glyph.svg",
    svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"64\" height=\"64\" viewBox=\"0 0 1 1\" preserveAspectRatio=\"xMidYMid meet\" shape-rendering=\"geometricPrecision\"><title>small plus</title><g transform=\"scale(0.015625)\"><rect x=\"29.5\" y=\"18\" width=\"5\" height=\"28\" fill=\"#FFFFFF\" /><rect x=\"18\" y=\"29.5\" width=\"28\" height=\"5\" fill=\"#FFFFFF\" /></g></svg>"
  },
  {
    name: "3_glyph",
    fileName: "3_glyph.svg",
    svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"64\" height=\"64\" viewBox=\"0 0 1 1\" preserveAspectRatio=\"xMidYMid meet\" shape-rendering=\"geometricPrecision\"><title>small x</title><g transform=\"scale(0.015625)\"><line x1=\"20\" y1=\"20\" x2=\"44\" y2=\"44\" stroke=\"#FFFFFF\" stroke-width=\"4.6\" stroke-linecap=\"butt\" /><line x1=\"44\" y1=\"20\" x2=\"20\" y2=\"44\" stroke=\"#FFFFFF\" stroke-width=\"4.6\" stroke-linecap=\"butt\" /></g></svg>"
  },
  {
    name: "4_glyph",
    fileName: "4_glyph.svg",
    svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"64\" height=\"64\" viewBox=\"0 0 1 1\" preserveAspectRatio=\"xMidYMid meet\" shape-rendering=\"geometricPrecision\"><title>micro checker block</title><g transform=\"scale(0.015625)\"><rect x=\"8\" y=\"8\" width=\"8\" height=\"8\" fill=\"#FFFFFF\" /><rect x=\"24\" y=\"8\" width=\"8\" height=\"8\" fill=\"#FFFFFF\" /><rect x=\"40\" y=\"8\" width=\"8\" height=\"8\" fill=\"#FFFFFF\" /><rect x=\"16\" y=\"16\" width=\"8\" height=\"8\" fill=\"#FFFFFF\" /><rect x=\"32\" y=\"16\" width=\"8\" height=\"8\" fill=\"#FFFFFF\" /><rect x=\"48\" y=\"16\" width=\"8\" height=\"8\" fill=\"#FFFFFF\" /><rect x=\"8\" y=\"24\" width=\"8\" height=\"8\" fill=\"#FFFFFF\" /><rect x=\"24\" y=\"24\" width=\"8\" height=\"8\" fill=\"#FFFFFF\" /><rect x=\"40\" y=\"24\" width=\"8\" height=\"8\" fill=\"#FFFFFF\" /><rect x=\"16\" y=\"32\" width=\"8\" height=\"8\" fill=\"#FFFFFF\" /><rect x=\"32\" y=\"32\" width=\"8\" height=\"8\" fill=\"#FFFFFF\" /><rect x=\"48\" y=\"32\" width=\"8\" height=\"8\" fill=\"#FFFFFF\" /><rect x=\"8\" y=\"40\" width=\"8\" height=\"8\" fill=\"#FFFFFF\" /><rect x=\"24\" y=\"40\" width=\"8\" height=\"8\" fill=\"#FFFFFF\" /><rect x=\"40\" y=\"40\" width=\"8\" height=\"8\" fill=\"#FFFFFF\" /><rect x=\"16\" y=\"48\" width=\"8\" height=\"8\" fill=\"#FFFFFF\" /><rect x=\"32\" y=\"48\" width=\"8\" height=\"8\" fill=\"#FFFFFF\" /><rect x=\"48\" y=\"48\" width=\"8\" height=\"8\" fill=\"#FFFFFF\" /></g></svg>"
  },
  {
    name: "5_glyph",
    fileName: "5_glyph.svg",
    svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"64\" height=\"64\" viewBox=\"0 0 1 1\" preserveAspectRatio=\"xMidYMid meet\" shape-rendering=\"geometricPrecision\"><title>ring</title><defs><style>.st0{fill:#fff;}</style></defs><g transform=\"scale(0.023529411764705882)\"><g id=\"Layer_1\"><path class=\"st0\" d=\"M21.2,0C9.5,0,0,9.5,0,21.2s9.5,21.2,21.2,21.2,21.2-9.5,21.2-21.2S33,0,21.2,0ZM21.2,31.7c-5.8,0-10.5-4.7-10.5-10.5s4.7-10.5,10.5-10.5,10.5,4.7,10.5,10.5-4.7,10.5-10.5,10.5Z\"/></g></g></svg>"
  },
  {
    name: "6_glyph",
    fileName: "6_glyph.svg",
    svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"64\" height=\"64\" viewBox=\"0 0 1 1\" preserveAspectRatio=\"xMidYMid meet\" shape-rendering=\"geometricPrecision\"><title>filled circle</title><defs><style>.st0{fill:#fff;}</style></defs><g transform=\"scale(0.023529411764705882)\"><g id=\"Layer_1\"><path class=\"st0\" d=\"M21.2,0C9.5,0,0,9.5,0,21.2s9.5,21.2,21.2,21.2,21.2-9.5,21.2-21.2S33,0,21.2,0Z\"/></g></g></svg>"
  },
  {
    name: "7_glyph",
    fileName: "7_glyph.svg",
    svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"64\" height=\"64\" viewBox=\"0 0 1 1\" preserveAspectRatio=\"xMidYMid meet\" shape-rendering=\"geometricPrecision\"><title>large plus</title><defs><style>.st0{fill:#fff;}</style></defs><g transform=\"scale(0.015625)\"><g id=\"Layer_1\"><g><rect class=\"st0\" x=\"23.9\" width=\"16.2\" height=\"64\"/><rect class=\"st0\" x=\"23.9\" width=\"16.2\" height=\"64\" transform=\"translate(64) rotate(90)\"/></g></g></g></svg>"
  },
  {
    name: "8_glyph",
    fileName: "8_glyph.svg",
    svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"64\" height=\"64\" viewBox=\"0 0 1 1\" preserveAspectRatio=\"xMidYMid meet\" shape-rendering=\"geometricPrecision\"><title>large x</title><defs><style>.st0{fill:#fff;}</style></defs><g transform=\"scale(0.015625)\"><g id=\"Layer_1\"><g><rect class=\"st0\" x=\"22.9\" y=\"-4.1\" width=\"18.3\" height=\"72.2\" transform=\"translate(32 -13.3) rotate(45)\"/><rect class=\"st0\" x=\"-4.1\" y=\"22.9\" width=\"72.2\" height=\"18.3\" transform=\"translate(32 -13.3) rotate(45)\"/></g></g></g></svg>"
  }
] as const;

const svgToDataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

export const createBuiltinSelectedSvgGlyphRecords = (
  batchId: string | number = Date.now()
): ImageGlyphRecord[] =>
  builtinSelectedSvgGlyphs.map((glyph, index) => ({
    id: `built-in-image-glyph-${builtinSelectedSvgGlyphPresetId}-${batchId}-${index}`,
    name: glyph.name,
    dataUrl: svgToDataUrl(glyph.svg),
    mimeType: "image/svg+xml"
  }));
