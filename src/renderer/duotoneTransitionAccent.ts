import { invertCssColor } from "../quantization/color";
import type { AnimationSettings, AsciiSettings, CellRenderData, ColorSettings } from "./types";
import {
  hintsOfColorCanRender,
  matrixTransitionColorCanRender,
  resolveHintsOfColorAmount
} from "./strictDuotone";

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const hashCell = (x: number, y: number, seed: number, salt: number) => {
  const value = Math.sin((x + 1) * 127.1 + (y + 1) * 311.7 + seed * 0.017 + salt * 74.7) * 43758.5453123;
  return value - Math.floor(value);
};

export const isDuotoneTransitionAccentEnabled = (animation?: AnimationSettings | null) =>
  matrixTransitionColorCanRender(animation);

export const resolveDuotoneTransitionColor = (animation: AnimationSettings, color: ColorSettings) =>
  color.invert ? invertCssColor(animation.matrixTransitionColor) : animation.matrixTransitionColor;

const shouldUseDeterministicDuotoneAccent = (
  cell: CellRenderData,
  amount: number,
  ascii: AsciiSettings,
  salt: number,
  seedOverride?: number
) => {
  const normalizedAmount = clamp01(amount / 100);
  if (normalizedAmount <= 0) {
    return false;
  }

  const detailWeight = clamp01(
    cell.edgeMagnitude * 2.35 +
      cell.localContrast * 1.6 +
      Math.sqrt(Math.max(0, cell.variance)) * 0.95 +
      cell.foreground * 0.22
  );
  const maxAccentCoverage = 0.08 + detailWeight * 0.34;
  const accentChance = normalizedAmount * maxAccentCoverage;
  const seed = typeof seedOverride === "number" && Number.isFinite(seedOverride)
    ? seedOverride
    : Number.isFinite(ascii.randomSeed)
      ? ascii.randomSeed
      : 1337;
  return hashCell(cell.x, cell.y, seed, salt) < accentChance;
};

const animatedHintBucket = (animation: AnimationSettings | undefined, animationTimeSeconds: number | undefined) => {
  if (!animation?.enabled || typeof animationTimeSeconds !== "number" || !Number.isFinite(animationTimeSeconds)) {
    return null;
  }
  const duration = Math.max(0.001, animation.loopDuration);
  const loopProgress = (((animationTimeSeconds % duration) + duration) % duration) / duration;
  const targetFps = Number.isFinite(animation.fps) ? Math.max(1, Math.round(animation.fps)) : 24;
  const bucketCount = Math.max(2, Math.min(32, Math.round(Math.min(targetFps, duration * 4))));
  return Math.min(bucketCount - 1, Math.floor(loopProgress * bucketCount));
};

export const shouldUseStaticDuotoneTransitionAccent = (
  cell: CellRenderData,
  animation: AnimationSettings | undefined,
  ascii: AsciiSettings
) => {
  if (!isDuotoneTransitionAccentEnabled(animation)) {
    return false;
  }

  return shouldUseDeterministicDuotoneAccent(cell, animation?.matrixTransitionAmount ?? 0, ascii, 977);
};

export const isHintsOfColorEnabled = (color: ColorSettings, animation?: AnimationSettings) =>
  hintsOfColorCanRender(color, animation);

export const isDuotoneHitsOfColorEnabled = (color: ColorSettings, animation?: AnimationSettings) =>
  Boolean(color.paletteMode === "single" && isHintsOfColorEnabled(color, animation));

export const resolveHintsOfColor = (color: ColorSettings) => color.hitsOfColor.color;

export const resolveDuotoneHitsOfColor = resolveHintsOfColor;

const shouldUseDeterministicHintColor = (
  cell: CellRenderData,
  color: ColorSettings,
  ascii: AsciiSettings,
  animation?: AnimationSettings,
  animationTimeSeconds?: number
) => {
  const hitSeed = Number.isFinite(color.hitsOfColor.seed) ? color.hitsOfColor.seed : 1337;
  const amount = resolveHintsOfColorAmount(color, animation, animationTimeSeconds);
  if (amount <= 0) {
    return false;
  }
  const bucket = color.hitsOfColor.animated ? animatedHintBucket(animation, animationTimeSeconds) : null;
  return shouldUseDeterministicDuotoneAccent(
    cell,
    amount,
    ascii,
    bucket === null ? 421 : 421 + bucket * 37,
    hitSeed
  );
};

export const shouldUseHintColor = (
  cell: CellRenderData,
  color: ColorSettings,
  ascii: AsciiSettings,
  animation?: AnimationSettings,
  animationTimeSeconds?: number
) => {
  if (!isHintsOfColorEnabled(color, animation)) {
    return false;
  }
  return shouldUseDeterministicHintColor(cell, color, ascii, animation, animationTimeSeconds);
};

export const shouldUseStaticDuotoneHitColor = (
  cell: CellRenderData,
  color: ColorSettings,
  ascii: AsciiSettings,
  animation?: AnimationSettings,
  animationTimeSeconds?: number
) => {
  if (!isDuotoneHitsOfColorEnabled(color, animation)) {
    return false;
  }
  return shouldUseDeterministicHintColor(cell, color, ascii, animation, animationTimeSeconds);
};
