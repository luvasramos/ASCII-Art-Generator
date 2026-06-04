import type {
  CellRenderData,
  GlyphMetric,
  ParticleDirectionBias,
  WorkerRenderOptions
} from "../renderer/types";

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const particleCharacters = new Set(Array.from(".,':;-_*+?/\\|"));
const neighborOffsets = [
  { x: -1, y: 0, weight: 1 },
  { x: 1, y: 0, weight: 1 },
  { x: 0, y: -1, weight: 1 },
  { x: 0, y: 1, weight: 1 },
  { x: -1, y: -1, weight: 0.72 },
  { x: 1, y: -1, weight: 0.72 },
  { x: -1, y: 1, weight: 0.72 },
  { x: 1, y: 1, weight: 0.72 }
];

interface EdgeCandidate {
  cell: CellRenderData;
  outwardX: number;
  outwardY: number;
  edgeStrength: number;
}

const randomAt = (seed: number, x: number, y: number, salt: number) => {
  let value = seed ^ Math.imul(x + 1, 0x45d9f3b) ^ Math.imul(y + 1, 0x119de1f3) ^ Math.imul(salt + 1, 0x27d4eb2d);
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 4294967296;
};

const getCell = (cells: CellRenderData[], columns: number, rows: number, x: number, y: number) => {
  if (x < 0 || y < 0 || x >= columns || y >= rows) {
    return null;
  }
  return cells[y * columns + x];
};

const buildParticleGlyphPool = (glyphMetrics: GlyphMetric[]) => {
  const preferred = glyphMetrics.filter((metric) => particleCharacters.has(metric.glyph));
  const fallbackCount = Math.max(3, Math.ceil(glyphMetrics.length * 0.35));
  const source = preferred.length ? preferred : glyphMetrics.slice(0, fallbackCount);
  return [...source].sort((a, b) => a.density - b.density);
};

const biasVector = (
  direction: ParticleDirectionBias,
  x: number,
  y: number,
  columns: number,
  rows: number
) => {
  if (direction === "up") return { x: 0, y: -1 };
  if (direction === "down") return { x: 0, y: 1 };
  if (direction === "left") return { x: -1, y: 0 };
  if (direction === "right") return { x: 1, y: 0 };
  if (direction === "radial") {
    const dx = x - (columns - 1) / 2;
    const dy = y - (rows - 1) / 2;
    const length = Math.hypot(dx, dy) || 1;
    return { x: dx / length, y: dy / length };
  }
  return { x: 0, y: 0 };
};

const normalized = (x: number, y: number) => {
  const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
};

const breakupField = (seed: number, x: number, y: number) => {
  const macro = randomAt(seed, Math.floor(x / 4), Math.floor(y / 4), 90);
  const meso = randomAt(seed, Math.floor(x / 2), Math.floor(y / 2), 91);
  const micro = randomAt(seed, x, y, 92);
  return clamp01(macro * 0.52 + meso * 0.28 + micro * 0.2);
};

const fragmentOffsets = (radius: number) => {
  const offsets: Array<{ x: number; y: number }> = [];
  for (let y = -radius; y <= radius; y += 1) {
    for (let x = -radius; x <= radius; x += 1) {
      if (Math.abs(x) + Math.abs(y) <= radius + 0.5) {
        offsets.push({ x, y });
      }
    }
  }
  return offsets;
};

const resolveDirection = (
  candidate: EdgeCandidate,
  directionBias: ParticleDirectionBias,
  seed: number,
  salt: number,
  columns: number,
  rows: number
) => {
  const base = normalized(candidate.outwardX, candidate.outwardY);
  if (directionBias === "random") {
    const angle = Math.atan2(base.y, base.x) + (randomAt(seed, candidate.cell.x, candidate.cell.y, salt) - 0.5) * Math.PI * 1.4;
    return { x: Math.cos(angle), y: Math.sin(angle) };
  }
  const bias = biasVector(directionBias, candidate.cell.x, candidate.cell.y, columns, rows);
  return normalized(base.x + bias.x * 0.92, base.y + bias.y * 0.92);
};

const erodeCell = (cell: CellRenderData, amount: number, field: number, depthStrength: number, seed: number, salt: number) => {
  const attenuation = clamp01(amount * depthStrength * (0.28 + field * 0.72));
  cell.foregroundAlpha *= 1 - attenuation;
  cell.backgroundAlpha *= 1 - attenuation * 0.72;
  if (randomAt(seed, cell.x, cell.y, salt) < attenuation * 0.42) {
    cell.glyph = " ";
  }
};

const selectDustGlyph = (glyphPool: GlyphMetric[], distanceRatio: number) => {
  const index = Math.round((1 - distanceRatio) * (glyphPool.length - 1));
  return glyphPool[Math.max(0, Math.min(glyphPool.length - 1, index))].glyph;
};

