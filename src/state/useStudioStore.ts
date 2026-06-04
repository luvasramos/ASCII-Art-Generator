import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { builtInCharacterPresets } from "../presets/characterPresets";
import { maxImageGlyphs } from "../glyphs/imageGlyphImport";
import {
  defaultAnimationSettings,
  defaultAsciiSettings,
  defaultBreakupSettings,
  defaultColorSettings,
  defaultExportScale,
  defaultExportOptions,
  defaultFontSettings,
  defaultFrameSettings,
  defaultImageSettings
} from "./defaults";
import type {
  AnimationSettings,
  AspectRatioId,
  AsciiSettings,
  BreakupSettings,
  CharacterPreset,
  ColorSettings,
  ExportOptions,
  FontSettings,
  FrameSettings,
  ImageGlyphRecord,
  ImageSettings,
  SettingsPreset,
  StudioSettingsSnapshot,
  UploadedFontRecord
} from "../renderer/types";

interface StudioStore {
  imageName: string;
  imageDataUrl: string | null;
  font: FontSettings;
  ascii: AsciiSettings;
  image: ImageSettings;
  frame: FrameSettings;
  breakup: BreakupSettings;
  animation: AnimationSettings;
  color: ColorSettings;
  exportOptions: ExportOptions;
  exportScale: number;
  presets: CharacterPreset[];
  settingsPresets: SettingsPreset[];
  activeSettingsPresetId: string | null;
  uploadedFonts: UploadedFontRecord[];
  lastNonDuotoneBackgroundOpacity: number;
  undoStack: StudioHistorySnapshot[];
  redoStack: StudioHistorySnapshot[];
  setImage: (imageName: string, imageDataUrl: string | null) => void;
  updateFont: (patch: Partial<FontSettings>) => void;
  updateAscii: (patch: Partial<AsciiSettings>) => void;
  updateImage: (patch: Partial<ImageSettings>) => void;
  updateFrame: (patch: Partial<FrameSettings>) => void;
  updateBreakup: (patch: Partial<BreakupSettings>) => void;
  updateAnimation: (patch: Partial<AnimationSettings>) => void;
  updateColor: (patch: Partial<ColorSettings>) => void;
  updateExportOptions: (patch: Partial<ExportOptions>) => void;
  updateExportScale: (exportScale: number) => void;
  setCharacterPreset: (preset: CharacterPreset) => void;
  saveCharacterPreset: (name: string, characters: string) => void;
  removeCharacterPreset: (id: string) => void;
  saveSettingsPreset: (name: string) => void;
  loadSettingsPreset: (id: string) => void;
  importSettingsPreset: (name: string, settings: Partial<StudioSettingsSnapshot>) => void;
  removeSettingsPreset: (id: string) => void;
  applySettingsSnapshot: (settings: Partial<StudioSettingsSnapshot>) => void;
  addUploadedFont: (font: UploadedFontRecord) => void;
  removeUploadedFont: (id: string) => void;
  undo: () => void;
  redo: () => void;
  resetProcessing: () => void;
}

interface StudioHistorySnapshot extends StudioSettingsSnapshot {
  imageName: string;
  imageDataUrl: string | null;
}

const mergePresets = (custom: CharacterPreset[] = []) => {
  const customOnly = custom.filter((preset) => !preset.builtIn);
  return [...builtInCharacterPresets, ...customOnly];
};

const memoryStorage = new Map<string, string>();

const safeStorage: StateStorage = {
  getItem: (name) => {
    try {
      return window.localStorage.getItem(name);
    } catch {
      return memoryStorage.get(name) ?? null;
    }
  },
  setItem: (name, value) => {
    try {
      window.localStorage.setItem(name, value);
    } catch {
      memoryStorage.set(name, value);
    }
  },
  removeItem: (name) => {
    try {
      window.localStorage.removeItem(name);
    } catch {
      memoryStorage.delete(name);
    }
  }
};

const validAspectRatios: AspectRatioId[] = [
  "free",
  "custom",
  "square",
  "landscape-4-3",
  "portrait-3-4",
  "landscape-16-9",
  "portrait-9-16",
  "landscape-5-4",
  "portrait-4-5",
  "a3",
  "a3-landscape"
];

