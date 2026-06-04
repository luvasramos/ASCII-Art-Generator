import type { AnimatedExportQuality, AnimationType, RenderGrid } from "../renderer/types";

export interface AnimatedExportProfile {
  quality: AnimatedExportQuality;
  label: string;
  description: string;
  paletteSize: number;
  videoBitsPerPixel: number;
  mp4Crf: number;
  mp4Preset: "veryfast" | "medium" | "slow";
}

export interface VideoEncodingSettings {
  fps: number;
  bitrate: number;
  crf: number;
  preset: AnimatedExportProfile["mp4Preset"];
  profile: AnimatedExportProfile;
}

const baseProfiles: Record<AnimatedExportQuality, AnimatedExportProfile> = {
  preview: {
    quality: "preview",
    label: "Preview",
    description: "Faster test render",
    paletteSize: 16,
    videoBitsPerPixel: 0.16,
    mp4Crf: 24,
    mp4Preset: "veryfast"
  },
  standard: {
    quality: "standard",
    label: "Standard",
    description: "General export",
    paletteSize: 32,
    videoBitsPerPixel: 0.32,
    mp4Crf: 20,
    mp4Preset: "medium"
  },
  high: {
    quality: "high",
    label: "High",
    description: "Sharp ASCII edges",
    paletteSize: 64,
    videoBitsPerPixel: 0.6,
    mp4Crf: 18,
    mp4Preset: "medium"
  },
  master: {
    quality: "master",
    label: "Master",
    description: "Largest, cleanest export",
    paletteSize: 128,
    videoBitsPerPixel: 0.95,
    mp4Crf: 14,
    mp4Preset: "slow"
  }
};

const fallbackProfile = baseProfiles.standard;

export const animatedExportQualityOptions = Object.values(baseProfiles).map((profile) => ({
  value: profile.quality,
  label: profile.label
}));

export const resolveAnimatedExportProfile = (
  quality: AnimatedExportQuality = "standard",
  _animationType?: AnimationType
): AnimatedExportProfile => baseProfiles[quality] ?? fallbackProfile;

export const resolveAnimatedExportFps = (
  fps: number,
  _quality: AnimatedExportQuality = "standard",
  _animationType?: AnimationType
) => Math.max(1, Math.min(60, Math.round(fps)));

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const minimumBitrateForResolution = (
  width: number,
  height: number,
  quality: AnimatedExportQuality
) => {
  const pixelRatio = Math.max(1, (width * height) / (1920 * 1080));
  const minimum1080p: Record<AnimatedExportQuality, number> = {
    preview: 6_000_000,
    standard: 12_000_000,
    high: 30_000_000,
    master: 45_000_000
  };

  return Math.round(minimum1080p[quality] * pixelRatio);
};

export const resolveVideoEncodingSettings = ({
  width,
  height,
  fps,
  quality,
  animationType
}: {
  width: number;
  height: number;
  fps: number;
  quality: AnimatedExportQuality;
  animationType?: AnimationType;
}): VideoEncodingSettings => {
  const profile = resolveAnimatedExportProfile(quality, animationType);
  const normalizedFps = resolveAnimatedExportFps(fps, quality, animationType);
  const rawTarget = Math.round(width * height * normalizedFps * profile.videoBitsPerPixel);
  const minimum = minimumBitrateForResolution(width, height, profile.quality);
  const bitrate = clamp(Math.max(rawTarget, minimum), 4_000_000, 220_000_000);

  return {
    fps: normalizedFps,
    bitrate,
    crf: profile.mp4Crf,
    preset: profile.mp4Preset,
    profile
  };
};

export const estimateAnimatedExportSize = ({
  grid,
  duration,
  fps,
  quality,
  animationType,
  exportScale = 1
}: {
  grid: RenderGrid | null;
  duration: number;
  fps: number;
  quality: AnimatedExportQuality;
  animationType?: AnimationType;
  exportScale?: number;
}) => {
  if (!grid || !Number.isFinite(duration) || duration <= 0) {
    return null;
  }

  const effectiveFps = resolveAnimatedExportFps(fps, quality, animationType);
  const frames = Math.max(1, Math.round(duration * effectiveFps));
  const width = Math.max(1, Math.round(grid.width * exportScale));
  const height = Math.max(1, Math.round(grid.height * exportScale));
  const pixels = width * height;
  const profile = resolveAnimatedExportProfile(quality, animationType);
  const encoding = resolveVideoEncodingSettings({ width, height, fps: effectiveFps, quality, animationType });
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
  const webmBytes = (encoding.bitrate * duration) / 8;
  const mp4Bytes = (encoding.bitrate * duration * 0.9) / 8;

  return {
    effectiveFps,
    frames,
    width,
    height,
    bitrate: encoding.bitrate,
    crf: encoding.crf,
    preset: encoding.preset,
    qualityLabel: profile.label,
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

export const formatBitrate = (bitsPerSecond: number) => {
  if (bitsPerSecond < 1_000_000) {
    return `${Math.round(bitsPerSecond / 1000)} Kbps`;
  }
  return `${(bitsPerSecond / 1_000_000).toFixed(bitsPerSecond < 10_000_000 ? 1 : 0)} Mbps`;
};
