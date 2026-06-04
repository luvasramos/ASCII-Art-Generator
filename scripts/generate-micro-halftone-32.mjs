import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "public", "image-glyph-presets", "micro-halftone-32");
const size = 64;

const glyphs = [
  {
    name: "empty",
    shapes: []
  },
  {
    name: "tiny dot",
    shapes: [{ type: "circle", cx: 32, cy: 32, r: 2 }]
  },
  {
    name: "small dot",
    shapes: [{ type: "circle", cx: 32, cy: 32, r: 4 }]
  },
  {
    name: "thin ring",
    shapes: [{ type: "circle", cx: 32, cy: 32, r: 9, fill: "none", strokeWidth: 2.2 }]
  },
  {
    name: "ring with dot",
    shapes: [
      { type: "circle", cx: 32, cy: 32, r: 10, fill: "none", strokeWidth: 2.4 },
      { type: "circle", cx: 32, cy: 32, r: 2.6 }
    ]
  },
  {
    name: "small plus",
    shapes: [
      { type: "rect", x: 29.5, y: 18, width: 5, height: 28 },
      { type: "rect", x: 18, y: 29.5, width: 28, height: 5 }
    ]
  },
  {
    name: "small x",
    shapes: [
      { type: "line", x1: 20, y1: 20, x2: 44, y2: 44, strokeWidth: 4.6 },
      { type: "line", x1: 44, y1: 20, x2: 20, y2: 44, strokeWidth: 4.6 }
    ]
  },
  {
    name: "diamond outline",
    shapes: [{ type: "polygon", points: "32,15 49,32 32,49 15,32", fill: "none", strokeWidth: 3 }]
  },
  {
    name: "square outline with dot",
    shapes: [
      { type: "rect", x: 16, y: 16, width: 32, height: 32, fill: "none", strokeWidth: 3 },
      { type: "circle", cx: 32, cy: 32, r: 4 }
    ]
  },
  {
    name: "double ring",
    shapes: [
      { type: "circle", cx: 32, cy: 32, r: 9, fill: "none", strokeWidth: 2.3 },
      { type: "circle", cx: 32, cy: 32, r: 18, fill: "none", strokeWidth: 2.3 }
    ]
  },
  {
    name: "filled diamond",
    shapes: [{ type: "polygon", points: "32,14 50,32 32,50 14,32" }]
  },
  {
    name: "early dot screen",
    shapes: offsetDotMatrix(18, 4, 4)
  },
  {
    name: "small grid",
    shapes: [...gridLines(4, 60, 14, 2)]
  },
  {
    name: "checker core",
    shapes: tileRects(2, 62, 8, 6)
  },
  {
    name: "ring grid",
    shapes: [
      ...gridLines(4, 60, 12, 1.8),
      { type: "circle", cx: 32, cy: 32, r: 16, fill: "none", strokeWidth: 2.3 }
    ]
  },
  {
    name: "diamond lattice",
    shapes: latticeLines(10, 54, 12, 2)
  },
  {
    name: "crosshatch core",
    shapes: [...diagonalHatch(10, 54, 10, 2), ...diagonalHatch(10, 54, 10, 2, true)]
  },
  {
    name: "micro checker block",
    shapes: checkerRects(8, 56, 8)
  },
  {
    name: "woven center",
    shapes: [...gridLines(8, 56, 10, 2.2), ...diagonalHatch(8, 56, 12, 1.8)]
  },
  {
    name: "dense lattice block",
    shapes: latticeLines(8, 56, 10, 2)
  },
  {
    name: "dense crosshatch block",
    shapes: [...diagonalHatch(4, 60, 8, 2.4), ...diagonalHatch(4, 60, 8, 2.4, true)]
  },
  {
    name: "full-cell dot screen",
    shapes: repeatedCircles(8, 3.8, 0, true)
  },
  {
    name: "full-cell ring screen",
    shapes: repeatedRings(8, 4.1, 1.9, 0, true)
  },
  {
    name: "full-cell checker tone",
    shapes: tileRects(0, 64, 8, 6)
  },
  {
    name: "full-cell grid tone",
    shapes: gridLines(0, 64, 8, 4)
  },
  {
    name: "full-cell diagonal hatch",
    shapes: diagonalHatch(0, 64, 7, 4.8)
  },
  {
    name: "full-cell crosshatch",
    shapes: [...diagonalHatch(0, 64, 8, 4), ...diagonalHatch(0, 64, 8, 4, true)]
  },
  {
    name: "full-cell woven tone",
    shapes: [...gridLines(0, 64, 8, 3), ...diagonalHatch(0, 64, 10, 2.6), ...diagonalHatch(0, 64, 10, 2.6, true)]
  },
  {
    name: "full-cell dense checker",
    shapes: tileRects(0, 64, 8, 7)
  },
  {
    name: "full-cell medium screen tone",
    shapes: crossBandScreen(8, 6, 2)
  },
  {
    name: "near-solid line screen",
    shapes: crossBandScreen(8, 7, 3)
  },
  {
    name: "solid full cell",
    shapes: [{ type: "rect", x: 0, y: 0, width: 64, height: 64 }]
  }
];