const normalizeColor = (color?: Partial<ColorSettings> & { paletteMode?: string }): ColorSettings => ({
  ...defaultColorSettings,
  paletteMode: color?.paletteMode === "custom" ? "custom" : color?.paletteMode === "single" ? "single" : "grayscale",
  foregroundColor: color?.foregroundColor ?? defaultColorSettings.foregroundColor,
  backgroundColor: color?.backgroundColor ?? defaultColorSettings.backgroundColor,
  duotoneThreshold: clamp(asNumber(color?.duotoneThreshold, defaultColorSettings.duotoneThreshold), 0, 1),
  customPalette:
    color?.customPalette?.filter((value) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)).slice(0, 12) ??
    defaultColorSettings.customPalette,
  foregroundCurve: color?.foregroundCurve ?? defaultColorSettings.foregroundCurve,
  backgroundCurve: color?.backgroundCurve ?? defaultColorSettings.backgroundCurve,
  tonalCompression: color?.tonalCompression ?? defaultColorSettings.tonalCompression,
  tonalBands: color?.tonalBands ?? defaultColorSettings.tonalBands,
  shadowCrush: color?.shadowCrush ?? defaultColorSettings.shadowCrush,
  highlightClip: color?.highlightClip ?? defaultColorSettings.highlightClip,
  invert: color?.invert ?? defaultColorSettings.invert
});

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const asNumber = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
const asBoolean = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);
const asString = (value: unknown, fallback: string) => (typeof value === "string" && value ? value : fallback);

const imageGlyphDataUrlPattern = /^data:image\/(?:png|svg\+xml|jpeg|webp);/i;

const normalizeImageGlyphs = (glyphs?: unknown): ImageGlyphRecord[] =>
  Array.isArray(glyphs)
    ? glyphs
        .filter((glyph) => {
          const record = glyph as Record<string, unknown>;
          return (
            record &&
            typeof record.id === "string" &&
            typeof record.name === "string" &&
            typeof record.dataUrl === "string" &&
            imageGlyphDataUrlPattern.test(record.dataUrl)
          );
        })
        .slice(0, maxImageGlyphs)
        .map((glyph) => {
          const record = glyph as Record<string, string>;
          const mimeType: ImageGlyphRecord["mimeType"] = record.dataUrl.startsWith("data:image/svg+xml")
            ? "image/svg+xml"
            : record.dataUrl.startsWith("data:image/jpeg")
              ? "image/jpeg"
              : record.dataUrl.startsWith("data:image/webp")
                ? "image/webp"
                : "image/png";
          return {
            id: record.id,
            name: record.name,
            dataUrl: record.dataUrl,
            mimeType
          };
        })
    : [];

const normalizeFont = (font?: Partial<FontSettings>): FontSettings => ({
  family: asString(font?.family, defaultFontSettings.family),
  size: clamp(asNumber(font?.size, defaultFontSettings.size), 7, 32),
  weight: clamp(asNumber(font?.weight, defaultFontSettings.weight), 100, 900),
  lineHeight: clamp(asNumber(font?.lineHeight, defaultFontSettings.lineHeight), 0.72, 1.75),
  letterSpacing: clamp(asNumber(font?.letterSpacing, defaultFontSettings.letterSpacing), -2, 8),
  smoothing: asBoolean(font?.smoothing, defaultFontSettings.smoothing),
  antiAlias: asBoolean(font?.antiAlias, defaultFontSettings.antiAlias)
});

