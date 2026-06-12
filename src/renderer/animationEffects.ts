import { normalizeCharacterSet } from "../ascii/charset";
import type {
  AnimationSettings,
  AsciiSettings,
  BreakupSettings,
  CellRenderData,
  ColorSettings,
  FrameSettings,
  GlyphMetric,
  ImageSettings,
  RenderGrid
} from "./types";

const TAU = Math.PI * 2;

export interface RenderAnimationState {
  brightnessMultiplier: number;
  glyphAlphaMultiplier: number;
  glyphScaleMultiplier: number;
  grid: RenderGrid;
}

export interface AnimatedProcessingSettings {
  image: ImageSettings;
  frame: FrameSettings;
  breakup: BreakupSettings;
}

export const resolveVideoProceduralAnimation = (
  animation: AnimationSettings,
  color: ColorSettings
): AnimationSettings => {
  const proceduralTimelineEnabled =
    animation.matrixOverlayEnabled ||
    (color.hitsOfColor.enabled && color.hitsOfColor.animated);

  return {
    ...animation,
    enabled: proceduralTimelineEnabled,
    type: "wave",
    characterVariation: 0,
    matrixTransitionColorEnabled: false,
    matrixTransitionAmount: 0,
    echoEnabled: false
  };
};

const normalizedLoopTime = (timeSeconds: number, loopDuration: number) => {
  const duration = Math.max(0.001, loopDuration);
  return (((timeSeconds % duration) + duration) % duration) / duration;
};