function repeatedCircles(step, radius, margin, seamless = false) {
  const shapes = [];
  const start = seamless ? 0 : margin + step / 2;
  const end = seamless ? 64 : 64 - margin;
  for (let y = start; y <= end; y += step) {
    for (let x = start; x <= end; x += step) {
      shapes.push({ type: "circle", cx: round(x), cy: round(y), r: radius });
    }
  }
  return shapes;
}

function repeatedRings(step, radius, strokeWidth, margin, seamless = false) {
  const shapes = [];
  const start = seamless ? 0 : margin + step / 2;
  const end = seamless ? 64 : 64 - margin;
  for (let y = start; y <= end; y += step) {
    for (let x = start; x <= end; x += step) {
      shapes.push({ type: "circle", cx: round(x), cy: round(y), r: radius, fill: "none", strokeWidth });
    }
  }
  return shapes;
}

function offsetDotMatrix(step, radius, margin) {
  const shapes = [];
  let row = 0;
  for (let y = margin + step / 2; y <= 64 - margin; y += step) {
    const offset = row % 2 === 0 ? 0 : step / 2;
    for (let x = margin + step / 2 + offset; x <= 64 - margin; x += step) {
      shapes.push({ type: "circle", cx: round(x), cy: round(y), r: radius });
    }
    row += 1;
  }
  return shapes;
}

function gridLines(min, max, step, strokeWidth) {
  const shapes = [];
  for (let pos = min; pos <= max; pos += step) {
    shapes.push({ type: "line", x1: pos, y1: min, x2: pos, y2: max, strokeWidth });
    shapes.push({ type: "line", x1: min, y1: pos, x2: max, y2: pos, strokeWidth });
  }
  return shapes;
}

function checkerRects(min, max, step) {
  const shapes = [];
  for (let y = min; y < max; y += step) {
    for (let x = min; x < max; x += step) {
      if (((x - min) / step + (y - min) / step) % 2 === 0) {
        shapes.push({ type: "rect", x, y, width: step, height: step });
      }
    }
  }
  return shapes;
}

function tileRects(min, max, step, fillSize) {
  const shapes = [];
  for (let y = min; y < max; y += step) {
    for (let x = min; x < max; x += step) {
      shapes.push({
        type: "rect",
        x,
        y,
        width: Math.min(fillSize, max - x),
        height: Math.min(fillSize, max - y)
      });
    }
  }
  return shapes;
}

function latticeLines(min, max, step, strokeWidth) {
  return [...diagonalHatch(min, max, step, strokeWidth), ...diagonalHatch(min, max, step, strokeWidth, true)];
}