const normalizeAscii = (ascii?: Partial<AsciiSettings>): AsciiSettings => ({
  glyphMode: ascii?.glyphMode === "images" ? "images" : "characters",
  characterDensity: clamp(asNumber(ascii?.characterDensity, defaultAsciiSettings.characterDensity), 0.05, 1.55),
  renderResolution: clamp(asNumber(ascii?.renderResolution, defaultAsciiSettings.renderResolution), 1, 300),
  characterScale: clamp(
    Math.abs(asNumber(ascii?.characterScale, defaultAsciiSettings.characterScale) - 0.94) < 0.0001
      ? defaultAsciiSettings.characterScale
      : asNumber(ascii?.characterScale, defaultAsciiSettings.characterScale),
    0.55,
    1.35
  ),
  spacingX: clamp(asNumber(ascii?.spacingX, defaultAsciiSettings.spacingX), 0.72, 1.8),
  spacingY: clamp(asNumber(ascii?.spacingY, defaultAsciiSettings.spacingY), 0.72, 1.8),
  edgeEmphasis: clamp(asNumber(ascii?.edgeEmphasis, defaultAsciiSettings.edgeEmphasis), 0, 1.6),
  luminanceCurve: clamp(asNumber(ascii?.luminanceCurve, defaultAsciiSettings.luminanceCurve), 0.35, 2.2),
  glyphOpacity: clamp(asNumber(ascii?.glyphOpacity, defaultAsciiSettings.glyphOpacity), 0, 1),
  backgroundOpacity: clamp(asNumber(ascii?.backgroundOpacity, defaultAsciiSettings.backgroundOpacity), 0, 1),
  cellSpacing: clamp(asNumber(ascii?.cellSpacing, defaultAsciiSettings.cellSpacing), 0, 100),
  randomness: clamp(asNumber(ascii?.randomness, defaultAsciiSettings.randomness), 0, 100),
  randomSeed: Math.trunc(asNumber(ascii?.randomSeed, defaultAsciiSettings.randomSeed)),
  charset: asString(ascii?.charset, defaultAsciiSettings.charset),
  selectedPresetId: asString(ascii?.selectedPresetId, defaultAsciiSettings.selectedPresetId),
  imageGlyphs: normalizeImageGlyphs(ascii?.imageGlyphs),
  imageGlyphSourceName:
    typeof ascii?.imageGlyphSourceName === "string" && ascii.imageGlyphSourceName.trim()
      ? ascii.imageGlyphSourceName
      : null
});

const normalizeImage = (image?: Partial<ImageSettings>, legacyToneInvert = defaultImageSettings.invertTone): ImageSettings => ({
  brightness: clamp(asNumber(image?.brightness, defaultImageSettings.brightness), -0.5, 0.5),
  contrast: clamp(asNumber(image?.contrast, defaultImageSettings.contrast), 0.35, 2.4),
  exposure: clamp(asNumber(image?.exposure, defaultImageSettings.exposure), -2, 2),
  shadows: clamp(asNumber(image?.shadows, defaultImageSettings.shadows), -100, 100),
  shadowsRange: clamp(asNumber(image?.shadowsRange, defaultImageSettings.shadowsRange), 0, 100),
  midtones: clamp(asNumber(image?.midtones, defaultImageSettings.midtones), -100, 100),
  midtonesRange: clamp(asNumber(image?.midtonesRange, defaultImageSettings.midtonesRange), 0, 100),
  highlights: clamp(asNumber(image?.highlights, defaultImageSettings.highlights), -100, 100),
  highlightsRange: clamp(asNumber(image?.highlightsRange, defaultImageSettings.highlightsRange), 0, 100),
  sharpen: 0,
  blur: clamp(asNumber(image?.blur, defaultImageSettings.blur), 0, 16),
  threshold: clamp(asNumber(image?.threshold, defaultImageSettings.threshold), 0, 1),
  posterization: clamp(asNumber(image?.posterization, defaultImageSettings.posterization), 0, 9),
  blackPoint: clamp(asNumber(image?.blackPoint, defaultImageSettings.blackPoint), 0, 0.45),
  whitePoint: clamp(asNumber(image?.whitePoint, defaultImageSettings.whitePoint), 0.55, 1),
  invertColors: asBoolean(image?.invertColors, defaultImageSettings.invertColors),
  invertTone: asBoolean(image?.invertTone, legacyToneInvert)
});

const normalizeFrame = (frame?: Partial<FrameSettings> & { aspectRatio?: string; cropMode?: string }): FrameSettings => {
  const imageScale = typeof frame?.imageScale === "number" ? frame.imageScale : defaultFrameSettings.imageScale;
  const imageOffsetX = typeof frame?.imageOffsetX === "number" ? frame.imageOffsetX : defaultFrameSettings.imageOffsetX;
  const imageOffsetY = typeof frame?.imageOffsetY === "number" ? frame.imageOffsetY : defaultFrameSettings.imageOffsetY;
  const imageRotation =
    typeof frame?.imageRotation === "number" ? frame.imageRotation : defaultFrameSettings.imageRotation;
  const dpi = typeof frame?.dpi === "number" ? frame.dpi : defaultFrameSettings.dpi;
  const customCanvasWidth =
    typeof frame?.customCanvasWidth === "number"
      ? frame.customCanvasWidth
      : defaultFrameSettings.customCanvasWidth;
  const customCanvasHeight =
    typeof frame?.customCanvasHeight === "number"
      ? frame.customCanvasHeight
      : defaultFrameSettings.customCanvasHeight;

  return {
    aspectRatio: validAspectRatios.includes(frame?.aspectRatio as AspectRatioId)
      ? (frame?.aspectRatio as AspectRatioId)
      : defaultFrameSettings.aspectRatio,
    cropMode: frame?.cropMode === "contain" ? "contain" : "cover",
    customCanvasWidth: Math.round(clamp(customCanvasWidth, 1, 12000)),
    customCanvasHeight: Math.round(clamp(customCanvasHeight, 1, 12000)),
    imageScale: clamp(imageScale, 10, 150),
    imageOffsetX: clamp(imageOffsetX, -100, 100),
    imageOffsetY: clamp(imageOffsetY, -100, 100),
    imageRotation: clamp(imageRotation, -180, 180),
    dpi: Math.round(clamp(dpi, 1, 2400))
  };
};