const hash = (x: number, y: number, salt: number) => {
  const value = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453123;
  return value - Math.floor(value);
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const smootherstep = (value: number) => {
  const clamped = clamp01(value);
  return clamped * clamped * clamped * (clamped * (clamped * 6 - 15) + 10);
};

const shapeMotion = (value: number, velocity: number) => {
  const exponent = 1.9 - clamp01(velocity / 400) * 1.1;
  return smootherstep(Math.pow(smootherstep(value), Math.max(0.65, exponent)));
};

const resolveAnimationClock = (animation: AnimationSettings, timeSeconds: number) => {
  const progress = normalizedLoopTime(timeSeconds, animation.loopDuration);
  const phase = progress * TAU;
  const pingPong = shapeMotion(0.5 - Math.cos(phase) * 0.5, animation.velocity);
  return {
    progress,
    phase,
    pingPong
  };
};

const linearPingPong = (progress: number) => {
  const wrapped = ((progress % 1) + 1) % 1;
  return wrapped < 0.5 ? wrapped * 2 : (1 - wrapped) * 2;
};

const getEffectLoopProgress = (animation: AnimationSettings, timeSeconds: number) => {
  const clock = resolveAnimationClock(animation, timeSeconds);
  return (clock.progress * Math.max(0.1, animation.effectLoopsPerLoop)) % 1;
};

const getScaleProgress = (animation: AnimationSettings, timeSeconds: number) => {
  const effectProgress = getEffectLoopProgress(animation, timeSeconds);
  if (animation.scaleMovement === "constant") {
    return linearPingPong(effectProgress);
  }
  return smootherstep(0.5 - Math.cos(effectProgress * TAU) * 0.5);
};

export const getPingPongProgress = (animation: AnimationSettings, timeSeconds: number) => {
  return resolveAnimationClock(animation, timeSeconds).pingPong;
};

const getContinuousProgress = (animation: AnimationSettings, timeSeconds: number) =>
  resolveAnimationClock(animation, timeSeconds).progress;

const getSpinRotationProgress = (animation: AnimationSettings, timeSeconds: number) =>
  resolveAnimationClock(animation, timeSeconds).progress * Math.max(0.05, animation.spinRotationsPerLoop);

const variedProgress = (cell: CellRenderData, amount: number, animation: AnimationSettings, salt: number) => {
  const variation = clamp01(animation.characterVariation / 100);
  if (variation <= 0) {
    return amount;
  }
  const phase = hash(cell.x, cell.y, salt);
  const envelope = Math.sin(clamp01(amount) * Math.PI);
  const offset = (phase - 0.5) * variation * 0.36 * envelope;
  const ripple = Math.sin((amount + phase) * TAU) * variation * 0.1 * envelope;
  return smootherstep(clamp01(amount + offset + ripple));
};

const sortGlyphsByDensity = (glyphs: GlyphMetric[]) => [...glyphs].sort((a, b) => a.density - b.density);

const nearestGlyph = (glyphs: GlyphMetric[], density: number) => {
  let best = glyphs[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const glyph of glyphs) {
    const distance = Math.abs(glyph.density - density);
    if (distance < bestDistance) {
      best = glyph;
      bestDistance = distance;
    }
  }
  return best?.glyph ?? " ";
};

interface MatrixGlyphControls {
  intensity: number;
  speed: number;
  changeRate: number;
  changeRateMax: number;
  randomness: number;
  continuous: boolean;
  salt: number;
}

interface GlyphDensityCandidate {
  glyph: string;
  density: number;
}

const matrixSlotCount = ({ speed, continuous }: MatrixGlyphControls) => {
  const speed01 = clamp01(speed / 400);
  const maxSlots = continuous ? 72 : 64;
  return Math.max(1, Math.round(1 + Math.pow(speed01, 2.4) * (maxSlots - 1)));
};

const matrixChancePulse = (fraction: number) => Math.sin(clamp01(fraction) * Math.PI);

const matrixSeedSalt = (ascii: AsciiSettings, controls: MatrixGlyphControls) => {
  const seed = Number.isFinite(ascii.randomSeed) ? Math.trunc(ascii.randomSeed) : 1337;
  return controls.salt + ((seed % 100_000) + 100_000) % 100_000;
};

const resolveMatrixCellTiming = (
  cell: CellRenderData,
  progress: number,
  slots: number,
  secondarySlots: number,
  controls: MatrixGlyphControls
) => {
  const cellPhase = hash(cell.x, cell.y, 73 + controls.salt);
  const cellPhaseB = hash(cell.x, cell.y, 89 + controls.salt);
  const localProgress = (progress + cellPhase) % 1;
  const slot = Math.min(slots - 1, Math.floor(localProgress * slots));
  const fraction = localProgress * slots - slot;
  const secondaryProgress = controls.continuous
    ? (progress + cellPhaseB) % 1
    : (progress + cellPhaseB + slot / Math.max(1, slots)) % 1;
  const secondarySlot = Math.min(secondarySlots - 1, Math.floor(secondaryProgress * secondarySlots));

  return {
    slot,
    secondarySlot,
    fraction
  };
};

const matrixChangeChance = (
  cell: CellRenderData,
  baseChance: number,
  fraction: number,
  slot: number,
  controls: MatrixGlyphControls
) => {
  const pulse = matrixChancePulse(fraction);
  const changeAmount = clamp01(controls.changeRate / Math.max(1, controls.changeRateMax));
  const amountCoverage = changeAmount <= 0 ? 0 : Math.min(1, 0.08 + Math.pow(changeAmount, 0.55) * 0.92);
  const intensityGate = 0.35 + clamp01(baseChance) * 0.65;
  const activeCoverage = Math.min(0.92, amountCoverage * intensityGate);
  if (controls.continuous) {
    return activeCoverage * (0.58 + pulse * 0.32 + hash(cell.x, cell.y, slot + 191 + controls.salt) * 0.1);
  }
  const cellVariation = 0.82 + hash(cell.x, cell.y, slot + 191 + controls.salt) * 0.18;
  return activeCoverage * (0.62 + pulse * 0.38) * cellVariation;
};

const matrixTransitionStrength = (
  cell: CellRenderData,
  animation: AnimationSettings,
  controls: MatrixGlyphControls,
  slot: number,
  secondarySlot: number,
  fraction: number
) => {
  if (!animation.matrixTransitionColorEnabled) {
    return 0;
  }
  const amount = clamp01(animation.matrixTransitionAmount / 100);
  if (amount <= 0) {
    return 0;
  }
  const selected = hash(cell.x, cell.y, slot * 29 + secondarySlot * 43 + 509 + controls.salt);
  if (selected > amount) {
    return 0;
  }
  const pulse = matrixChancePulse(fraction);
  const variation = 0.78 + hash(cell.x, cell.y, slot * 37 + secondarySlot * 17 + 613 + controls.salt) * 0.22;
  return (0.16 + pulse * 0.26) * variation;
};

const withMatrixTransition = (cell: CellRenderData, strength: number): CellRenderData =>
  strength > 0
    ? {
        ...cell,
        matrixTransition: Math.max(cell.matrixTransition ?? 0, strength)
      }
    : cell;

const withMatrixCellPulse = (
  cell: CellRenderData,
  strength: number,
  fraction: number,
  patch: Partial<CellRenderData>
): CellRenderData => {
  const pulse = matrixChancePulse(fraction);
  const alphaPulse = 0.72 + pulse * 0.28;
  return withMatrixTransition(
    {
      ...cell,
      ...patch,
      foregroundAlpha: clamp01(cell.foregroundAlpha * alphaPulse),
      foreground: clamp01((patch.foreground ?? cell.foreground) * (0.86 + pulse * 0.22))
    },
    strength
  );
};

const uniqueCharacters = (value: string) => Array.from(new Set(Array.from(value.replace(/\s/g, ""))));

const buildGlyphDensityCandidates = (
  ascii: AsciiSettings,
  glyphMetrics: GlyphMetric[] | undefined
): GlyphDensityCandidate[] => {
  const characters = uniqueCharacters(normalizeCharacterSet(ascii.charset));
  if (characters.length < 2) {
    return [];
  }

  const fallbackDensityStep = characters.length > 1 ? 1 / (characters.length - 1) : 0;
  const metricByGlyph = new Map(glyphMetrics?.map((metric) => [metric.glyph, metric.density]) ?? []);
  return characters
    .map((glyph, index) => ({
      glyph,
      density: clamp01(metricByGlyph.get(glyph) ?? index * fallbackDensityStep)
    }))
    .sort((a, b) => a.density - b.density);
};

const nearestGlyphDensityIndex = (candidates: GlyphDensityCandidate[], density: number) => {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < candidates.length; index += 1) {
    const distance = Math.abs(candidates[index].density - density);
    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
  }
  return bestIndex;
};

