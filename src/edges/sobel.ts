export interface EdgeMaps {
  magnitude: Float32Array;
  gradientX: Float32Array;
  gradientY: Float32Array;
}

export const computeSobel = (luminance: Float32Array, width: number, height: number): EdgeMaps => {
  const magnitude = new Float32Array(luminance.length);
  const gradientX = new Float32Array(luminance.length);
  const gradientY = new Float32Array(luminance.length);

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const gx =
        -luminance[i - width - 1] -
        2 * luminance[i - 1] -
        luminance[i + width - 1] +
        luminance[i - width + 1] +
        2 * luminance[i + 1] +
        luminance[i + width + 1];
      const gy =
        -luminance[i - width - 1] -
        2 * luminance[i - width] -
        luminance[i - width + 1] +
        luminance[i + width - 1] +
        2 * luminance[i + width] +
        luminance[i + width + 1];
      gradientX[i] = gx;
      gradientY[i] = gy;
      magnitude[i] = Math.min(1, Math.sqrt(gx * gx + gy * gy) * 1.7);
    }
  }

  return {
    magnitude,
    gradientX,
    gradientY
  };
};