const normalizeBreakup = (
  breakup?: Partial<BreakupSettings> & { directionBias?: string }
): BreakupSettings => ({
  amount: clamp(asNumber(breakup?.amount, defaultBreakupSettings.amount), 0, 100),
  spread: clamp(asNumber(breakup?.spread, defaultBreakupSettings.spread), 0, 100),
  density: clamp(asNumber(breakup?.density, defaultBreakupSettings.density), 0, 100),
  chunkSize: clamp(asNumber(breakup?.chunkSize, defaultBreakupSettings.chunkSize), 1, 5),
  clusterAmount: clamp(asNumber(breakup?.clusterAmount, defaultBreakupSettings.clusterAmount), 0, 100),
  erosionAmount: clamp(asNumber(breakup?.erosionAmount, defaultBreakupSettings.erosionAmount), 0, 100),
  randomness: clamp(asNumber(breakup?.randomness, defaultBreakupSettings.randomness), 0, 100),
  directionBias:
    breakup?.directionBias === "up" ||
    breakup?.directionBias === "down" ||
    breakup?.directionBias === "left" ||
    breakup?.directionBias === "right" ||
    breakup?.directionBias === "radial" ||
    breakup?.directionBias === "random"
      ? breakup.directionBias
      : "none",
  fadeStrength: clamp(asNumber(breakup?.fadeStrength, defaultBreakupSettings.fadeStrength), 0, 100),
  seed: Math.trunc(asNumber(breakup?.seed, defaultBreakupSettings.seed))
});

const normalizeAnimation = (
  animation?: Partial<AnimationSettings> & {
    direction?: string;
    scaleMovement?: string;
    matrixLoopStyle?: string;
    spinDirection?: string;
    ambientDirection?: string;
    echoFadeCurve?: string;
  }
): AnimationSettings => {
  const scaleMin = clamp(asNumber(animation?.scaleMin, defaultAnimationSettings.scaleMin), 5, 100);
  const scaleMax = clamp(asNumber(animation?.scaleMax, defaultAnimationSettings.scaleMax), 10, 200);

  return {
    enabled: asBoolean(animation?.enabled, defaultAnimationSettings.enabled),
    type:
      animation?.type === "fade" ||
      animation?.type === "scale" ||
      animation?.type === "matrix" ||
      animation?.type === "breakup" ||
      animation?.type === "spin" ||
      animation?.type === "ambient"
        ? animation.type
        : defaultAnimationSettings.type,
    intensity: clamp(asNumber(animation?.intensity, defaultAnimationSettings.intensity), 0, 100),
    strength: clamp(asNumber(animation?.strength, defaultAnimationSettings.strength), 0, 100),
    velocity: clamp(asNumber(animation?.velocity, defaultAnimationSettings.velocity), 0, 400),
    characterVariation: clamp(asNumber(animation?.characterVariation, defaultAnimationSettings.characterVariation), 0, 100),
    scaleMin,
    scaleMax: Math.max(scaleMin, scaleMax),
    scaleMovement: animation?.scaleMovement === "constant" ? "constant" : "ease",
    matrixLoopStyle: animation?.matrixLoopStyle === "continuous" ? "continuous" : "pingpong",
    spinDirection: animation?.spinDirection === "counterclockwise" ? "counterclockwise" : "clockwise",
    ambientDirection:
      animation?.ambientDirection === "vertical" ||
      animation?.ambientDirection === "horizontal" ||
      animation?.ambientDirection === "diagonal" ||
      animation?.ambientDirection === "circular" ||
      animation?.ambientDirection === "angle"
        ? animation.ambientDirection
        : defaultAnimationSettings.ambientDirection,
    ambientAngle: clamp(asNumber(animation?.ambientAngle, defaultAnimationSettings.ambientAngle), -180, 180),
    matrixOverlayEnabled: asBoolean(
      animation?.matrixOverlayEnabled,
      defaultAnimationSettings.matrixOverlayEnabled
    ),
    matrixOverlayIntensity: clamp(
      asNumber(animation?.matrixOverlayIntensity, defaultAnimationSettings.matrixOverlayIntensity),
      0,
      100
    ),
    matrixOverlaySpeed: clamp(asNumber(animation?.matrixOverlaySpeed, defaultAnimationSettings.matrixOverlaySpeed), 0, 400),
    matrixOverlayChangeRate: clamp(
      asNumber(animation?.matrixOverlayChangeRate, defaultAnimationSettings.matrixOverlayChangeRate),
      0,
      100
    ),
    matrixOverlayRandomness: clamp(
      asNumber(animation?.matrixOverlayRandomness, defaultAnimationSettings.matrixOverlayRandomness),
      0,
      100
    ),
    direction:
      animation?.direction === "horizontal" || animation?.direction === "vertical" || animation?.direction === "both"
        ? animation.direction
        : defaultAnimationSettings.direction,
    loopDuration: clamp(asNumber(animation?.loopDuration, defaultAnimationSettings.loopDuration), 1, 12),
    fps: Math.round(clamp(asNumber(animation?.fps, defaultAnimationSettings.fps), 1, 60)),
    echoEnabled: asBoolean(animation?.echoEnabled, defaultAnimationSettings.echoEnabled),
    echoCount: Math.round(clamp(asNumber(animation?.echoCount, defaultAnimationSettings.echoCount), 0, 20)),
    echoOpacity: clamp(asNumber(animation?.echoOpacity, defaultAnimationSettings.echoOpacity), 0, 100),
    echoSpacing: clamp(asNumber(animation?.echoSpacing, defaultAnimationSettings.echoSpacing), 0, 100),
    echoFadeCurve:
      animation?.echoFadeCurve === "linear" ||
      animation?.echoFadeCurve === "exponential" ||
      animation?.echoFadeCurve === "smooth"
        ? animation.echoFadeCurve
        : defaultAnimationSettings.echoFadeCurve
  };
};