const buildGlyphDensityRankMap = (candidates: GlyphDensityCandidate[]) =>
  new Map(candidates.map((candidate, index) => [candidate.glyph, index]));

const applyFadeIntensity = (
  grid: RenderGrid,
  ascii: AsciiSettings,
  glyphMetrics: GlyphMetric[] | undefined,
  animation: AnimationSettings,
  amount: number
): RenderGrid => {
  const strength = clamp01(animation.strength / 100);

  if (strength <= 0 || amount >= 0.999) {
    return grid;
  }

  if (ascii.glyphMode === "images") {
    return {
      ...grid,
      cells: grid.cells.map((cell): CellRenderData => {
        const local = variedProgress(cell, amount, animation, 31);
        const localIntensity = smootherstep(1 - strength * (1 - local));
        const density = 0.04 + localIntensity * 0.96;
        return {
          ...cell,
          foreground: clamp01(cell.foreground * (0.08 + localIntensity * 0.92)),
          foregroundAlpha: clamp01(cell.foregroundAlpha * localIntensity),
          background: clamp01(cell.background * density),
          backgroundAlpha: clamp01(cell.backgroundAlpha * density)
        };
      })
    };
  }

  const glyphs = glyphMetrics?.length ? sortGlyphsByDensity(glyphMetrics) : [];
  if (glyphs.length < 2) {
    return grid;
  }

  const byGlyph = new Map(glyphs.map((glyph) => [glyph.glyph, glyph]));
  const lightestDensity = glyphs[0]?.density ?? 0;
  const nextCells = grid.cells.map((cell): CellRenderData => {
    if (!cell.glyph || cell.glyph === " ") {
      return cell;
    }

    const currentDensity = byGlyph.get(cell.glyph)?.density ?? cell.foreground;
    const local = variedProgress(cell, amount, animation, 41);
    const localIntensity = smootherstep(1 - strength * (1 - local));
    const backgroundDensity = 0.04 + localIntensity * 0.96;
    const targetDensity = clamp01(lightestDensity * (1 - localIntensity) + currentDensity * localIntensity);
    return {
      ...cell,
      background: clamp01(cell.background * backgroundDensity),
      backgroundAlpha: clamp01(cell.backgroundAlpha * backgroundDensity),
      foreground: clamp01(cell.foreground * (0.12 + localIntensity * 0.88)),
      foregroundAlpha: clamp01(cell.foregroundAlpha * localIntensity),
      glyph: nearestGlyph(glyphs, targetDensity)
    };
  });

  return {
    ...grid,
    cells: nextCells
  };
};