export const applyEdgeBreakup = (cells: CellRenderData[], options: WorkerRenderOptions) => {
  const strength = options.breakup.amount / 100;
  if (strength <= 0 || !cells.length) {
    return cells;
  }

  const { columns, rows } = options;
  const glyphPool = buildParticleGlyphPool(options.glyphMetrics);
  if (!glyphPool.length) {
    return cells;
  }

  const particleAmount = options.breakup.density / 100;
  const clusterAmount = options.breakup.clusterAmount / 100;
  const erosionAmount = options.breakup.erosionAmount / 100;
  const chunkRadius = Math.max(0, Math.round((options.breakup.chunkSize - 1) / 2));
  const spreadCells = Math.max(
    1,
    Math.round((options.breakup.spread / 100) * Math.max(6, Math.min(columns, rows) * 0.24))
  );
  const chaos = options.breakup.randomness / 100;
  const fade = options.breakup.fadeStrength / 100;
  const seed = Math.trunc(options.breakup.seed) || 1;
  const edgeCandidates: EdgeCandidate[] = [];

  // A cell is treated as a silhouette edge when subject coverage drops sharply toward a neighbor.
  for (const cell of cells) {
    if (cell.coverage < 0.08 || cell.alpha <= 0.01 || cell.foregroundAlpha <= 0) {
      continue;
    }

    let outwardX = 0;
    let outwardY = 0;
    let strongestGap = 0;
    for (const offset of neighborOffsets) {
      const neighbor = getCell(cells, columns, rows, cell.x + offset.x, cell.y + offset.y);
      const neighborCoverage = neighbor?.coverage ?? 0;
      const gap = Math.max(0, cell.coverage - neighborCoverage) * offset.weight;
      strongestGap = Math.max(strongestGap, gap);
      outwardX += offset.x * gap;
      outwardY += offset.y * gap;
    }

    if (strongestGap < 0.04) {
      continue;
    }

    const edgeStrength = clamp01(strongestGap * 1.5 + cell.edgeMagnitude * 0.35);
    if (edgeStrength < 0.08) {
      continue;
    }

    if (Math.hypot(outwardX, outwardY) < 0.001) {
      const radial = biasVector("radial", cell.x, cell.y, columns, rows);
      outwardX = radial.x;
      outwardY = radial.y;
    }

    edgeCandidates.push({ cell, outwardX, outwardY, edgeStrength });
  }

  const maxBandDepth = Math.max(1, Math.round(1 + erosionAmount * 3));
  const edgeDistance = new Int16Array(cells.length);
  edgeDistance.fill(-1);
  const frontier: number[] = [];

  for (const candidate of edgeCandidates) {
    const index = candidate.cell.y * columns + candidate.cell.x;
    if (edgeDistance[index] === -1) {
      edgeDistance[index] = 0;
      frontier.push(index);
    }
  }

  // Erode a narrow inward band from the silhouette edge so breakup reads as missing image material.
  for (let cursor = 0; cursor < frontier.length; cursor += 1) {
    const index = frontier[cursor];
    const distance = edgeDistance[index];
    if (distance >= maxBandDepth) {
      continue;
    }
    const cell = cells[index];

    for (const offset of neighborOffsets) {
      const neighbor = getCell(cells, columns, rows, cell.x + offset.x, cell.y + offset.y);
      if (!neighbor || neighbor.coverage < 0.08 || neighbor.alpha <= 0.01 || neighbor.foregroundAlpha <= 0) {
        continue;
      }

      const neighborIndex = neighbor.y * columns + neighbor.x;
      if (edgeDistance[neighborIndex] !== -1) {
        continue;
      }

      edgeDistance[neighborIndex] = distance + 1;
      frontier.push(neighborIndex);
    }
  }

  for (const cell of cells) {
    const index = cell.y * columns + cell.x;
    const distance = edgeDistance[index];
    if (distance < 0) {
      continue;
    }

    const bandStrength = clamp01(1 - distance / Math.max(1, maxBandDepth + 0.5));
    const field = breakupField(seed, cell.x, cell.y);
    const localStrength = strength * bandStrength * (0.22 + field * 0.92) * (0.35 + erosionAmount * 0.95);
    if (randomAt(seed, cell.x, cell.y, 4) < localStrength * (0.18 + field * 0.82)) {
      erodeCell(cell, localStrength, field, bandStrength, seed, 5);
      if (cell.glyph !== " " && randomAt(seed, cell.x, cell.y, 6) < localStrength * 0.4) {
        cell.glyph = glyphPool[Math.floor(randomAt(seed, cell.x, cell.y, 7) * glyphPool.length)].glyph;
      }
    }
  }

  for (const candidate of edgeCandidates) {
    const { cell, edgeStrength } = candidate;
    const field = breakupField(seed, cell.x, cell.y);
    const direction = resolveDirection(
      candidate,
      options.breakup.directionBias,
      seed,
      12,
      columns,
      rows
    );

    const expectedClusters = strength * clusterAmount * (0.08 + edgeStrength * 1.18) * (0.35 + field * 1.15);
    let clusterCount = Math.floor(expectedClusters);
    if (randomAt(seed, cell.x, cell.y, 8) < expectedClusters - clusterCount) {
      clusterCount += 1;
    }

    for (let clusterIndex = 0; clusterIndex < clusterCount; clusterIndex += 1) {
      // Detached fragments copy nearby source cells so larger particles keep a memory of the original image.
      const distanceRatio = clamp01(0.06 + Math.pow(randomAt(seed, cell.x, cell.y, 20 + clusterIndex), 1.4) * 0.58);
      const distance = 1 + Math.max(0, spreadCells - 1) * distanceRatio;
      const jitter = (randomAt(seed, cell.x, cell.y, 30 + clusterIndex) - 0.5) * Math.PI * chaos * 0.72;
      const clusterAngle = Math.atan2(direction.y, direction.x) + jitter;
      const clusterDirection = { x: Math.cos(clusterAngle), y: Math.sin(clusterAngle) };
      const driftX = Math.round(clusterDirection.x * distance);
      const driftY = Math.round(clusterDirection.y * distance);
      const maxRadius = Math.max(0, chunkRadius);
      const radius = Math.min(
        maxRadius,
        Math.round(maxRadius * (0.45 + randomAt(seed, cell.x, cell.y, 40 + clusterIndex) * 0.55))
      );
      const offsets = fragmentOffsets(radius);
      const particleFade = clamp01(1 - fade * distanceRatio);

      for (const offset of offsets) {
        const source = getCell(cells, columns, rows, cell.x + offset.x, cell.y + offset.y);
        const target = getCell(cells, columns, rows, cell.x + driftX + offset.x, cell.y + driftY + offset.y);
        if (
          !source ||
          source.coverage < 0.08 ||
          source.alpha <= 0.01 ||
          source.foregroundAlpha <= 0 ||
          !target ||
          target.coverage > 0.12 ||
          target.isParticle
        ) {
          continue;
        }

        const sourceDistance = Math.abs(offset.x) + Math.abs(offset.y);
        const chunkWeight = clamp01(1 - sourceDistance / Math.max(1, radius + 1));
        const useSourceGlyph = distanceRatio < 0.48 || randomAt(seed, source.x, source.y, 50 + clusterIndex) < 0.72;
        target.glyph =
          useSourceGlyph && source.glyph !== " "
            ? source.glyph
            : selectDustGlyph(glyphPool, clamp01(distanceRatio + sourceDistance * 0.12));
        target.foreground = clamp01(source.foreground * (0.54 + particleFade * 0.62));
        target.background = clamp01(source.background * (0.22 + particleFade * 0.56));
        target.foregroundAlpha = Math.max(
          0.12,
          particleFade * (0.42 + edgeStrength * 0.54) * (0.6 + chunkWeight * 0.4)
        );
        target.backgroundAlpha = Math.max(0.04, particleFade * chunkWeight * (0.14 + edgeStrength * 0.42));
        target.isParticle = true;

        if (randomAt(seed, source.x, source.y, 60 + clusterIndex) < strength * (0.22 + erosionAmount * 0.64)) {
          erodeCell(source, strength * (0.42 + erosionAmount * 0.58), field, 1, seed, 70 + clusterIndex);
        }
      }
    }

    const expectedDust = strength * particleAmount * (0.3 + edgeStrength * 2.45) * (0.35 + field * 1.2);
    let dustCount = Math.floor(expectedDust);
    if (randomAt(seed, cell.x, cell.y, 80) < expectedDust - dustCount) {
      dustCount += 1;
    }

    for (let index = 0; index < dustCount; index += 1) {
      // Dust particles remain lighter and dimmer as they travel farther from the broken contour.
      const dustDirection = resolveDirection(
        candidate,
        options.breakup.directionBias,
        seed,
        90 + index,
        columns,
        rows
      );
      const angle =
        Math.atan2(dustDirection.y, dustDirection.x) +
        (randomAt(seed, cell.x, cell.y, 100 + index) - 0.5) * Math.PI * chaos;
      const distanceRatio = clamp01(0.12 + Math.pow(randomAt(seed, cell.x, cell.y, 120 + index), 1.3) * 0.88);
      const distance = 1 + Math.max(0, spreadCells - 1) * distanceRatio;
      const lateral = (randomAt(seed, cell.x, cell.y, 140 + index) - 0.5) * chaos * spreadCells * 0.62;
      const targetX = Math.round(cell.x + Math.cos(angle) * distance - Math.sin(angle) * lateral);
      const targetY = Math.round(cell.y + Math.sin(angle) * distance + Math.cos(angle) * lateral);
      const target = getCell(cells, columns, rows, targetX, targetY);

      if (!target || target.coverage > 0.12 || target.isParticle) {
        continue;
      }

      const particleFade = clamp01(1 - fade * distanceRatio);
      target.glyph = selectDustGlyph(glyphPool, distanceRatio);
      target.foreground = clamp01(cell.foreground * (0.36 + particleFade * 0.66));
      target.background = 0;
      target.foregroundAlpha = Math.max(0.06, particleFade * (0.28 + edgeStrength * 0.58) * (0.58 + field * 0.42));
      target.backgroundAlpha = 0;
      target.isParticle = true;
    }
  }

  return cells;
};
