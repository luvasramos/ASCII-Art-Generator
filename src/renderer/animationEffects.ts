import { normalizeCharacterSet } from "../ascii/charset";
import type {
  AnimationSettings,
  AsciiSettings,
  BreakupSettings,
  CellRenderData,
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

const scaleCycleCount = (animation: AnimationSettings) =>
  Math.max(1, 1 + Math.floor(clamp01(animation.velocity / 400) * 3.999));

const getScaleProgress = (animation: AnimationSettings, timeSeconds: number) => {
  const clock = resolveAnimationClock(animation, timeSeconds);
  if (animation.scaleMovement === "constant") {
    return linearPingPong(clock.progress * scaleCycleCount(animation));
  }
  return clock.pingPong;
};

export const getPingPongProgress = (animation: AnimationSettings, timeSeconds: number) => {
  return resolveAnimationClock(animation, timeSeconds).pingPong;
};

const getContinuousProgress = (animation: AnimationSettings, timeSeconds: number) =>
  resolveAnimationClock(animation, timeSeconds).progress;

const getSpinProgress = (animation: AnimationSettings, timeSeconds: number) => {
  const speedCycles = 1 + clamp01(animation.velocity / 400) * 3;
  return (resolveAnimationClock(animation, timeSeconds).progress * speedCycles) % 1;
};

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

const matrixSlotCount = ({ changeRate, changeRateMax, continuous }: MatrixGlyphControls) =>
  Math.max(
    continuous ? 8 : 5,
    Math.round((continuous ? 8 : 5) + clamp01(changeRate / Math.max(1, changeRateMax)) * (continuous ? 34 : 42))
  );

const matrixProgress = (progress: number, speed: number) => {
  const cycles = Math.max(1, 1 + Math.floor(clamp01(speed / 400) * 4));
  return (progress * cycles) % 1;
};

const matrixChancePulse = (fraction: number) => Math.sin(clamp01(fraction) * Math.PI);

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
      glyph: nearestGlyph(glyphs, targetDensity)
    };
  });

  return {
    ...grid,
    cells: nextCells
  };
};

const applyScaleVariation = (
  grid: RenderGrid,
  ascii: AsciiSettings,
  glyphMetrics: GlyphMetric[] | undefined,
  animation: AnimationSettings,
  amount: number
): RenderGrid => {
  const variation = clamp01(animation.characterVariation / 100);
  if (variation <= 0) {
    return grid;
  }

  if (ascii.glyphMode === "images") {
    return {
      ...grid,
      cells: grid.cells.map((cell): CellRenderData => {
        const local = variedProgress(cell, amount, animation, 59);
        return {
          ...cell,
          foreground: clamp01(cell.foreground * (0.86 + local * variation * 0.28))
        };
      })
    };
  }

  const glyphs = glyphMetrics?.length ? sortGlyphsByDensity(glyphMetrics) : [];
  if (glyphs.length < 2) {
    return grid;
  }

  const byGlyph = new Map(glyphs.map((glyph) => [glyph.glyph, glyph]));
  return {
    ...grid,
    cells: grid.cells.map((cell): CellRenderData => {
      if (!cell.glyph || cell.glyph === " ") {
        return cell;
      }
      const local = variedProgress(cell, amount, animation, 67);
      const currentDensity = byGlyph.get(cell.glyph)?.density ?? cell.foreground;
      const densityShift = (local - 0.5) * variation * 0.48;
      return {
        ...cell,
        glyph: nearestGlyph(glyphs, clamp01(currentDensity * (1 + densityShift)))
      };
    })
  };
};