const applyMatrixGlyphs = (
  grid: RenderGrid,
  ascii: AsciiSettings,
  animation: AnimationSettings,
  progress: number,
  glyphMetrics?: GlyphMetric[],
  controls: MatrixGlyphControls = {
    intensity: animation.strength,
    speed: animation.velocity,
    changeRate: animation.strength,
    changeRateMax: 100,
    randomness: animation.strength,
    continuous: animation.matrixLoopStyle === "continuous",
    salt: 0
  }
): RenderGrid => {
  const baseChance = clamp01(controls.intensity / 100);
  const randomness = clamp01(controls.randomness / 100);
  const seededControls: MatrixGlyphControls = {
    ...controls,
    salt: matrixSeedSalt(ascii, controls)
  };
  const slots = matrixSlotCount(seededControls);
  const secondarySlots = Math.max(3, Math.round(slots * 0.37));

  if (baseChance <= 0) {
    return grid;
  }

  if (ascii.glyphMode === "images") {
    const glyphCount = ascii.imageGlyphs.length;
    if (glyphCount < 2) {
      return grid;
    }

    const nextCells = grid.cells.map((cell): CellRenderData => {
      if (cell.alpha <= 0.01 || cell.foregroundAlpha <= 0) {
        return cell;
      }

      const { slot, secondarySlot, fraction } = resolveMatrixCellTiming(
        cell,
        progress,
        slots,
        secondarySlots,
        seededControls
      );
      const chance = matrixChangeChance(cell, baseChance, fraction, slot, seededControls);
      if (hash(cell.x, cell.y, slot + secondarySlot * 13 + seededControls.salt) > chance) {
        return cell;
      }

      const baseIndex = Math.round(clamp01(cell.foreground) * (glyphCount - 1));
      const maxSpan = Math.max(1, Math.ceil((glyphCount - 1) * (0.035 + randomness * 0.28 + baseChance * 0.08)));
      const randomOffset = Math.round(
        (hash(cell.x + slot * 17, cell.y + secondarySlot * 31, slot + 17 + seededControls.salt) * 2 - 1) * maxSpan
      );
      const fallbackOffset =
        randomOffset === 0 && maxSpan > 0
          ? hash(cell.x, cell.y, slot + 211 + seededControls.salt) > 0.5
            ? 1
            : -1
          : randomOffset;
      const nextIndex = Math.min(glyphCount - 1, Math.max(0, baseIndex + fallbackOffset));
      const nextForeground = glyphCount > 1 ? nextIndex / (glyphCount - 1) : cell.foreground;
      if (nextIndex === baseIndex) {
        return cell;
      }

      return withMatrixCellPulse(
        cell,
        matrixTransitionStrength(cell, animation, seededControls, slot, secondarySlot, fraction),
        fraction,
        { foreground: nextForeground }
      );
    });

    return {
      ...grid,
      cells: nextCells
    };
  }

  if (ascii.glyphMode !== "characters") {
    return grid;
  }
  const characters = normalizeCharacterSet(ascii.charset).replace(/\s/g, "");
  if (characters.length < 2) {
    return grid;
  }
  const glyphCandidates = buildGlyphDensityCandidates(ascii, glyphMetrics);
  if (glyphCandidates.length < 2) {
    return grid;
  }
  const glyphRankByCharacter = buildGlyphDensityRankMap(glyphCandidates);

  const nextCells = grid.cells.map((cell): CellRenderData => {
    if (cell.alpha <= 0.01 || cell.foregroundAlpha <= 0) {
      return cell;
    }

    const { slot, secondarySlot, fraction } = resolveMatrixCellTiming(
      cell,
      progress,
      slots,
      secondarySlots,
      seededControls
    );
    const chance = matrixChangeChance(cell, baseChance, fraction, slot, seededControls);
    if (!cell.glyph || cell.glyph === " " || hash(cell.x, cell.y, slot + secondarySlot * 13 + seededControls.salt) > chance) {
      return cell;
    }
    const currentDensity = clamp01(cell.foreground);
    const currentIndex =
      glyphRankByCharacter.get(cell.glyph) ?? nearestGlyphDensityIndex(glyphCandidates, currentDensity);
    const maxSpan = Math.max(
      1,
      Math.ceil((glyphCandidates.length - 1) * (0.025 + randomness * 0.24 + baseChance * 0.08))
    );
    const randomOffset = Math.round(
      (hash(cell.x + slot * 17, cell.y + secondarySlot * 31, slot + 17 + seededControls.salt) * 2 - 1) * maxSpan
    );
    const fallbackOffset =
      randomOffset === 0
        ? hash(cell.x + slot * 23, cell.y + secondarySlot * 29, slot + 331 + seededControls.salt) > 0.5
          ? 1
          : -1
        : randomOffset;
    const index = Math.min(glyphCandidates.length - 1, Math.max(0, currentIndex + fallbackOffset));
    const nextGlyph = glyphCandidates[index]?.glyph ?? cell.glyph;
    if (nextGlyph === cell.glyph) {
      return cell;
    }

    return withMatrixCellPulse(
      cell,
      matrixTransitionStrength(cell, animation, seededControls, slot, secondarySlot, fraction),
      fraction,
      { glyph: nextGlyph }
    );
  });
  return {
    ...grid,
    cells: nextCells
  };
};