function diagonalHatch(min, max, step, strokeWidth, reverse = false) {
  const shapes = [];
  for (let offset = -64; offset <= 128; offset += step) {
    if (reverse) {
      shapes.push({ type: "line", x1: offset, y1: min, x2: offset - (max - min), y2: max, strokeWidth });
    } else {
      shapes.push({ type: "line", x1: offset, y1: max, x2: offset + (max - min), y2: min, strokeWidth });
    }
  }
  return shapes;
}

function bandScreen(direction, step, thickness) {
  const shapes = [];
  for (let pos = 0; pos < 64; pos += step) {
    if (direction === "vertical") {
      shapes.push({ type: "rect", x: pos, y: 0, width: Math.min(thickness, 64 - pos), height: 64 });
    } else {
      shapes.push({ type: "rect", x: 0, y: pos, width: 64, height: Math.min(thickness, 64 - pos) });
    }
  }
  return shapes;
}

function crossBandScreen(step, horizontalThickness, verticalThickness) {
  return [
    ...bandScreen("horizontal", step, horizontalThickness),
    ...bandScreen("vertical", step, verticalThickness)
  ];
}

function shapeToSvg(shape) {
  const fill = shape.fill ?? "#FFFFFF";
  const stroke = shape.stroke ?? "#FFFFFF";
  if (shape.type === "circle") {
    return `<circle cx="${shape.cx}" cy="${shape.cy}" r="${shape.r}" fill="${fill}"${shape.fill === "none" ? ` stroke="${stroke}" stroke-width="${shape.strokeWidth}"` : ""} />`;
  }
  if (shape.type === "rect") {
    return `<rect x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}" fill="${fill}"${shape.fill === "none" ? ` stroke="${stroke}" stroke-width="${shape.strokeWidth}" stroke-linejoin="miter"` : ""} />`;
  }
  if (shape.type === "line") {
    return `<line x1="${shape.x1}" y1="${shape.y1}" x2="${shape.x2}" y2="${shape.y2}" stroke="${stroke}" stroke-width="${shape.strokeWidth}" stroke-linecap="butt" />`;
  }
  if (shape.type === "polygon") {
    return `<polygon points="${shape.points}" fill="${fill}"${shape.fill === "none" ? ` stroke="${stroke}" stroke-width="${shape.strokeWidth}" stroke-linejoin="miter"` : ""} />`;
  }
  throw new Error(`Unknown shape type ${shape.type}`);
}

function glyphSvg(glyph) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" shape-rendering="geometricPrecision">
  <title>${escapeXml(glyph.name)}</title>
  <g>${glyph.shapes.map(shapeToSvg).join("")}</g>
