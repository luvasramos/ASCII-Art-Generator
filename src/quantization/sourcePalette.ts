export const minSourcePaletteSize = 4;
export const maxSourcePaletteSize = 16;

interface WeightedColor {
  r: number;
  g: number;
  b: number;
  count: number;
}

interface ColorBox {
  colors: WeightedColor[];
  count: number;
  rMin: number;
  rMax: number;
  gMin: number;
  gMax: number;
  bMin: number;
  bMax: number;
}

const fallbackPalette = [
  "#050608",
  "#151827",
  "#243050",
  "#355A7D",
  "#4D8061",
  "#8C8A45",
  "#B45B52",
  "#9F39FF",
  "#D991FF",
  "#F3F0E7",
  "#6DD6FF",
  "#FFD166",
  "#EF476F",
  "#06D6A0",
  "#7C83FD",
  "#FFFFFF"
];

const clampByte = (value: number) => Math.min(255, Math.max(0, Math.round(value)));

export const normalizeSourcePaletteSize = (value: number) =>
  Math.round(Math.min(maxSourcePaletteSize, Math.max(minSourcePaletteSize, Number.isFinite(value) ? value : 8)));

const rgbToHex = ({ r, g, b }: WeightedColor) =>
  `#${[r, g, b].map((channel) => clampByte(channel).toString(16).padStart(2, "0")).join("")}`.toUpperCase();

const colorDistance = (a: WeightedColor, b: WeightedColor) => {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
};

const hexToWeightedColor = (hex: string): WeightedColor => ({
  r: Number.parseInt(hex.slice(1, 3), 16),
  g: Number.parseInt(hex.slice(3, 5), 16),
  b: Number.parseInt(hex.slice(5, 7), 16),
  count: 1
});

const createColorBox = (colors: WeightedColor[]): ColorBox => {
  let rMin = 255;
  let rMax = 0;
  let gMin = 255;
  let gMax = 0;
  let bMin = 255;
  let bMax = 0;
  let count = 0;
  for (const color of colors) {
    rMin = Math.min(rMin, color.r);
    rMax = Math.max(rMax, color.r);
    gMin = Math.min(gMin, color.g);
    gMax = Math.max(gMax, color.g);
    bMin = Math.min(bMin, color.b);
    bMax = Math.max(bMax, color.b);
    count += color.count;
  }
  return { colors, count, rMin, rMax, gMin, gMax, bMin, bMax };
};

const boxScore = (box: ColorBox) => {
  const range = Math.max(box.rMax - box.rMin, box.gMax - box.gMin, box.bMax - box.bMin);
  return range * Math.sqrt(Math.max(1, box.count));
};

const splitBox = (box: ColorBox) => {
  if (box.colors.length < 2) {
    return null;
  }
  const ranges = [
    { channel: "r" as const, range: box.rMax - box.rMin },
    { channel: "g" as const, range: box.gMax - box.gMin },
    { channel: "b" as const, range: box.bMax - box.bMin }
  ].sort((a, b) => b.range - a.range);
  const channel = ranges[0].channel;
  const colors = [...box.colors].sort((a, b) => a[channel] - b[channel]);
  const splitAtCount = box.count / 2;
  let cursor = 0;
  let splitIndex = 1;
  for (let index = 0; index < colors.length - 1; index += 1) {
    cursor += colors[index].count;
    if (cursor >= splitAtCount) {
      splitIndex = index + 1;
      break;
    }
  }
  return [createColorBox(colors.slice(0, splitIndex)), createColorBox(colors.slice(splitIndex))];
};

const averageBoxColor = (box: ColorBox): WeightedColor => {
  let r = 0;
  let g = 0;
  let b = 0;
  for (const color of box.colors) {
    r += color.r * color.count;
    g += color.g * color.count;
    b += color.b * color.count;
  }
  const count = Math.max(1, box.count);
  return {
    r: r / count,
    g: g / count,
    b: b / count,
    count: box.count
  };
};

const chooseDistinctColors = (colors: WeightedColor[], targetSize: number) => {
  const sorted = [...colors].sort((a, b) => b.count - a.count);
  for (const threshold of [54, 42, 30, 18, 0]) {
    const selected: WeightedColor[] = [];
    for (const color of sorted) {
      if (selected.every((item) => colorDistance(item, color) >= threshold)) {
        selected.push(color);
      }
      if (selected.length >= targetSize) {
        return selected;
      }
    }
  }
  return sorted.slice(0, targetSize);
};

const completePalette = (colors: WeightedColor[], targetSize: number) => {
  const selected = chooseDistinctColors(colors, targetSize);
  for (const hex of fallbackPalette) {
    if (selected.length >= targetSize) {
      break;
    }
    const fallback = hexToWeightedColor(hex);
    if (selected.every((color) => colorDistance(color, fallback) >= 18)) {
      selected.push(fallback);
    }
  }
  return selected.slice(0, targetSize).map(rgbToHex);
};

export const extractSourceImagePalette = (imageData: ImageData, requestedSize: number) => {
  const targetSize = normalizeSourcePaletteSize(requestedSize);
  const { data, width, height } = imageData;
  const pixelCount = width * height;
  const maxSamples = 18_000;
  const stride = Math.max(1, Math.floor(pixelCount / maxSamples));
  const buckets = new Map<number, { r: number; g: number; b: number; count: number }>();

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += stride) {
    const index = pixelIndex * 4;
    const alpha = data[index + 3];
    if (alpha < 12) {
      continue;
    }
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const key = (r >> 3) << 10 | (g >> 3) << 5 | (b >> 3);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
      bucket.count += 1;
    } else {
      buckets.set(key, { r, g, b, count: 1 });
    }
  }

  const colors = Array.from(buckets.values()).map((bucket) => ({
    r: bucket.r / bucket.count,
    g: bucket.g / bucket.count,
    b: bucket.b / bucket.count,
    count: bucket.count
  }));

  if (!colors.length) {
    return fallbackPalette.slice(0, targetSize);
  }
  if (colors.length <= targetSize) {
    return completePalette(colors.sort((a, b) => b.count - a.count), targetSize);
  }

  const boxes = [createColorBox(colors)];
  while (boxes.length < targetSize) {
    boxes.sort((a, b) => boxScore(b) - boxScore(a));
    const box = boxes.shift();
    if (!box) {
      break;
    }
    const split = splitBox(box);
    if (!split) {
      boxes.push(box);
      break;
    }
    boxes.push(...split);
  }

  return completePalette(boxes.map(averageBoxColor), targetSize);
};