const normalizeExportOptions = (options?: Partial<ExportOptions>): ExportOptions => ({
  transparentBackground: options?.transparentBackground ?? defaultExportOptions.transparentBackground,
  backgroundColor: options?.backgroundColor ?? defaultExportOptions.backgroundColor,
  alphaThreshold: clamp(options?.alphaThreshold ?? defaultExportOptions.alphaThreshold, 0, 100),
  videoFps: Math.round(clamp(asNumber(options?.videoFps, defaultExportOptions.videoFps), 1, 60)),
  animatedExportQuality:
    options?.animatedExportQuality === "small" || options?.animatedExportQuality === "high"
      ? options.animatedExportQuality
      : defaultExportOptions.animatedExportQuality
});

const normalizeExportScale = (exportScale?: number) => clamp(exportScale ?? defaultExportScale, 1, 4);

const enforceDuotoneBackgroundOpacity = (ascii: AsciiSettings, color: ColorSettings): AsciiSettings =>
  color.paletteMode === "single" && ascii.backgroundOpacity !== 0
    ? { ...ascii, backgroundOpacity: 0 }
    : ascii;

const restorableBackgroundOpacity = (value: number) =>
  Number.isFinite(value) ? clamp(value, 0, 1) : defaultAsciiSettings.backgroundOpacity;

const resolveColorTransition = (state: StudioStore, color: ColorSettings) => {
  const enteringDuotone = state.color.paletteMode !== "single" && color.paletteMode === "single";
  const leavingDuotone = state.color.paletteMode === "single" && color.paletteMode !== "single";
  const lastNonDuotoneBackgroundOpacity = enteringDuotone
    ? restorableBackgroundOpacity(state.ascii.backgroundOpacity)
    : state.lastNonDuotoneBackgroundOpacity;

  if (enteringDuotone) {
    return {
      color,
      ascii: { ...state.ascii, backgroundOpacity: 0 },
      lastNonDuotoneBackgroundOpacity
    };
  }

  if (leavingDuotone) {
    return {
      color,
      ascii: { ...state.ascii, backgroundOpacity: restorableBackgroundOpacity(lastNonDuotoneBackgroundOpacity) },
      lastNonDuotoneBackgroundOpacity
    };
  }

  return {
    color,
    ascii: enforceDuotoneBackgroundOpacity(state.ascii, color),
    lastNonDuotoneBackgroundOpacity
  };
};