</svg>
`;
}

function rasterizeCoverage(shapes) {
  const samples = 4;
  let covered = 0;
  const total = size * size * samples * samples;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const px = x + (sx + 0.5) / samples;
          const py = y + (sy + 0.5) / samples;
          if (isCovered(px, py, shapes)) {
            covered += 1;
          }
        }
      }
    }
  }
  return covered / total;
}

function isCovered(x, y, shapes) {
  let covered = false;
  for (const shape of shapes) {
    const hit = hitShape(x, y, shape);
    if (!hit) continue;
    covered = true;
  }
  return covered;
}

function hitShape(x, y, shape) {
  if (shape.type === "rect") {
    if (shape.fill === "none") {
      const stroke = shape.strokeWidth / 2;
      const inOuter = x >= shape.x - stroke && x <= shape.x + shape.width + stroke && y >= shape.y - stroke && y <= shape.y + shape.height + stroke;
      const inInner = x >= shape.x + stroke && x <= shape.x + shape.width - stroke && y >= shape.y + stroke && y <= shape.y + shape.height - stroke;
      return inOuter && !inInner;
    }
    return x >= shape.x && x <= shape.x + shape.width && y >= shape.y && y <= shape.y + shape.height;
  }
  if (shape.type === "circle") {
    const distance = Math.hypot(x - shape.cx, y - shape.cy);
    if (shape.fill === "none") {
      return distance <= shape.r + shape.strokeWidth / 2 && distance >= shape.r - shape.strokeWidth / 2;
    }
    return distance <= shape.r;
  }
  if (shape.type === "line") {
    const lengthSq = (shape.x2 - shape.x1) ** 2 + (shape.y2 - shape.y1) ** 2;
    const t = lengthSq ? Math.max(0, Math.min(1, ((x - shape.x1) * (shape.x2 - shape.x1) + (y - shape.y1) * (shape.y2 - shape.y1)) / lengthSq)) : 0;
    const qx = shape.x1 + (shape.x2 - shape.x1) * t;
    const qy = shape.y1 + (shape.y2 - shape.y1) * t;
    return Math.hypot(x - qx, y - qy) <= shape.strokeWidth / 2;
  }
  if (shape.type === "polygon") {
    const points = shape.points.split(" ").map((point) => point.split(",").map(Number));
    if (shape.fill === "none") {
      return points.some((point, index) => {
        const next = points[(index + 1) % points.length];
        return hitShape(x, y, { type: "line", x1: point[0], y1: point[1], x2: next[0], y2: next[1], strokeWidth: shape.strokeWidth });
      });
    }
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
      const [xi, yi] = points[i];
      const [xj, yj] = points[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }
  return false;
}

function makePreviewSheet(items) {
  const columns = 8;
  const cardWidth = 92;
  const cardHeight = 96;
  const width = columns * cardWidth;
  const height = Math.ceil(items.length / columns) * cardHeight;
  const cards = items.map((glyph, index) => {
    const x = (index % columns) * cardWidth;
    const y = Math.floor(index / columns) * cardHeight;
    return `<g transform="translate(${x},${y})">
  <rect x="8" y="8" width="76" height="86" rx="10" fill="#131316" stroke="#FFFFFF" stroke-opacity="0.08" />
  <g transform="translate(14,11)">${glyph.inline}</g>
  <text class="label" x="46" y="80">${String(index).padStart(2, "0")}</text>
  <text x="46" y="92">${(glyph.coverage * 100).toFixed(1)}%</text>
</g>`;
  }).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#0B0B0C" />
  <style>text{font-family:Inter,Arial,sans-serif;font-size:9px;fill:#9CA3AF;text-anchor:middle}.label{fill:#F3F4F6;font-weight:600;font-size:10px}</style>
  ${cards}
</svg>
`;
}

