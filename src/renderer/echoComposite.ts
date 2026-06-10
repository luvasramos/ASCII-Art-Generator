import type { AnimationSettings } from "./types";

export interface EchoFrameHistory {
  frames: HTMLCanvasElement[];
  width: number;
  height: number;
  sampleCursor: number;
}

interface EchoCompositeArgs {
  targetCanvas: HTMLCanvasElement;
  currentLayerCanvas: HTMLCanvasElement;
  history: EchoFrameHistory;
  animation?: AnimationSettings;
  binaryAlpha?: boolean;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const prepareCanvas = (canvas: HTMLCanvasElement, width: number, height: number) => {
  if (canvas.width !== width) {
    canvas.width = width;
  }
  if (canvas.height !== height) {
    canvas.height = height;
  }
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
};

const echoStride = (animation: AnimationSettings) =>
  1 + Math.round(clamp01(animation.echoSpacing / 100) * 7);

export const resolveEchoLayerAlpha = (animation: AnimationSettings, index: number, count: number) => {
  const baseOpacity = clamp01(animation.echoOpacity / 100);
  const remaining = clamp01(1 - index / Math.max(1, count));
  if (animation.echoFadeCurve === "exponential") {
    return baseOpacity * Math.pow(remaining, 2.35);
  }
  if (animation.echoFadeCurve === "smooth") {
    const smooth = remaining * remaining * (3 - 2 * remaining);
    return baseOpacity * smooth;
  }
  return baseOpacity * remaining;
};

const isEchoDebugEnabled = () => {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return (
      new URLSearchParams(window.location.search).has("echoDebug") ||
      window.localStorage.getItem("ascii-studio-echo-debug") === "1"
    );
  } catch {
    return false;
  }
};

const createTintedDebugLayer = (sourceCanvas: HTMLCanvasElement, color: string) => {
  const canvas = document.createElement("canvas");
  canvas.width = sourceCanvas.width;
  canvas.height = sourceCanvas.height;
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) {
    return sourceCanvas;
  }
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(sourceCanvas, 0, 0);
  context.globalCompositeOperation = "source-in";
  context.fillStyle = color;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.globalCompositeOperation = "source-over";
  return canvas;
};

const thresholdCanvasAlpha = (canvas: HTMLCanvasElement) => {
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) {
    return;
  }
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 3; index < imageData.data.length; index += 4) {
    imageData.data[index] = imageData.data[index] >= 128 ? 255 : 0;
  }
  context.putImageData(imageData, 0, 0);
};

export const createEchoFrameHistory = (): EchoFrameHistory => ({
  frames: [],
  width: 0,
  height: 0,
  sampleCursor: 0
});

export const resetEchoFrameHistory = (history: EchoFrameHistory) => {
  history.frames = [];
  history.width = 0;
  history.height = 0;
  history.sampleCursor = 0;
};

export const isEchoActive = (animation?: AnimationSettings | null) =>
  Boolean(animation?.enabled && animation.echoEnabled && animation.echoCount > 0 && animation.echoOpacity > 0);

export const copyCanvasFrame = (targetCanvas: HTMLCanvasElement, sourceCanvas: HTMLCanvasElement) => {
  const width = Math.max(1, sourceCanvas.width);
  const height = Math.max(1, sourceCanvas.height);
  prepareCanvas(targetCanvas, width, height);
  const targetContext = targetCanvas.getContext("2d", { alpha: true });
  if (!targetContext) {
    return;
  }
  targetContext.clearRect(0, 0, width, height);
  targetContext.globalAlpha = 1;
  targetContext.globalCompositeOperation = "source-over";
  targetContext.drawImage(sourceCanvas, 0, 0);
};

export const pushEchoFrame = (
  history: EchoFrameHistory,
  currentLayerCanvas: HTMLCanvasElement,
  animation?: AnimationSettings
) => {
  if (!animation || !isEchoActive(animation)) {
    resetEchoFrameHistory(history);
    return;
  }

  const width = Math.max(1, currentLayerCanvas.width);
  const height = Math.max(1, currentLayerCanvas.height);
  if (history.width !== width || history.height !== height) {
    resetEchoFrameHistory(history);
    history.width = width;
    history.height = height;
  }

  const stride = echoStride(animation);
  history.sampleCursor = (history.sampleCursor + 1) % stride;
  if (history.sampleCursor !== 0) {
    return;
  }

  const count = Math.max(0, Math.round(animation.echoCount));
  const nextFrame = (history.frames.length >= count ? history.frames.pop() : undefined) ?? document.createElement("canvas");
  copyCanvasFrame(nextFrame, currentLayerCanvas);
  history.frames.unshift(nextFrame);
  while (history.frames.length > count) {
    history.frames.pop();
  }
};

export const compositeEchoFrame = ({
  targetCanvas,
  currentLayerCanvas,
  history,
  animation,
  binaryAlpha = false
}: EchoCompositeArgs) => {
  const width = Math.max(1, currentLayerCanvas.width);
  const height = Math.max(1, currentLayerCanvas.height);
  prepareCanvas(targetCanvas, width, height);

  const targetContext = targetCanvas.getContext("2d", { alpha: true });
  if (!targetContext) {
    return;
  }

  targetContext.clearRect(0, 0, width, height);
  targetContext.globalCompositeOperation = "source-over";
  targetContext.imageSmoothingEnabled = false;

  const count = animation ? Math.max(0, Math.round(animation.echoCount)) : 0;
  const frameCount = Math.min(count, history.frames.length);
  const debug = isEchoDebugEnabled();
  const debugColors = ["#ff3b30", "#34c759", "#0a84ff"];
  for (let index = frameCount - 1; index >= 0; index -= 1) {
    const frame = history.frames[index];
    if (!frame) {
      continue;
    }
    const layerAlpha = animation ? resolveEchoLayerAlpha(animation, index, count) : 0;
    targetContext.globalAlpha = binaryAlpha ? (layerAlpha > 0.001 ? 1 : 0) : layerAlpha;
    targetContext.drawImage(
      debug ? createTintedDebugLayer(frame, debugColors[index] ?? "#ffffff") : frame,
      0,
      0
    );
  }

  targetContext.globalAlpha = 1;
  targetContext.drawImage(debug ? createTintedDebugLayer(currentLayerCanvas, "#ffffff") : currentLayerCanvas, 0, 0);
  if (binaryAlpha) {
    thresholdCanvasAlpha(targetCanvas);
  }
};
