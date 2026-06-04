import type { AnimatedExportQuality, AnimationType, RenderGrid } from "../renderer/types";

export interface AnimatedExportProfile {
  quality: AnimatedExportQuality;
  label: string;
  fpsCap: number;
  paletteSize: number;
  videoBitsPerPixel: number;
}

const baseProfiles: Record<AnimatedExportQuality, AnimatedExportProfile> = {
  small: {
    quality: "small",
    label: "Small",
    fpsCap: 12,
    paletteSize: 16,
    videoBitsPerPixel: 0.035
  },
  balanced: {
    quality: "balanced",
    label: "Balanced",
    fpsCap: 18,
    paletteSize: 32,
    videoBitsPerPixel: 0.055
  },
  high: {
    quality: "high",
    label: "High Quality",
    fpsCap: 60,
    paletteSize: 64,
    videoBitsPerPixel: 0.085
  }
};

const animationFpsCaps: Partial<Record<AnimationType, Partial<Record<AnimatedExportQuality, number>>>> = {
  matrix: { small: 10, balanced: 16 },
  fade: { small: 10, balanced: 16 },
  scale: { small: 10, balanced: 16 },
  wave: { small: 12, balanced: 18 },
  breakup: { small: 10, balanced: 16 },
  spin: { small: 12, balanced: 18 },
  ambient: { small: 12, balanced: 18 }
};

export const resolveAnimatedExportProfile = (
  quality: AnimatedExportQuality = "balanced",
  animationType?: AnimationType
): AnimatedExportProfile => {
  const base = baseProfiles[quality] ?? baseProfiles.balanced;
  const fpsCap = animationType ? animationFpsCaps[animationType]?.[base.quality] ?? base.fpsCap : base.fpsCap;
  return { ...base, fpsCap };
};

export const resolveAnimatedExportFps = (
  fps: number,
  quality: AnimatedExportQuality = "balanced",
  animationType?: AnimationType
) => Math.max(1, Math.min(resolveAnimatedExportProfile(quality, animationType).fpsCap, Math.round(fps)));

export const estimateAnimatedExportSize = ({
  grid,
  duration,
  fps,
  quality,
  animationType
}: {
  grid: RenderGrid | null;
  duration: number;
  fps: number;
  quality: AnimatedExportQuality;
  animationType?: AnimationType;
}) => {
  if (!grid || !Number.isFinite(duration) || duration <= 0) {
    return null;
  }

  const profile = resolveAnimatedExportProfile(quality, animationType);
  const effectiveFps = resolveAnimatedExportFps(fps, quality, animationType);
  const frames = Math.max(1, Math.round(duration * effectiveFps));
  const pixels = Math.max(1, Math.round(grid.width) * Math.round(grid.height));
  const changedRatio =
    animationType === "matrix"
      ? 0.34
      : animationType === "fade"
        ? 0.82
        : animationType === "scale" || animationType === "spin" || animationType === "ambient"
          ? 0.56
          : 0.64;
  const paletteFactor = Math.max(0.28, Math.log2(profile.paletteSize) / 8);
  const gifBytes = pixels * frames * changedRatio * paletteFactor * 0.28 + frames * 42;
  const webmBytes = (pixels * effectiveFps * duration * profile.videoBitsPerPixel) / 8;
  const mp4Bytes = (pixels * effectiveFps * duration * profile.videoBitsPerPixel * 1.18) / 8;

  return {
    effectiveFps,
    frames,
    gifBytes: Math.max(20_000, Math.round(gifBytes)),
    webmBytes: Math.max(12_000, Math.round(webmBytes)),
    mp4Bytes: Math.max(14_000, Math.round(mp4Bytes))
  };
};

export const formatBytes = (bytes: number) => {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
};