const applyMatrixGlyphs = (
  grid: RenderGrid,
  ascii: AsciiSettings,
  animation: AnimationSettings,
  amount: number,
  progress: number,
  controls: MatrixGlyphControls = {
    intensity: animation.strength,
    speed: animation.velocity,
    changeRate: animation.velocity,
    changeRateMax: 400,
    randomness: animation.strength,
    continuous: animation.matrixLoopStyle === "continuous",
    salt: 0
  }
): RenderGrid => {
  const baseChance = clamp01(controls.intensity / 100);
  const randomness = clamp01(controls.randomness / 100);
  const continuous = controls.continuous;
  const localMatrixProgress = matrixProgress(progress, controls.speed);
  const slots = matrixSlotCount(controls);
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

      const cellPhase = hash(cell.x, cell.y, 73 + controls.salt);
      const cellPhaseB = hash(cell.x, cell.y, 89 + controls.salt);
      const localProgress = continuous ? (localMatrixProgress + cellPhase) % 1 : variedProgress(cell, amount, animation, 97 + controls.salt);
      const slot = Math.min(slots - 1, Math.floor(localProgress * slots));
      const fraction = localProgress * slots - slot;
      const secondarySlot = Math.min(
        secondarySlots - 1,
        Math.floor(((localMatrixProgress + cellPhaseB) % 1) * secondarySlots)
      );
      const pulse = matrixChancePulse(fraction);
      const chance = continuous
        ? baseChance * (0.22 + pulse * 0.5 + hash(cell.x, cell.y, slot + 191 + controls.salt) * 0.16)
        : baseChance * localProgress;
      if (hash(cell.x, cell.y, slot + secondarySlot * 13 + controls.salt) > chance) {
        return cell;
      }

      const baseIndex = Math.round(clamp01(cell.foreground) * (glyphCount - 1));
      const maxSpan = Math.max(1, Math.ceil((glyphCount - 1) * (0.08 + randomness * 0.62)));
      const randomOffset = Math.round(
        (hash(cell.x + slot * 17, cell.y + secondarySlot * 31, slot + 17 + controls.salt) * 2 - 1) * maxSpan
      );
      const fallbackOffset =
        randomOffset === 0 && maxSpan > 0
          ? hash(cell.x, cell.y, slot + 211 + controls.salt) > 0.5
            ? 1
            : -1
          : randomOffset;
      const nextIndex = Math.min(glyphCount - 1, Math.max(0, baseIndex + fallbackOffset));
      const nextForeground = glyphCount > 1 ? nextIndex / (glyphCount - 1) : cell.foreground;
      return withMatrixTransition(
        {
          ...cell,
          foreground: nextForeground
        },
        nextIndex !== baseIndex ? matrixTransitionStrength(cell, animation, controls, slot, secondarySlot, fraction) : 0
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

  const nextCells = grid.cells.map((cell): CellRenderData => {
    if (cell.alpha <= 0.01 || cell.foregroundAlpha <= 0) {
      return cell;
    }

    const cellPhase = hash(cell.x, cell.y, 73 + controls.salt);
    const cellPhaseB = hash(cell.x, cell.y, 89 + controls.salt);
    const localProgress = continuous ? (localMatrixProgress + cellPhase) % 1 : variedProgress(cell, amount, animation, 97 + controls.salt);
    const slot = Math.min(slots - 1, Math.floor(localProgress * slots));
    const fraction = localProgress * slots - slot;
    const secondarySlot = Math.min(
      secondarySlots - 1,
      Math.floor(((localMatrixProgress + cellPhaseB) % 1) * secondarySlots)
    );
    const pulse = matrixChancePulse(fraction);
    const chance = continuous
      ? baseChance * (0.24 + pulse * 0.52 + hash(cell.x, cell.y, slot + 191 + controls.salt) * 0.16)
      : baseChance * localProgress;
    if (!cell.glyph || cell.glyph === " " || hash(cell.x, cell.y, slot + secondarySlot * 13 + controls.salt) > chance) {
      return cell;
    }
    const currentIndex = characters.indexOf(cell.glyph);
    const maxSpan = Math.max(1, Math.ceil((characters.length - 1) * (0.1 + randomness * 0.8)));
    const randomOffset = Math.round(
      (hash(cell.x + slot * 17, cell.y + secondarySlot * 31, slot + 17 + controls.salt) * 2 - 1) * maxSpan
    );
    const fallbackIndex = Math.floor(
      hash(cell.x + slot * 23, cell.y + secondarySlot * 29, slot + 331 + controls.salt) * characters.length
    );
    const index =
      currentIndex >= 0
        ? Math.min(characters.length - 1, Math.max(0, currentIndex + randomOffset))
        : fallbackIndex;
    const nextGlyph = characters[index] ?? cell.glyph;
    return withMatrixTransition(
      {
        ...cell,
        glyph: nextGlyph
      },
      nextGlyph !== cell.glyph ? matrixTransitionStrength(cell, animation, controls, slot, secondarySlot, fraction) : 0
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
      ? applyMatrixGlyphs(nextGrid, ascii, animation, amount, progress, {
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
    return {
      brightnessMultiplier: 1,
      glyphAlphaMultiplier: 1,
      glyphScaleMultiplier: 1,
      grid: withMatrixOverlay(applyMatrixGlyphs(grid, ascii, animation, amount, progress))
    };
  }

  if (animation.type === "scale") {
    const scaleAmount = getScaleProgress(animation, timeSeconds);
    return {
      brightnessMultiplier: 1,
      glyphAlphaMultiplier: 1,
      glyphScaleMultiplier: 1,
      grid: withMatrixOverlay(applyScaleVariation(grid, ascii, glyphMetrics, animation, scaleAmount))
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
        imageRotation: frame.imageRotation + direction * getSpinProgress(animation, timeSeconds) * 360
      },
      breakup
    };
  }

  if (animation.type === "ambient") {
    const progress = getContinuousProgress(animation, timeSeconds);
    const cycles = Math.max(1, 1 + Math.floor(clamp01(animation.velocity / 400) * 3));
    const phase = progress * TAU * cycles;
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