export const resolveRenderAnimationState = (
  grid: RenderGrid,
  ascii: AsciiSettings,
  animation?: AnimationSettings,
  timeSeconds = 0,
  glyphMetrics?: GlyphMetric[]
): RenderAnimationState => {
  if (!animation?.enabled) {
    return {
      brightnessMultiplier: 1,
      glyphAlphaMultiplier: 1,
      glyphScaleMultiplier: 1,
      grid
    };
  }

  const clock = resolveAnimationClock(animation, timeSeconds);
  const amount = clock.pingPong;
  const progress = getContinuousProgress(animation, timeSeconds);
  const withMatrixOverlay = (nextGrid: RenderGrid) =>
    animation.matrixOverlayEnabled
      ? applyMatrixGlyphs(nextGrid, ascii, animation, progress, glyphMetrics, {
          intensity: animation.matrixOverlayIntensity,
          speed: animation.matrixOverlaySpeed,
          changeRate: animation.matrixOverlayChangeRate,
          changeRateMax: 100,
          randomness: animation.matrixOverlayRandomness,
          continuous: true,
          salt: 751
        })
      : nextGrid;

  if (animation.type === "fade") {
    return {
      brightnessMultiplier: 1,
      glyphAlphaMultiplier: 1,
      glyphScaleMultiplier: 1,
      grid: withMatrixOverlay(applyFadeIntensity(grid, ascii, glyphMetrics, animation, amount))
    };
  }

  if (animation.type === "matrix") {
    const matrixEffectProgress = getEffectLoopProgress(animation, timeSeconds);
    const matrixCharacterAnimation: AnimationSettings = {
      ...animation,
      characterVariation: 0,
      matrixOverlayEnabled: false,
      matrixTransitionColorEnabled: false
    };

    return {
      brightnessMultiplier: 1,
      glyphAlphaMultiplier: 1,
      glyphScaleMultiplier: 1,
      grid: applyMatrixGlyphs(grid, ascii, matrixCharacterAnimation, matrixEffectProgress, glyphMetrics)
    };
  }

  if (animation.type === "scale") {
    return {
      brightnessMultiplier: 1,
      glyphAlphaMultiplier: 1,
      glyphScaleMultiplier: 1,
      grid: withMatrixOverlay(grid)
    };
  }

  return {
    brightnessMultiplier: 1,
    glyphAlphaMultiplier: 1,
    glyphScaleMultiplier: 1,
    grid: withMatrixOverlay(grid)
  };
};