const createSettingsSnapshot = (state: StudioStore): StudioSettingsSnapshot => {
  const color = normalizeColor(state.color);
  const ascii = enforceDuotoneBackgroundOpacity(normalizeAscii(state.ascii), color);
  return {
    font: normalizeFont(state.font),
    ascii,
    image: normalizeImage(state.image),
    frame: normalizeFrame(state.frame),
    breakup: normalizeBreakup(state.breakup),
    animation: normalizeAnimation(state.animation),
    color,
    exportOptions: normalizeExportOptions(state.exportOptions),
    exportScale: normalizeExportScale(state.exportScale)
  };
};

const createHistorySnapshot = (state: StudioStore): StudioHistorySnapshot => ({
  imageName: state.imageName,
  imageDataUrl: state.imageDataUrl,
  ...createSettingsSnapshot(state)
});

const normalizeSettingsSnapshot = (settings?: Partial<StudioSettingsSnapshot>): StudioSettingsSnapshot => {
  const color = normalizeColor(settings?.color);
  const hasExplicitToneInvert = Boolean(settings?.image && "invertTone" in settings.image);
  const legacyToneInvert = hasExplicitToneInvert ? defaultImageSettings.invertTone : color.invert;
  if (!hasExplicitToneInvert && color.invert) {
    color.invert = false;
  }
  const ascii = enforceDuotoneBackgroundOpacity(normalizeAscii(settings?.ascii), color);
  return {
    font: normalizeFont(settings?.font),
    ascii,
    image: normalizeImage(settings?.image, legacyToneInvert),
    frame: normalizeFrame(settings?.frame),
    breakup: normalizeBreakup(settings?.breakup),
    animation: normalizeAnimation(settings?.animation),
    color,
    exportOptions: normalizeExportOptions(settings?.exportOptions),
    exportScale: normalizeExportScale(settings?.exportScale)
  };
};

const applySnapshotPatch = (settings?: Partial<StudioSettingsSnapshot>) => {
  const normalized = normalizeSettingsSnapshot(settings);
  return {
    font: normalized.font,
    ascii: normalized.ascii,
    image: normalized.image,
    frame: normalized.frame,
    breakup: normalized.breakup,
    animation: normalized.animation,
    color: normalized.color,
    exportOptions: normalized.exportOptions,
    exportScale: normalized.exportScale
  };
};

const applyHistorySnapshot = (snapshot: StudioHistorySnapshot) => ({
  imageName: snapshot.imageName,
  imageDataUrl: snapshot.imageDataUrl,
  ...applySnapshotPatch(snapshot)
});

const withUndo = (state: StudioStore, patch: Partial<StudioStore>): Partial<StudioStore> => ({
  // Store compact snapshots before meaningful changes so controls, presets, and restorable image data can travel together.
  ...patch,
  undoStack: [...state.undoStack, createHistorySnapshot(state)].slice(-80),
  redoStack: []
});

const normalizeSettingsPresets = (presets?: SettingsPreset[]) =>
  (presets ?? [])
    .filter((preset) => preset && typeof preset.id === "string" && typeof preset.name === "string")
    .map((preset) => ({
      id: preset.id,
      name: preset.name,
      createdAt: typeof preset.createdAt === "number" ? preset.createdAt : Date.now(),
      settings: normalizeSettingsSnapshot(preset.settings)
    }));

