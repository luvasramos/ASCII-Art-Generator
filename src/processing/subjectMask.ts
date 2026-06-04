const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export interface SubjectMaps {
  alpha: Float32Array;
  coverage: Float32Array;
  usesSourceAlpha: boolean;
}

const estimateBorderLuminance = (luminance: Float32Array, width: number, height: number) => {
  let sum = 0;
  let count = 0;

  for (let x = 0; x < width; x += 1) {
    sum += luminance[x];
    sum += luminance[(height - 1) * width + x];
    count += 2;
  }

  for (let y = 1; y < height - 1; y += 1) {
    sum += luminance[y * width];
    sum += luminance[y * width + width - 1];
    count += 2;
  }

  return sum / Math.max(1, count);
};

export const buildSubjectMaps = (imageData: ImageData, luminance: Float32Array): SubjectMaps => {
  const { data, width, height } = imageData;
  const alpha = new Float32Array(width * height);
  let hasMeaningfulTransparency = false;

  for (let pixel = 0, index = 0; pixel < data.length; pixel += 4, index += 1) {
    const value = data[pixel + 3] / 255;
    alpha[index] = value;
    if (value < 0.98) {
      hasMeaningfulTransparency = true;
    }
  }

  if (hasMeaningfulTransparency) {
    return {
      alpha,
      coverage: alpha.slice(),
      usesSourceAlpha: true
    };
  }

  const borderLuminance = estimateBorderLuminance(luminance, width, height);
  const coverage = new Float32Array(width * height);
  for (let index = 0; index < luminance.length; index += 1) {
    coverage[index] = clamp01(Math.abs(luminance[index] - borderLuminance) * 2.6);
  }

  return {
    alpha,
    coverage,
    usesSourceAlpha: false
  };
};