function makeTilingPreview(items) {
  const brightest = items.slice(-12);
  const columns = 4;
  const cardWidth = 192;
  const cardHeight = 188;
  const width = columns * cardWidth;
  const height = Math.ceil(brightest.length / columns) * cardHeight;
  const cards = brightest.map((glyph, index) => {
    const x = (index % columns) * cardWidth;
    const y = Math.floor(index / columns) * cardHeight;
    const tiles = [];
    for (let ty = 0; ty < 3; ty += 1) {
      for (let tx = 0; tx < 3; tx += 1) {
        tiles.push(`<g transform="translate(${20 + tx * 48},${16 + ty * 48}) scale(0.75)">${glyph.inlineShapes}</g>`);
      }
    }
    return `<g transform="translate(${x},${y})">
  <rect x="8" y="8" width="176" height="180" rx="10" fill="#050608" stroke="#FFFFFF" stroke-opacity="0.08" />
  ${tiles.join("\n  ")}
  <text class="label" x="96" y="170">${glyph.fileName} - ${(glyph.coverage * 100).toFixed(1)}%</text>
</g>`;
  }).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#0B0B0C" />
  <style>text{font-family:Inter,Arial,sans-serif;font-size:10px;fill:#D4D4D8;text-anchor:middle}.label{font-weight:600}</style>
  ${cards}
</svg>
`;
}

function makeReferenceBehaviorPreview(items) {
  const requested = [12, 16, 20, 24, 28, 31];
  const tileSize = 36;
  const columns = 3;
  const cardWidth = 260;
  const cardHeight = 238;
  const width = columns * cardWidth;
  const height = Math.ceil(requested.length / columns) * cardHeight;
  const cards = requested
    .map((glyphIndex, cardIndex) => {
      const glyph = items[glyphIndex];
      const x = (cardIndex % columns) * cardWidth;
      const y = Math.floor(cardIndex / columns) * cardHeight;
      const tiles = [];
      for (let ty = 0; ty < 5; ty += 1) {
        for (let tx = 0; tx < 6; tx += 1) {
          tiles.push(`<g transform="translate(${16 + tx * tileSize},${18 + ty * tileSize}) scale(${tileSize / 64})">${glyph.inlineShapes}</g>`);
        }
      }
      return `<g transform="translate(${x},${y})">
  <rect x="8" y="8" width="244" height="230" rx="12" fill="#050608" stroke="#FFFFFF" stroke-opacity="0.08" />
  ${tiles.join("\n  ")}
  <text class="label" x="130" y="210">glyph_${String(glyphIndex).padStart(2, "0")} - ${(glyph.coverage * 100).toFixed(1)}%</text>
</g>`;
    })
    .join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#0B0B0C" />
  <style>text{font-family:Inter,Arial,sans-serif;font-size:11px;fill:#D4D4D8;text-anchor:middle}.label{font-weight:600}</style>
  ${cards}
</svg>
`;
}

function round(value) {
  return Number(value.toFixed(3));
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const measured = glyphs.map((glyph, originalIndex) => ({
  ...glyph,
  originalIndex,
  coverage: rasterizeCoverage(glyph.shapes)
}));

const sorted = measured
  .sort((a, b) => a.coverage - b.coverage || a.originalIndex - b.originalIndex)
  .map((glyph, index) => ({
    ...glyph,
    fileName: `glyph_${String(index).padStart(2, "0")}.svg`,
    inlineShapes: `<g>${glyph.shapes.map(shapeToSvg).join("")}</g>`,
    inline: `<svg width="64" height="64" viewBox="0 0 64 64" shape-rendering="geometricPrecision"><g>${glyph.shapes.map(shapeToSvg).join("")}</g></svg>`
  }));

for (const glyph of sorted) {
  await writeFile(path.join(outDir, glyph.fileName), glyphSvg(glyph), "utf8");
}

await writeFile(
  path.join(outDir, "preset.json"),
  `${JSON.stringify(
    {
      name: "Micro Halftone 32",
      type: "image-glyphs",
      glyphCount: 32,
      glyphSize: 64,
      glyphs: sorted.map((glyph) => glyph.fileName)
    },
    null,
    2
  )}\n`,
  "utf8"
);

await writeFile(
  path.join(outDir, "coverage.json"),
  `${JSON.stringify(
    sorted.map((glyph, index) => ({
      index,
      file: glyph.fileName,
      source: glyph.name,
      coverage: Number((glyph.coverage * 100).toFixed(3))
    })),
    null,
    2
  )}\n`,
  "utf8"
);

const contactSheet = makePreviewSheet(sorted);
await writeFile(path.join(outDir, "preview_sheet.svg"), contactSheet, "utf8");
await writeFile(path.join(outDir, "contact_sheet.svg"), contactSheet, "utf8");
await writeFile(path.join(outDir, "tiling_preview.svg"), makeTilingPreview(sorted), "utf8");
await writeFile(path.join(outDir, "reference_behavior_preview.svg"), makeReferenceBehaviorPreview(sorted), "utf8");

console.log(
  JSON.stringify(
    {
      outDir,
      glyphs: sorted.length,
      monotonic: sorted.every((glyph, index, list) => index === 0 || glyph.coverage >= list[index - 1].coverage),
      firstCoverage: sorted[0].coverage,
      group21Coverage: sorted[21].coverage,
      group29Coverage: sorted[29].coverage,
      finalCoverage: sorted[31].coverage
    },
    null,
    2
  )
);