export const useStudioStore = create<StudioStore>()(
  persist(
    (set, get) => ({
      imageName: "Untitled",
      imageDataUrl: null,
      font: defaultFontSettings,
      ascii: defaultAsciiSettings,
      image: defaultImageSettings,
      frame: defaultFrameSettings,
      breakup: defaultBreakupSettings,
      animation: defaultAnimationSettings,
      color: defaultColorSettings,
      exportOptions: defaultExportOptions,
      exportScale: defaultExportScale,
      presets: builtInCharacterPresets,
      settingsPresets: [],
      activeSettingsPresetId: null,
      uploadedFonts: [],
      lastNonDuotoneBackgroundOpacity: defaultAsciiSettings.backgroundOpacity,
      undoStack: [],
      redoStack: [],
      setImage: (imageName, imageDataUrl) => set((state) => withUndo(state, { imageName, imageDataUrl })),
      updateFont: (patch) => set((state) => withUndo(state, { font: { ...state.font, ...patch } })),
      updateAscii: (patch) =>
        set((state) => {
          const ascii = enforceDuotoneBackgroundOpacity(normalizeAscii({ ...state.ascii, ...patch }), state.color);
          return withUndo(state, {
            ascii,
            lastNonDuotoneBackgroundOpacity:
              state.color.paletteMode !== "single" && "backgroundOpacity" in patch
                ? restorableBackgroundOpacity(ascii.backgroundOpacity)
                : state.lastNonDuotoneBackgroundOpacity
          });
        }),
      updateImage: (patch) => set((state) => withUndo(state, { image: { ...state.image, ...patch } })),
      updateFrame: (patch) => set((state) => withUndo(state, { frame: normalizeFrame({ ...state.frame, ...patch }) })),
      updateBreakup: (patch) => set((state) => withUndo(state, { breakup: { ...state.breakup, ...patch } })),
      updateAnimation: (patch) => set((state) => withUndo(state, { animation: normalizeAnimation({ ...state.animation, ...patch }) })),
      updateColor: (patch) =>
        set((state) => {
          const color = normalizeColor({ ...state.color, ...patch });
          return withUndo(state, resolveColorTransition(state, color));
        }),
      updateExportOptions: (patch) =>
        set((state) => withUndo(state, { exportOptions: { ...state.exportOptions, ...patch } })),
      updateExportScale: (exportScale) => set((state) => withUndo(state, { exportScale: normalizeExportScale(exportScale) })),
      setCharacterPreset: (preset) =>
        set((state) => withUndo(state, {
          ascii: {
            ...state.ascii,
            selectedPresetId: preset.id,
            charset: preset.characters
          }
        })),
      saveCharacterPreset: (name, characters) => {
        const preset: CharacterPreset = {
          id: `custom-${Date.now()}`,
          name,
          characters
        };
        set((state) => ({
          presets: mergePresets([...state.presets, preset]),
          undoStack: [...state.undoStack, createHistorySnapshot(state)].slice(-80),
          redoStack: [],
          ascii: {
            ...state.ascii,
            selectedPresetId: preset.id,
            charset: characters
          }
        }));
      },
      removeCharacterPreset: (id) =>
        set((state) => {
          const preset = state.presets.find((item) => item.id === id);
          if (!preset || preset.builtIn) {
            return state;
          }
          const removedActive = state.ascii.selectedPresetId === id;
          return withUndo(state, {
            presets: mergePresets(state.presets.filter((item) => item.id !== id)),
            ascii: removedActive
              ? {
                  ...state.ascii,
                  selectedPresetId: defaultAsciiSettings.selectedPresetId,
                  charset: defaultAsciiSettings.charset
                }
              : state.ascii
          });
        }),
      saveSettingsPreset: (name) =>
        set((state) => {
          const preset: SettingsPreset = {
            id: `settings-${Date.now()}`,
            name: name.trim(),
            createdAt: Date.now(),
            settings: createSettingsSnapshot(state)
          };
          return {
            settingsPresets: [...state.settingsPresets, preset],
            activeSettingsPresetId: preset.id
          };
        }),
      loadSettingsPreset: (id) =>
        set((state) => {
          const preset = state.settingsPresets.find((item) => item.id === id);
          if (!preset) {
            return state;
          }
          return {
            undoStack: [...state.undoStack, createHistorySnapshot(state)].slice(-80),
            redoStack: [],
            ...applySnapshotPatch(preset.settings),
            activeSettingsPresetId: preset.id
          };
        }),
      importSettingsPreset: (name, settings) =>
        set((state) => {
          const preset: SettingsPreset = {
            id: `settings-${Date.now()}`,
            name: name.trim(),
            createdAt: Date.now(),
            settings: normalizeSettingsSnapshot(settings)
          };
          return {
            undoStack: [...state.undoStack, createHistorySnapshot(state)].slice(-80),
            redoStack: [],
            ...applySnapshotPatch(preset.settings),
            settingsPresets: [...state.settingsPresets, preset],
            activeSettingsPresetId: preset.id
          };
        }),
      removeSettingsPreset: (id) =>
        set((state) => ({
          settingsPresets: state.settingsPresets.filter((preset) => preset.id !== id),
          activeSettingsPresetId: state.activeSettingsPresetId === id ? null : state.activeSettingsPresetId
        })),
      applySettingsSnapshot: (settings) =>
        set((state) => withUndo(state, {
          ...applySnapshotPatch(settings),
          activeSettingsPresetId: null
        })),
      addUploadedFont: (font) =>
        set((state) => withUndo(state, {
          uploadedFonts: [...state.uploadedFonts.filter((item) => item.id !== font.id), font],
          font: { ...state.font, family: font.family }
        })),
      removeUploadedFont: (id) => {
        const fontToRemove = get().uploadedFonts.find((font) => font.id === id);
        set((state) => withUndo(state, {
          uploadedFonts: state.uploadedFonts.filter((font) => font.id !== id),
          font:
            fontToRemove && state.font.family === fontToRemove.family
              ? { ...state.font, family: defaultFontSettings.family }
              : state.font
        }));
      },
      undo: () =>
        set((state) => {
          const previous = state.undoStack[state.undoStack.length - 1];
          if (!previous) {
            return state;
          }
          return {
            ...applyHistorySnapshot(previous),
            undoStack: state.undoStack.slice(0, -1),
            redoStack: [...state.redoStack, createHistorySnapshot(state)].slice(-80),
            activeSettingsPresetId: null
          };
        }),
      redo: () =>
        set((state) => {
          const next = state.redoStack[state.redoStack.length - 1];
          if (!next) {
            return state;
          }
          return {
            ...applyHistorySnapshot(next),
            undoStack: [...state.undoStack, createHistorySnapshot(state)].slice(-80),
            redoStack: state.redoStack.slice(0, -1),
            activeSettingsPresetId: null
          };
        }),
      resetProcessing: () =>
        set((state) => withUndo(state, {
          font: defaultFontSettings,
          ascii: defaultAsciiSettings,
          image: defaultImageSettings,
          frame: defaultFrameSettings,
          breakup: defaultBreakupSettings,
          animation: defaultAnimationSettings,
          color: defaultColorSettings,
          exportOptions: defaultExportOptions,
          exportScale: defaultExportScale,
          lastNonDuotoneBackgroundOpacity: defaultAsciiSettings.backgroundOpacity,
          activeSettingsPresetId: null
        }))
    }),
    {
      name: "ascii-rendering-studio",
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: (state) => ({
        imageName: state.imageName,
        imageDataUrl: state.imageDataUrl,
        font: state.font,
        ascii: state.ascii,
        image: state.image,
        frame: state.frame,
        breakup: state.breakup,
        animation: state.animation,
        color: state.color,
        exportOptions: state.exportOptions,
        exportScale: state.exportScale,
        presets: state.presets,
        settingsPresets: state.settingsPresets,
        activeSettingsPresetId: state.activeSettingsPresetId,
        uploadedFonts: state.uploadedFonts,
        lastNonDuotoneBackgroundOpacity: state.lastNonDuotoneBackgroundOpacity
      }),
      merge: (persisted, current) => {
        const value = persisted as Partial<StudioStore> | undefined;
        const color = normalizeColor(value?.color);
        const hasExplicitToneInvert = Boolean(value?.image && "invertTone" in value.image);
        const legacyToneInvert = hasExplicitToneInvert ? defaultImageSettings.invertTone : color.invert;
        if (!hasExplicitToneInvert && color.invert) {
          color.invert = false;
        }
        const rawAscii = normalizeAscii(value?.ascii);
        const lastNonDuotoneBackgroundOpacity = restorableBackgroundOpacity(
          asNumber(value?.lastNonDuotoneBackgroundOpacity, rawAscii.backgroundOpacity)
        );
        const ascii = enforceDuotoneBackgroundOpacity(rawAscii, color);
        return {
          ...current,
          ...value,
          imageName: "Untitled",
          imageDataUrl: null,
          font: normalizeFont(value?.font),
          ascii,
          image: normalizeImage(value?.image, legacyToneInvert),
          frame: normalizeFrame(value?.frame),
          breakup: normalizeBreakup(value?.breakup),
          animation: normalizeAnimation(value?.animation),
          color,
          lastNonDuotoneBackgroundOpacity,
          exportOptions: normalizeExportOptions(value?.exportOptions),
          exportScale: normalizeExportScale(value?.exportScale),
          presets: mergePresets(value?.presets),
          settingsPresets: normalizeSettingsPresets(value?.settingsPresets),
          activeSettingsPresetId: value?.activeSettingsPresetId ?? null,
          uploadedFonts: value?.uploadedFonts ?? [],
          undoStack: [],
          redoStack: []
        };
      }
    }
  )
);
