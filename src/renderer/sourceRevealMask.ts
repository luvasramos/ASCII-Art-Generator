import type { CellRenderData, MaskSettings, RenderGrid } from "./types";

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const mix = (a: number, b: number, amount: number) => a + (b - a) * amount;
const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = clamp01((value - edge0) / Math.max(0.0001, edge1 - edge0));
  return t * t * (3 - 2 * t);
};

const hash01 = (x: number, y: number, seed: number) => {
  const value = Math.sin((x + seed * 0.013) * 127.1 + (y - seed * 0.017) * 311.7 + seed * 74.7) * 43758.5453123;
  return value - Math.floor(value);
};

const valueNoise = (x: number, y: number, seed: number) => {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const a = hash01(x0, y0, seed);
  const b = hash01(x0 + 1, y0, seed);
  const c = hash01(x0, y0 + 1, seed);
  const d = hash01(x0 + 1, y0 + 1, seed);
  return mix(mix(a, b, sx), mix(c, d, sx), sy);
};

const fractalNoise = (x: number, y: number, seed: number) => {
  let value = 0;
  let amplitude = 0.56;
  let frequency = 1;
  let amplitudeSum = 0;

  for (let octave = 0; octave < 4; octave += 1) {
    value += valueNoise(x * frequency, y * frequency, seed + octave * 101) * amplitude;
    amplitudeSum += amplitude;
    frequency *= 2;
    amplitude *= 0.52;
  }

  return clamp01(value / Math.max(0.0001, amplitudeSum));
};

export const isSourceRevealMaskActive = (settings?: Pick<MaskSettings, "enabled" | "mix"> | null) =>
  Boolean(settings?.enabled && Number.isFinite(settings.mix) && settings.mix > 0);

export interface SourceRevealMaskResolver {
  active: boolean;
  values: Float32Array | null;
  resolve: (cell: CellRenderData, index?: number) => number;
}

const inactiveSourceRevealMaskResolver: SourceRevealMaskResolver = {
  active: false,
  values: null,
  resolve: () => 0
};

const maskIndexForCell = (cell: CellRenderData, columns: number, rows: number) => {
  const x = Math.round(cell.x);
  const y = Math.round(cell.y);
  if (x < 0 || y < 0 || x >= columns || y >= rows) {
    return -1;
  }
  return y * columns + x;
};

const blurCellMask = (values: Float32Array, columns: number, rows: number, radius: number) => {
  if (radius <= 0) {
    return values;
  }

  const horizontal = new Float32Array(values.length);
  const output = new Float32Array(values.length);

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      let sum = 0;
      let count = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sampleX = x + offset;
        if (sampleX < 0 || sampleX >= columns) {
          continue;
        }
        sum += values[y * columns + sampleX] ?? 0;
        count += 1;
      }
      horizontal[y * columns + x] = count > 0 ? sum / count : 0;
    }
  }

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      let sum = 0;
      let count = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sampleY = y + offset;
        if (sampleY < 0 || sampleY >= rows) {
          continue;
        }
        sum += horizontal[sampleY * columns + x] ?? 0;
        count += 1;
      }
      output[y * columns + x] = count > 0 ? sum / count : 0;
    }
  }

  return output;
};

export const buildSourceRevealMaskGrid = (grid: RenderGrid, settings: MaskSettings): Float32Array => {
  const columns = Math.max(1, grid.columns);
  const rows = Math.max(1, grid.rows);
  const values = new Float32Array(grid.cells.length);
  if (!isSourceRevealMaskActive(settings)) {
    return values;
  }

  const cellCount = Math.min(grid.cells.length, columns * rows);
  const cloudAmount = clamp01((settings.cloudSize - 1) / 99);
  const frequency = mix(0.5, 16, cloudAmount);
  const aspect = columns / rows;
  const xScale = (frequency * Math.max(1, aspect)) / columns;
  const yScale = (frequency * Math.max(1, 1 / aspect)) / rows;
  // mask.contrast is kept in persisted state for old presets, but the visible UI now
  // treats Softness as the edge-shaping control and uses this fixed internal punch.
  const contrastGain = 3.2;
  const softness = clamp01(settings.softness / 100);
  const thresholdEdge = mix(0.018, 0.08, Math.pow(softness, 1.4));
  const lowerEdge = 0.5 - thresholdEdge;
  const upperEdge = 0.5 + thresholdEdge;
  const strength = clamp01(settings.mix / 100);
  const seed = settings.seed;
  const invert = settings.invert;

  for (let index = 0; index < cellCount; index += 1) {
    const cell = grid.cells[index];
    if (!cell || cell.alpha <= 0.01) {
      values[index] = 0;
      continue;
    }
    const x = (cell.x + 0.5) * xScale;
    const y = (cell.y + 0.5) * yScale;
    const base = fractalNoise(x, y, seed);
    const contrasted = clamp01((base - 0.5) * contrastGain + 0.5);
    const thresholded = smoothstep(lowerEdge, upperEdge, contrasted);
    values[index] = invert ? 1 - thresholded : thresholded;
  }

  const maxGridRadius = Math.max(0, Math.min(5, Math.floor(Math.min(columns, rows) / 3)));
  const blurRadius = Math.min(maxGridRadius, Math.round(Math.pow(softness, 1.18) * 5));
  const softened = blurCellMask(values, columns, rows, blurRadius);

  for (let index = 0; index < cellCount; index += 1) {
    const cell = grid.cells[index];
    softened[index] = cell && cell.alpha > 0.01 ? clamp01(softened[index] * strength) : 0;
  }

  return softened;
};

export const createSourceRevealMaskResolver = (
  grid: RenderGrid,
  settings?: MaskSettings | null
): SourceRevealMaskResolver => {
  if (!settings || !isSourceRevealMaskActive(settings)) {
    return inactiveSourceRevealMaskResolver;
  }
  const columns = Math.max(1, grid.columns);
  const rows = Math.max(1, grid.rows);
  const values = buildSourceRevealMaskGrid(grid, settings);

  return {
    active: true,
    values,
    resolve: (cell, index) => {
      const resolvedIndex =
        typeof index === "number" && index >= 0 && index < values.length
          ? index
          : maskIndexForCell(cell, columns, rows);
      if (resolvedIndex < 0 || resolvedIndex >= values.length) {
        return 0;
      }
      return values[resolvedIndex] ?? 0;
    }
  };
};

export const resolveSourceRevealMask = (
  cell: CellRenderData,
  grid: RenderGrid,
  settings: MaskSettings
) => {
  return createSourceRevealMaskResolver(grid, settings).resolve(cell);
};
