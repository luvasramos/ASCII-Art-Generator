import { invertCssColor, resolveDisplayCellColor } from "../quantization/color";
import { getImageGlyphIndexForBrightness } from "../atlas/imageGlyphAtlas";
import { resolveCellFittedFontSize } from "../atlas/glyphAtlas";
import { normalizeCharacterSet } from "../ascii/charset";
import { createImageGlyphBrightnessMapper } from "../renderer/imageGlyphDistribution";
import type { AsciiSettings, ColorSettings, ExportOptions, FontSettings, RenderGrid } from "../renderer/types";
import { downloadBlob } from "./download";
import { scaleFontForRenderResolution } from "../renderer/geometry";

interface ExportSvgArgs {
  grid: RenderGrid;
  font: FontSettings;
  ascii: AsciiSettings;
  color: ColorSettings;
  exportOptions: ExportOptions;
  fileName: string;
}

const quantizeBrightness = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 255) / 255;

const escapeText = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const escapeAttribute = (value: string) =>
  escapeText(value)
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const formatNumber = (value: number) => {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return value.toFixed(3).replace(/\.?0+$/, "");
};

export const exportSvg = ({ grid, font, ascii, color, exportOptions, fileName }: ExportSvgArgs) => {
  const width = Math.max(1, Math.ceil(grid.width));
  const height = Math.max(1, Math.ceil(grid.height));
  const cellWidth = grid.cellWidth;
  const cellHeight = grid.cellHeight;
  const stepX = cellWidth + grid.gapX;
  const stepY = cellHeight + grid.gapY;
  const backgroundCellWidth = grid.gapX > 0 ? cellWidth : cellWidth + 0.5;
  const backgroundCellHeight = grid.gapY > 0 ? cellHeight : cellHeight + 0.5;
  const renderFont = scaleFontForRenderResolution(font, ascii.renderResolution);
  const fontSize = resolveCellFittedFontSize(
    normalizeCharacterSet(ascii.charset),
    renderFont,
    cellWidth,
    cellHeight,
    ascii.characterScale,
    1
  );
  const alphaThreshold = exportOptions.alphaThreshold / 100;
  const duotoneMode = color.paletteMode === "single";
  const imageGlyphs = ascii.glyphMode === "images" && ascii.imageGlyphs.length >= 2 ? ascii.imageGlyphs : [];
  const imageGlyphMapper = imageGlyphs.length
    ? createImageGlyphBrightnessMapper(grid.cells, imageGlyphs.length, ascii.glyphOpacity)
    : null;
  const imageGlyphForBrightness = (brightness: number) => {
    if (!imageGlyphs.length) {
      return null;
    }
    const index = getImageGlyphIndexForBrightness(brightness, imageGlyphs.length);
    imageGlyphMapper?.record(index);
    return imageGlyphs[Math.min(imageGlyphs.length - 1, Math.max(0, index))] ?? null;
  };
  const imageTintFilters = new Map<string, string>();
  const imageTintFilterDefs: string[] = [];
  const rootBackground = duotoneMode
    ? resolveDisplayCellColor(0, color, "background")
    : color.invert
      ? invertCssColor(exportOptions.backgroundColor)
      : exportOptions.backgroundColor;
  const getImageTintFilterId = (fill: string) => {
    const key = `${fill.replace(/\s+/g, "")}:${duotoneMode ? "binary" : "soft"}`;
    const existing = imageTintFilters.get(key);
    if (existing) {
      return existing;
    }
    const id = `image-glyph-tint-${imageTintFilters.size}`;
    imageTintFilters.set(key, id);
    imageTintFilterDefs.push(
      duotoneMode
        ? `<filter id="${id}" color-interpolation-filters="sRGB"><feComponentTransfer in="SourceAlpha" result="mask"><feFuncA type="discrete" tableValues="0 1" /></feComponentTransfer><feFlood flood-color="${escapeAttribute(
            fill
          )}" result="tint" /><feComposite in="tint" in2="mask" operator="in" /></filter>`
        : `<filter id="${id}" color-interpolation-filters="sRGB"><feFlood flood-color="${escapeAttribute(
            fill
          )}" result="tint" /><feComposite in="tint" in2="SourceAlpha" operator="in" /></filter>`
    );
    return id;
  };

  const rects = grid.cells
    .filter((cell) => !exportOptions.transparentBackground || cell.isParticle || cell.coverage >= alphaThreshold)
    .filter((cell) => cell.backgroundAlpha > 0)
    .map((cell) => {
      const fill = resolveDisplayCellColor(quantizeBrightness(cell.background), color, "background");
      const opacity = !duotoneMode && cell.backgroundAlpha < 1 ? ` opacity="${formatNumber(cell.backgroundAlpha)}"` : "";
      return `<rect x="${formatNumber(cell.x * stepX)}" y="${formatNumber(cell.y * stepY)}" width="${formatNumber(
        backgroundCellWidth
      )}" height="${formatNumber(backgroundCellHeight)}" fill="${fill}"${opacity} />`;
    })
    .join("");

  const glyphLayer = grid.cells
    .filter((cell) => (imageGlyphs.length ? true : cell.glyph && cell.glyph !== " ") && cell.foregroundAlpha > 0)
    .filter((cell) => !exportOptions.transparentBackground || cell.isParticle || cell.coverage >= alphaThreshold)
    .map((cell) => {
      if (imageGlyphs.length) {
        const imageGlyph = imageGlyphForBrightness(imageGlyphMapper ? imageGlyphMapper.map(cell) : quantizeBrightness(cell.foreground));
        if (!imageGlyph) {
          return "";
        }
        const fill = resolveDisplayCellColor(quantizeBrightness(cell.foreground), color, "foreground");
        const filterId = getImageTintFilterId(fill);
        const drawWidth = cellWidth * ascii.characterScale;
        const drawHeight = cellHeight * ascii.characterScale;
        const opacity = !duotoneMode && cell.foregroundAlpha < 1 ? ` opacity="${formatNumber(cell.foregroundAlpha)}"` : "";
        return `<image href="${escapeAttribute(imageGlyph.dataUrl)}" x="${formatNumber(
          cell.x * stepX + (cellWidth - drawWidth) / 2
        )}" y="${formatNumber(cell.y * stepY + (cellHeight - drawHeight) / 2)}" width="${formatNumber(
          drawWidth
        )}" height="${formatNumber(drawHeight)}" preserveAspectRatio="xMidYMid slice" filter="url(#${filterId})"${opacity} />`;
      }
      const fill = resolveDisplayCellColor(quantizeBrightness(cell.foreground), color, "foreground");
      const opacity = !duotoneMode && cell.foregroundAlpha < 1 ? ` opacity="${formatNumber(cell.foregroundAlpha)}"` : "";
      return `<text x="${formatNumber(cell.x * stepX + cellWidth / 2)}" y="${formatNumber(
        cell.y * stepY + cellHeight / 2
      )}" fill="${fill}"${opacity}>${escapeText(cell.glyph)}</text>`;
    })
    .join("");
  imageGlyphMapper?.flushDebug("svg");

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">
  <title>ASCII Rendering Studio export</title>
  <desc>Custom uploaded fonts are referenced by font-family name; font files are not embedded in this SVG.</desc>
  ${imageTintFilterDefs.length ? `<defs>${imageTintFilterDefs.join("")}</defs>` : ""}
  ${exportOptions.transparentBackground ? "" : `<rect width="${width}" height="${height}" fill="${escapeAttribute(rootBackground)}" />`}
  <g>${rects}</g>
  <g font-family="${escapeAttribute(
    font.family
  )}, monospace" font-size="${formatNumber(fontSize)}" font-weight="${renderFont.weight}" letter-spacing="${formatNumber(
    renderFont.letterSpacing
  )}" text-anchor="middle" dominant-baseline="central"${duotoneMode ? ' text-rendering="optimizeSpeed" shape-rendering="crispEdges"' : ""}>${glyphLayer}</g>
</svg>`;

  downloadBlob(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), fileName);
};
