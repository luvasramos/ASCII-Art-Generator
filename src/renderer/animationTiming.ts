export const previewFpsOptions = [12, 24, 30, 60] as const;

export type PreviewFps = (typeof previewFpsOptions)[number];

export const normalizeAnimationFps = (fps: number, fallback = 24) => {
  const value = Number.isFinite(fps) ? fps : fallback;
  return Math.max(1, Math.min(60, Math.round(value)));
};

export const normalizePreviewFps = (fps: number, fallback: PreviewFps = 24): PreviewFps => {
  const value = Number.isFinite(fps) ? Math.round(fps) : fallback;
  return previewFpsOptions.includes(value as PreviewFps) ? (value as PreviewFps) : fallback;
};

export const resolveAnimationFrameCount = (durationSeconds: number, fps: number) => {
  const safeDuration = Math.max(0.001, Number.isFinite(durationSeconds) ? durationSeconds : 0.001);
  return Math.max(1, Math.round(safeDuration * normalizeAnimationFps(fps)));
};

export const resolveExportAnimationFrameTiming = (frameIndex: number, totalFrames: number, fps: number) => {
  const normalizedFps = normalizeAnimationFps(fps);
  const normalizedTotal = Math.max(1, Math.round(totalFrames));
  const normalizedFrame = Math.max(0, Math.round(frameIndex));
  return {
    fps: normalizedFps,
    frameIndex: normalizedFrame,
    totalFrames: normalizedTotal,
    timestamp: normalizedFrame / normalizedFps,
    progress: normalizedFrame / normalizedTotal
  };
};

export const resolvePreviewAnimationTiming = ({
  elapsedSeconds,
  exportFps,
  previewFps,
  deterministic
}: {
  elapsedSeconds: number;
  exportFps: number;
  previewFps: number;
  deterministic: boolean;
}) => {
  const elapsed = Math.max(0, Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0);
  const normalizedExportFps = normalizeAnimationFps(exportFps);
  const normalizedPreviewFps = normalizePreviewFps(previewFps);
  const previewFrameIndex = Math.max(0, Math.floor(elapsed * normalizedPreviewFps));
  const previewTimestamp = previewFrameIndex / normalizedPreviewFps;
  const exportFrameIndex = Math.max(0, Math.floor(previewTimestamp * normalizedExportFps + 1e-6));
  return {
    exportFps: normalizedExportFps,
    previewFps: normalizedPreviewFps,
    previewFrameIndex,
    exportFrameIndex,
    previewTimestamp,
    animationTimeSeconds: deterministic ? exportFrameIndex / normalizedExportFps : elapsed
  };
};
