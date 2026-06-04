import type { AnimationSettings } from "../renderer/types";

const TAU = Math.PI * 2;

export interface AnimatedImageRenderer {
  width: number;
  height: number;
  render: (settings: AnimationSettings, timeSeconds: number) => ImageData;
}

const createCanvas = (width: number, height: number) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

const normalizedLoopTime = (timeSeconds: number, loopDuration: number) => {
  const duration = Math.max(0.001, loopDuration);
  return ((timeSeconds % duration) + duration) % duration / duration;
};

const computeDisplacement = (
  axisPosition: number,
  crossPosition: number,
  progress: number,
  settings: AnimationSettings,
  amountPixels: number
) => {
  const strength = settings.strength / 100;
  const velocity = settings.velocity / 100;
  const phase = progress * TAU;
  const travel = 0.42 + velocity * 2.85;
  const frequency = 1.2 + strength * 4.8;
  const secondaryFrequency = 0.9 + strength * 2.7;
  const tertiaryFrequency = 2.1 + strength * 3.4;
  const orbitX = Math.cos(phase) * travel;
  const orbitY = Math.sin(phase) * travel;
  const counterX = Math.cos(phase * 2 + Math.PI * 0.35) * travel * 0.42;
  const counterY = Math.sin(phase * 2 + Math.PI * 0.35) * travel * 0.42;
  const broadWave = Math.sin(crossPosition * TAU * frequency + orbitX + axisPosition * 0.35);
  const detailWave = Math.sin((crossPosition * 0.62 + axisPosition * 0.38) * TAU * secondaryFrequency + orbitY);
  const fineWave = Math.sin((axisPosition - crossPosition) * TAU * tertiaryFrequency + counterX + counterY);
  return (broadWave * 0.58 + detailWave * 0.3 + fineWave * 0.12) * amountPixels;
};

export const createAnimatedImageRenderer = (source: ImageData): AnimatedImageRenderer => {
  const width = source.width;
  const height = source.height;
  const sourceCanvas = createCanvas(width, height);
  const passCanvas = createCanvas(width, height);
  const outputCanvas = createCanvas(width, height);
  const sourceCtx = sourceCanvas.getContext("2d", { willReadFrequently: true });
  const passCtx = passCanvas.getContext("2d");
  const outputCtx = outputCanvas.getContext("2d", { willReadFrequently: true });

  if (!sourceCtx || !passCtx || !outputCtx) {
    throw new Error("Canvas2D is unavailable for image animation.");
  }

  sourceCtx.putImageData(source, 0, 0);

  const renderStrips = (
    input: HTMLCanvasElement,
    output: HTMLCanvasElement,
    horizontal: boolean,
    settings: AnimationSettings,
    progress: number,
    amountPixels: number
  ) => {
    const ctx = output === passCanvas ? passCtx : outputCtx;
    const stripSize = 1;
    ctx.clearRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    // Draw only displaced strips; drawing the source first leaves a static ghost behind transparent PNGs.

    if (horizontal) {
      for (let y = 0; y < height; y += stripSize) {
        const stripHeight = Math.min(stripSize, height - y);
        const yNorm = (y + stripHeight * 0.5) / Math.max(1, height);
        const shift = computeDisplacement(0.5, yNorm, progress, settings, amountPixels);
        ctx.drawImage(input, 0, y, width, stripHeight, shift, y, width, stripHeight);
      }
      return;
    }

    for (let x = 0; x < width; x += stripSize) {
      const stripWidth = Math.min(stripSize, width - x);
      const xNorm = (x + stripWidth * 0.5) / Math.max(1, width);
      const shift = computeDisplacement(0.5, xNorm, progress, settings, amountPixels);
      ctx.drawImage(input, x, 0, stripWidth, height, x, shift, stripWidth, height);
    }
  };

  return {
    width,
    height,
    render: (settings, timeSeconds) => {
      if (!settings.enabled || settings.type !== "wave" || settings.intensity <= 0) {
        return new ImageData(new Uint8ClampedArray(source.data), width, height);
      }

      const progress = normalizedLoopTime(timeSeconds, settings.loopDuration);
      const amountPixels = Math.max(0, Math.min(width, height) * 0.07 * (settings.intensity / 100));

      if (settings.direction === "horizontal") {
        renderStrips(sourceCanvas, outputCanvas, true, settings, progress, amountPixels);
      } else if (settings.direction === "vertical") {
        renderStrips(sourceCanvas, outputCanvas, false, settings, progress, amountPixels);
      } else {
        renderStrips(sourceCanvas, passCanvas, true, settings, progress, amountPixels * 0.85);
        renderStrips(passCanvas, outputCanvas, false, settings, progress + 0.25, amountPixels * 0.72);
      }

      return outputCtx.getImageData(0, 0, width, height);
    }
  };
};
