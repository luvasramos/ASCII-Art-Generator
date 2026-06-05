export type BuiltInFont =
  | "IBM Plex Mono"
  | "JetBrains Mono"
  | "Space Mono"
  | "Fira Mono"
  | "VT323";

export type AsciiGlyphMode = "characters" | "images";
export type PaletteMode = "grayscale" | "custom" | "single" | "source";
export type SourceColorMapping = "palette-map" | "source-match";
export type SourceMatchBackground = "foreground-only" | "cell-background";

export type AspectRatioId =
  | "free"
  | "custom"
  | "square"
  | "landscape-4-3"
  | "portrait-3-4"
  | "landscape-16-9"
  | "portrait-9-16"
  | "landscape-5-4"
  | "portrait-4-5"
  | "a3"
  | "a3-landscape";

export type CropMode = "cover" | "contain";
export type ParticleDirectionBias = "none" | "up" | "down" | "left" | "right" | "radial" | "random";
export type StillImageMode = "static" | "animate";
export type AnimationDirection = "horizontal" | "vertical" | "both";
export type AnimationType = "wave" | "fade" | "scale" | "matrix" | "breakup" | "spin" | "ambient";
export type AnimationLoopStyle = "pingpong" | "continuous";
export type AnimationSpinDirection = "clockwise" | "counterclockwise";
export type AnimationScaleMovement = "ease" | "constant";
export type AmbientDirection = "vertical" | "horizontal" | "diagonal" | "circular" | "angle";
export type EchoFadeCurve = "linear" | "smooth" | "exponential";
export type AnimationPreviewResolution = "low" | "medium" | "high" | "full";
export type AnimationPreviewMode = "live" | "rendered";
export type RenderedPreviewStatus = "idle" | "rendering" | "ready" | "playing" | "paused" | "stale" | "error";
export type RenderedPreviewQuality = "fast" | "balanced" | "final";
export type AnimatedExportQuality = "preview" | "standard" | "high" | "master";
export type ToneRangePreview = "shadows" | "midtones" | "highlights";

export interface UploadedFontRecord {
  id: string;
  family: string;
  displayName: string;
  source: string;
  format: "truetype" | "opentype" | "woff";
}

export interface FontSettings {
  family: string;
  size: number;
  weight: number;
  lineHeight: number;
  letterSpacing: number;
  smoothing: boolean;
  antiAlias: boolean;
}

export interface AsciiSettings {
  glyphMode: AsciiGlyphMode;
  characterDensity: number;
  renderResolution: number;
  characterScale: number;
  spacingX: number;
  spacingY: number;
  edgeEmphasis: number;
  luminanceCurve: number;
  glyphOpacity: number;
  backgroundOpacity: number;
  cellSpacing: number;
  randomness: number;
  randomSeed: number;
  charset: string;
  selectedPresetId: string;
  imageGlyphs: ImageGlyphRecord[];
  imageGlyphSourceName: string | null;
}

export interface ImageGlyphRecord {
  id: string;
  name: string;
  dataUrl: string;
  mimeType: "image/png" | "image/svg+xml" | "image/jpeg" | "image/webp";
}

export interface ImageSettings {
  brightness: number;
  contrast: number;
  exposure: number;
  shadows: number;
  shadowsRange: number;
  midtones: number;
  midtonesRange: number;
  highlights: number;
  highlightsRange: number;
  sharpen: number;
  blur: number;
  threshold: number;
  posterization: number;
  blackPoint: number;
  whitePoint: number;
  invertColors: boolean;
  invertTone: boolean;
}

export interface FrameSettings {
  aspectRatio: AspectRatioId;
  cropMode: CropMode;
  customCanvasWidth: number;
  customCanvasHeight: number;
  imageScale: number;
  imageOffsetX: number;
  imageOffsetY: number;
  imageRotation: number;
  dpi: number;
}

export interface BreakupSettings {
  amount: number;
  spread: number;
  density: number;
  chunkSize: number;
  clusterAmount: number;
  erosionAmount: number;
  randomness: number;
  directionBias: ParticleDirectionBias;
  fadeStrength: number;
  seed: number;
}

