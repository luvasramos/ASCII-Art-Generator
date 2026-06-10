import type {
  AsciiSettings,
  AnimationSettings,
  BreakupSettings,
  ColorSettings,
  ExportOptions,
  FontSettings,
  FrameSettings,
  ImageSettings
} from "../renderer/types";
import { defaultCharacterPreset } from "../presets/characterPresets";

export const defaultFontSettings: FontSettings = {
  family: "Chivo Mono",
  size: 13,
  weight: 500,
  lineHeight: 1.08,
  letterSpacing: 0,
  smoothing: true,
  antiAlias: true
};

export const defaultAsciiSettings: AsciiSettings = {
  glyphMode: "characters",
  characterDensity: 0.82,
  renderResolution: 100,
  characterScale: 1,
  spacingX: 1,
  spacingY: 1,
  edgeEmphasis: 0.72,
  luminanceCurve: 0.95,
  glyphOpacity: 0.86,
  backgroundOpacity: 0.92,
  cellSpacing: 0,
  randomness: 0,
  randomSeed: 1337,
  charset: defaultCharacterPreset.characters,
  selectedPresetId: defaultCharacterPreset.id,
  imageGlyphs: [],
  imageGlyphSourceName: null
};

export const defaultImageSettings: ImageSettings = {
  brightness: 0,
  contrast: 1.12,
  exposure: 0,
  shadows: 0,
  shadowsRange: 45,
  midtones: 0,
  midtonesRange: 60,
  highlights: 0,
  highlightsRange: 45,
  sharpen: 0,
  blur: 0,
  threshold: 0,
  posterization: 0,
  blackPoint: 0.02,
  whitePoint: 0.98,
  invertColors: false,
  invertTone: false
};

export const defaultFrameSettings: FrameSettings = {
  aspectRatio: "free",
  cropMode: "cover",
  customCanvasWidth: 1200,
  customCanvasHeight: 900,
  imageScale: 100,
  imageOffsetX: 0,
  imageOffsetY: 0,
  imageRotation: 0,
  dpi: 72
};

export const defaultColorSettings: ColorSettings = {
  paletteMode: "grayscale",
  foregroundColor: "#f3f0e7",
  backgroundColor: "#050608",
  duotoneThreshold: 0.5,
  customPalette: ["#050608", "#9F39FF", "#f3f0e7"],
  hitsOfColor: {
    enabled: false,
    color: "#9F39FF",
    amount: 0,
    seed: 1337,
    animated: false,
    animatedHintAmount: 50
  },
  sourcePaletteOriginal: ["#050608", "#2A3556", "#9F39FF", "#F3F0E7"],
  sourcePalette: ["#050608", "#2A3556", "#9F39FF", "#F3F0E7"],
  sourcePaletteSize: 8,
  sourceColorMapping: "palette-map",
  sourceMatchBackground: "foreground-only",
  foregroundCurve: 0.86,
  backgroundCurve: 1.08,
  tonalCompression: 0.08,
  tonalBands: 0,
  shadowCrush: 0.08,
  highlightClip: 0.04,
  invert: false
};

export const defaultBreakupSettings: BreakupSettings = {
  amount: 0,
  spread: 32,
  density: 54,
  chunkSize: 3,
  clusterAmount: 60,
  erosionAmount: 54,
  randomness: 48,
  directionBias: "none",
  fadeStrength: 58,
  seed: 1337
};

export const defaultAnimationSettings: AnimationSettings = {
  enabled: false,
  type: "wave",
  intensity: 32,
  strength: 46,
  velocity: 80,
  characterVariation: 28,
  scaleMin: 10,
  scaleMax: 100,
  scaleMovement: "ease",
  effectLoopsPerLoop: 1,
  matrixLoopStyle: "pingpong",
  matrixTransitionColorEnabled: false,
  matrixTransitionColor: "#7CFF9B",
  matrixTransitionAmount: 15,
  spinRotationsPerLoop: 1,
  spinDirection: "clockwise",
  ambientDirection: "circular",
  ambientAngle: 45,
  matrixOverlayEnabled: false,
  matrixOverlayIntensity: 45,
  matrixOverlaySpeed: 80,
  matrixOverlayChangeRate: 50,
  matrixOverlayRandomness: 36,
  direction: "both",
  loopDuration: 4,
  fps: 24,
  trueFpsPreview: false,
  previewFps: 24,
  previewResolution: "medium",
  echoEnabled: false,
  echoCount: 4,
  echoOpacity: 50,
  echoSpacing: 25,
  echoFadeCurve: "smooth"
};

export const defaultExportOptions: ExportOptions = {
  transparentBackground: false,
  backgroundColor: "#050608",
  alphaThreshold: 8,
  videoFps: 24,
  animatedExportQuality: "standard"
};

export const defaultExportScale = 1;