export const resolveAnimatedProcessingSettings = (
  image: ImageSettings,
  frame: FrameSettings,
  breakup: BreakupSettings,
  animation?: AnimationSettings,
  timeSeconds = 0
): AnimatedProcessingSettings => {
  if (!animation?.enabled) {
    return { image, frame, breakup };
  }

  const amount = animation.type === "scale"
    ? getScaleProgress(animation, timeSeconds)
    : resolveAnimationClock(animation, timeSeconds).pingPong;

  if (animation.type === "scale") {
    const scaleMin = Math.min(animation.scaleMin, animation.scaleMax);
    const scaleMax = Math.max(animation.scaleMin, animation.scaleMax);
    return {
      image,
      frame: {
        ...frame,
        imageScale: scaleMin + amount * (scaleMax - scaleMin)
      },
      breakup
    };
  }

  if (animation.type === "breakup") {
    return {
      image,
      frame,
      breakup: {
        ...breakup,
        amount: amount * 100
      }
    };
  }

  if (animation.type === "spin") {
    const direction = animation.spinDirection === "counterclockwise" ? -1 : 1;
    return {
      image,
      frame: {
        ...frame,
        imageRotation: frame.imageRotation + direction * getSpinRotationProgress(animation, timeSeconds) * 360
      },
      breakup
    };
  }

  if (animation.type === "ambient") {
    const effectProgress = getEffectLoopProgress(animation, timeSeconds);
    const phase = effectProgress * TAU;
    const movementAmount = (animation.intensity / 100) * 9;
    const smoothness = clamp01(animation.strength / 100);
    const wave = Math.sin(phase);
    const companionWave = Math.sin(phase + TAU * (0.25 + smoothness * 0.08));
    const angleRadians = (animation.ambientAngle * Math.PI) / 180;
    let dx = 0;
    let dy = 0;

    if (animation.ambientDirection === "horizontal") {
      dx = wave * movementAmount;
    } else if (animation.ambientDirection === "vertical") {
      dy = wave * movementAmount;
    } else if (animation.ambientDirection === "diagonal") {
      dx = wave * movementAmount * 0.72;
      dy = wave * movementAmount * 0.72;
    } else if (animation.ambientDirection === "angle") {
      dx = Math.cos(angleRadians) * wave * movementAmount;
      dy = Math.sin(angleRadians) * wave * movementAmount;
    } else {
      dx = Math.cos(phase) * movementAmount;
      dy = companionWave * movementAmount;
    }

    return {
      image,
      frame: {
        ...frame,
        imageOffsetX: Math.max(-100, Math.min(100, frame.imageOffsetX + dx)),
        imageOffsetY: Math.max(-100, Math.min(100, frame.imageOffsetY + dy))
      },
      breakup
    };
  }

  return { image, frame, breakup };
};