export interface AnimationSettings {
  enabled: boolean;
  type: AnimationType;
  intensity: number;
  strength: number;
  velocity: number;
  characterVariation: number;
  scaleMin: number;
  scaleMax: number;
  scaleMovement: AnimationScaleMovement;
  matrixLoopStyle: AnimationLoopStyle;
  matrixTransitionColorEnabled: boolean;
  matrixTransitionColor: string;
  matrixTransitionAmount: number;
  spinDirection: AnimationSpinDirection;
  ambientDirection: AmbientDirection;
  ambientAngle: number;
  matrixOverlayEnabled: boolean;
  matrixOverlayIntensity: number;
  matrixOverlaySpeed: number;
  matrixOverlayChangeRate: number;
  matrixOverlayRandomness: number;
  direction: AnimationDirection;
  loopDuration: number;
  fps: number;
  trueFpsPreview: boolean;
  previewFps: number;
  previewResolution: AnimationPreviewResolution;
  echoEnabled: boolean;
  echoCount: number;
  echoOpacity: number;
  echoSpacing: number;
  echoFadeCurve: EchoFadeCurve;
}

export interface RenderedPreviewCachedFramePlaceholder {
  frameIndex: number;
  timestamp: number;
  width: number;
  height: number;
}

export interface RenderedPreviewState {
  mode: AnimationPreviewMode;
  status: RenderedPreviewStatus;
  fps: number;
  frameCount: number;
  currentFrame: number;
  progress: number;
  cacheKey: string | null;
  quality: RenderedPreviewQuality;
  cancelRequestId: string | null;
  error: string | null;
}

export interface ExportOptions {
  transparentBackground: boolean;
  backgroundColor: string;
  alphaThreshold: number;
  videoFps: number;
  animatedExportQuality: AnimatedExportQuality;
}

export type MediaKind = "image" | "video";

export interface LoadedVideoSource {
  name: string;
  url: string;
  element: HTMLVideoElement;
  width: number;
  height: number;
  duration: number;
}

export interface VideoPlaybackState {
  isVideo: boolean;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
}

export interface ColorSettings {
  paletteMode: PaletteMode;
  foregroundColor: string;
  backgroundColor: string;
  duotoneThreshold: number;
  customPalette: string[];
  sourcePaletteOriginal: string[];
  sourcePalette: string[];
  sourcePaletteSize: number;
  sourceColorMapping: SourceColorMapping;
  sourceMatchBackground: SourceMatchBackground;
  foregroundCurve: number;
  backgroundCurve: number;
  tonalCompression: number;
  tonalBands: number;
  shadowCrush: number;
  highlightClip: number;
  invert: boolean;
}

export interface CharacterPreset {
  id: string;
  name: string;
  characters: string;
  builtIn?: boolean;
}

export interface StudioSettingsSnapshot {
  font: FontSettings;
  ascii: AsciiSettings;
  image: ImageSettings;
  frame: FrameSettings;
  breakup: BreakupSettings;
  animation: AnimationSettings;
  color: ColorSettings;
  exportOptions: ExportOptions;
  exportScale: number;
}

export interface SettingsPreset {
  id: string;
  name: string;
  createdAt: number;
  settings: StudioSettingsSnapshot;
}

export interface GlyphMetric {
  glyph: string;
  density: number;
  edgeWeight: number;
  fillRatio: number;
  directionalStructure: number;
}

export interface CellMetrics {
  x: number;
  y: number;
  luminance: number;
  sourceR: number;
  sourceG: number;
  sourceB: number;
  alpha: number;
  coverage: number;
  localContrast: number;
  edgeMagnitude: number;
  variance: number;
  gradientDirection: number;
}

export interface CellRenderData extends CellMetrics {
  glyph: string;
  foreground: number;
  background: number;
  foregroundAlpha: number;
  backgroundAlpha: number;
  isParticle: boolean;
  matrixTransition?: number;
}

export interface RenderGrid {
  cells: CellRenderData[];
  columns: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  gapX: number;
  gapY: number;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  computedAt: number;
}

export interface CellGeometry {
  cellWidth: number;
  cellHeight: number;
  gapX: number;
  gapY: number;
  columns: number;
  rows: number;
}

export interface WorkerRenderOptions {
  columns: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  gapX: number;
  gapY: number;
  image: ImageSettings;
  frame: FrameSettings;
  breakup: BreakupSettings;
  ascii: AsciiSettings;
  color: ColorSettings;
  glyphMetrics: GlyphMetric[];
  toneProfile?: {
    low: number;
    high: number;
  } | null;
}

export interface WorkerRequest {
  id: number;
  imageData: ImageData;
  options: WorkerRenderOptions;
}

export interface WorkerResponse {
  id: number;
  grid: RenderGrid;
}
