import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowDown,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  ArrowUpRight,
  ChevronDown,
  CircleDot,
  Cloud,
  Compass,
  Contrast,
  Crop,
  Download,
  FlipHorizontal,
  FolderOpen,
  Hash,
  Image as ImageIcon,
  Lock,
  Minus,
  Moon,
  Palette,
  Play,
  Plus,
  RotateCcw,
  RotateCw,
  Rotate3D,
  Ruler,
  Save,
  Shuffle,
  Sparkles,
  Sun,
  Trash2,
  Type,
  Unlock,
  Upload
} from "lucide-react";
import { reverseCharacterSet } from "../ascii/charset";
import { downloadBlob } from "../export/download";
import { builtInFonts } from "../fonts/fontRegistry";
import { builtInImageGlyphPresets, loadBuiltInImageGlyphPreset } from "../glyphs/builtInImageGlyphPresets";
import { isZipFile, maxImageGlyphs, readImageGlyphFiles, readImageGlyphZip } from "../glyphs/imageGlyphImport";
import { getAspectRatioPreset } from "../presets/aspectRatios";
import { createSettingsPresetFile, parseSettingsPresetFile, presetFileName } from "../presets/settingsPresets";
import {
  defaultAnimationSettings,
  defaultAsciiSettings,
  defaultBreakupSettings,
  defaultColorSettings,
  defaultFontSettings,
  defaultFrameSettings,
  defaultMaskSettings,
  defaultImageSettings
} from "../state/defaults";
import { useStudioStore } from "../state/useStudioStore";
import type {
  AspectRatioId,
  CharacterPreset,
  ImageGlyphRecord,
  RenderGrid,
  SettingsPreset,
  StillImageMode,
  StudioSettingsSnapshot,
  ToneRangePreview,
  UploadedFontRecord
} from "../renderer/types";
import {
  ColorInput,
  CommandButton,
  IconButton,
  Section,
  Select,
  Slider,
  Toggle,
  VisualEditingPreviewProvider
} from "./controls";
import { evaluateNumberExpression } from "../utils/numberExpression";

interface RightSidebarProps {
  grid: RenderGrid | null;
  onFontFile: (file: File) => void;
  canRefreshSourcePalette: boolean;
  sourcePaletteExtracting: boolean;
  onRefreshSourcePalette: () => void;
  canAnimateImage: boolean;
  isVideoLoaded: boolean;
  stillImageMode: StillImageMode;
  onStillImageModeChange: (mode: StillImageMode) => void;
  onToneRangePreviewChange: (range: ToneRangePreview | null) => void;
  onMaskPreviewStart: () => void;
  onMaskPreviewEnd: () => void;
  onMaskPreviewPulse: () => void;
  onVisualEditPreviewStart: (reason: string) => void;
  onVisualEditPreviewEnd: () => void;
  onVisualEditPreviewPulse: (reason: string) => void;
}

const RatioIcon = ({ width, height, dashed = false }: { width: number | null; height: number | null; dashed?: boolean }) => {
  const style = width && height
    ? ({ aspectRatio: `${width} / ${height}` } as CSSProperties)
    : undefined;

  return (
    <span className="grid h-4 w-5 shrink-0 place-items-center">
      {style ? (
        <span className="block max-h-4 w-full rounded-[3px] border border-current/70" style={style} />
      ) : (
        <span className={`block h-3 w-4 rounded-[3px] border border-current/70 ${dashed ? "border-dashed" : ""}`} />
      )}
    </span>
  );
};

const TonalRangeGroup = ({
  title,
  icon,
  children
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) => (
  <div className="space-y-4 rounded-xl border border-white/[0.06] bg-black/20 p-3">
    <div className="flex items-center gap-2 text-xs font-semibold text-zinc-300">
      <span className="grid h-7 w-7 place-items-center rounded-lg bg-white/[0.045] text-zinc-400">
        {icon}
      </span>
      <span>{title}</span>
    </div>
    <div className="space-y-4">{children}</div>
  </div>
);

const ratioGroups: Array<{
  label: string;
  ids: AspectRatioId[];
  defaultId: AspectRatioId;
  alternateId?: AspectRatioId;
  width: number | null;
  height: number | null;
  dashed?: boolean;
}> = [
  { label: "Free", ids: ["free"], defaultId: "free", width: null, height: null, dashed: true },
  { label: "1:1", ids: ["square"], defaultId: "square", width: 1, height: 1 },
  {
    label: "4:3 / 3:4",
    ids: ["landscape-4-3", "portrait-3-4"],
    defaultId: "landscape-4-3",
    alternateId: "portrait-3-4",
    width: 4,
    height: 3
  },
  {
    label: "16:9 / 9:16",
    ids: ["landscape-16-9", "portrait-9-16"],
    defaultId: "landscape-16-9",
    alternateId: "portrait-9-16",
    width: 16,
    height: 9
  },
  {
    label: "5:4 / 4:5",
    ids: ["landscape-5-4", "portrait-4-5"],
    defaultId: "landscape-5-4",
    alternateId: "portrait-4-5",
    width: 5,
    height: 4
  },
  { label: "A3", ids: ["a3-landscape", "a3"], defaultId: "a3-landscape", alternateId: "a3", width: 420, height: 297 },
  { label: "Custom", ids: ["custom"], defaultId: "custom", width: null, height: null, dashed: true }
];

const parseCharacterPresetFile = (text: string, fileName: string) => {
  const fallbackName = fileName.replace(/\.(json|txt)$/i, "").trim() || "Imported preset";
  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("Character preset JSON must contain an object.");
    }
    const record = parsed as { name?: unknown; characters?: unknown; charset?: unknown };
    const characters = typeof record.characters === "string" ? record.characters : record.charset;
    if (typeof characters !== "string" || !characters.trim()) {
      throw new Error("Character preset is missing characters.");
    }
    return {
      name: typeof record.name === "string" && record.name.trim() ? record.name.trim() : fallbackName,
      characters
    };
  } catch (error) {
    const characters = text.trim();
    if (!characters || fileName.toLowerCase().endsWith(".json")) {
      throw error instanceof Error ? error : new Error("Character preset import failed.");
    }
    return { name: fallbackName, characters };
  }
};

const moveItem = <T,>(items: T[], index: number, direction: -1 | 1) => {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= items.length) {
    return items;
  }
  const next = [...items];
  [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
  return next;
};

const colorPatchFromPalette = (customPalette: string[]) => ({
  customPalette,
  backgroundColor: customPalette[0],
  foregroundColor: customPalette[customPalette.length - 1]
});

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const exposureControlValue = (settings: { exposure: number; brightness: number }) =>
  clamp(settings.exposure + settings.brightness * 2, -2, 2);
const blurSharpnessControlValue = (settings: { blur: number; sharpen: number }) => {
  if (settings.sharpen > 0.0001) {
    return clamp((settings.sharpen / 2.4) * 100, 0, 100);
  }
  return -clamp((settings.blur / 16) * 100, 0, 100);
};
const blurSharpnessPatchFromControl = (value: number) =>
  value < 0
    ? { blur: (Math.abs(clamp(value, -100, 0)) / 100) * 16, sharpen: 0 }
    : { blur: 0, sharpen: (clamp(value, 0, 100) / 100) * 2.4 };
const defaultBlurSharpnessControlValue = blurSharpnessControlValue(defaultImageSettings);
const animationTypeOptions = [
  { value: "spin", label: "360 Spin" },
  { value: "ambient", label: "Ambient" },
  { value: "breakup", label: "Breakup" },
  { value: "fade", label: "Fade in/out" },
  { value: "matrix", label: "Glyph Shuffle" },
  { value: "scale", label: "Scale in" },
  { value: "wave", label: "Wave" }
];
const waveDirectionOptions = [
  { value: "horizontal", label: "Horizontal", icon: <ArrowLeftRight size={14} /> },
  { value: "vertical", label: "Vertical", icon: <ArrowUpDown size={14} /> },
  { value: "both", label: "Both", icon: <CircleDot size={14} /> }
];
const spinDirectionOptions = [
  { value: "clockwise", label: "Clockwise", icon: <RotateCw size={14} /> },
  { value: "counterclockwise", label: "Counterclockwise", icon: <RotateCcw size={14} /> }
];
const ambientDirectionOptions = [
  { value: "vertical", label: "Vertical", icon: <ArrowUpDown size={14} /> },
  { value: "horizontal", label: "Horizontal", icon: <ArrowLeftRight size={14} /> },
  { value: "diagonal", label: "Diagonal", icon: <ArrowUpRight size={14} /> },
  { value: "circular", label: "Circular", icon: <RotateCw size={14} /> },
  { value: "angle", label: "Custom Angle", icon: <Compass size={14} /> }
];
const particleDirectionOptions = [
  { value: "none", label: "None", icon: <Minus size={14} /> },
  { value: "up", label: "Up", icon: <ArrowUp size={14} /> },
  { value: "down", label: "Down", icon: <ArrowDown size={14} /> },
  { value: "left", label: "Left", icon: <ArrowLeft size={14} /> },
  { value: "right", label: "Right", icon: <ArrowRight size={14} /> },
  { value: "radial", label: "Radial", icon: <CircleDot size={14} /> },
  { value: "random", label: "Random", icon: <Shuffle size={14} /> }
];
const clampCanvasDimension = (value: number) => Math.round(clamp(value, 1, 12000));
const aspectValueForId = (id: AspectRatioId) => {
  const preset = getAspectRatioPreset(id);
  return preset.width && preset.height ? preset.width / preset.height : null;
};

export const RightSidebar = ({
  grid,
  onFontFile,
  canAnimateImage,
  isVideoLoaded,
  stillImageMode,
  onStillImageModeChange,
  onToneRangePreviewChange,
  onMaskPreviewStart,
  onMaskPreviewEnd,
  onMaskPreviewPulse,
  onVisualEditPreviewStart,
  onVisualEditPreviewEnd,
  onVisualEditPreviewPulse
}: RightSidebarProps) => {
  const fontInputRef = useRef<HTMLInputElement | null>(null);
  const presetInputRef = useRef<HTMLInputElement | null>(null);
  const characterPresetInputRef = useRef<HTMLInputElement | null>(null);
  const imageGlyphInputRef = useRef<HTMLInputElement | null>(null);
  const imageGlyphFolderInputRef = useRef<HTMLInputElement | null>(null);
  const [presetName, setPresetName] = useState("");
  const [characterPresetMessage, setCharacterPresetMessage] = useState<string | null>(null);
  const [settingsPresetName, setSettingsPresetName] = useState("");
  const [settingsPresetError, setSettingsPresetError] = useState<string | null>(null);
  const [loadingImageGlyphPresetId, setLoadingImageGlyphPresetId] = useState<string | null>(null);
  const [echoOpen, setEchoOpen] = useState(false);
  const {
    font,
    ascii,
    image,
    frame,
    breakup,
    animation,
    mask,
    color,
    exportOptions,
  exportScale,
  presets,
  settingsPresets,
  activeSettingsPresetId,
  uploadedFonts,
    setCharacterPreset,
    saveCharacterPreset,
    removeCharacterPreset,
    saveSettingsPreset,
    loadSettingsPreset,
    importSettingsPreset,
    removeSettingsPreset,
    updateAscii,
    updateFrame,
    updateAnimation,
    updateFont,
    updateImage,
    updateBreakup,
  updateColor,
  updateMask,
  removeUploadedFont,
  resetProcessing
} = useStudioStore();
  useEffect(
    () => () => {
      onToneRangePreviewChange(null);
      onMaskPreviewEnd();
    },
    [onMaskPreviewEnd, onToneRangePreviewChange]
  );

  const fontOptions = useMemo(
    () => [
      ...builtInFonts.map((family) => ({ value: family, label: family })),
      ...uploadedFonts.map((record: UploadedFontRecord) => ({
        value: record.family,
        label: record.displayName
      }))
    ],
    [uploadedFonts]
  );

  const weightOptions = useMemo(
    () =>
      [300, 400, 500, 600, 700, 800].map((weight) => ({
        value: String(weight),
        label: String(weight)
      })),
    []
  );

  const presetOptions = useMemo(
    () => presets.map((preset: CharacterPreset) => ({ value: preset.id, label: preset.name })),
    [presets]
  );

  const settingsPresetOptions = useMemo(
    () =>
      settingsPresets.length
        ? settingsPresets.map((preset: SettingsPreset) => ({ value: preset.id, label: preset.name }))
        : [{ value: "", label: "No saved presets" }],
    [settingsPresets]
  );

  const selectedRatio = getAspectRatioPreset(frame.aspectRatio);
  const sourceCanvasSize = grid
    ? {
        width: Math.max(1, Math.round(grid.sourceWidth)),
        height: Math.max(1, Math.round(grid.sourceHeight))
      }
    : null;
  const displayedCanvasSize =
    frame.aspectRatio === "free" && sourceCanvasSize
      ? sourceCanvasSize
      : {
          width: frame.customCanvasWidth,
          height: frame.customCanvasHeight
        };
  const [customCanvasWidth, setCustomCanvasWidth] = useState(String(frame.customCanvasWidth));
  const [customCanvasHeight, setCustomCanvasHeight] = useState(String(frame.customCanvasHeight));
  const [customCanvasError, setCustomCanvasError] = useState<string | null>(null);
  const [customCanvasRatioLocked, setCustomCanvasRatioLocked] = useState(false);
  const customCanvasRatioRef = useRef(frame.customCanvasWidth / Math.max(1, frame.customCanvasHeight));
  const [dpiDraft, setDpiDraft] = useState(String(frame.dpi));
  const [breakupSeedDraft, setBreakupSeedDraft] = useState(String(breakup.seed));
  const currentSettings: StudioSettingsSnapshot = {
    font,
    ascii,
    image,
    frame,
    breakup,
    animation,
    mask,
    color,
    exportOptions,
    exportScale
  };
  const selectedSettingsPreset = settingsPresets.find((preset) => preset.id === activeSettingsPresetId);
  const matchingCharacterPreset = presets.find((preset) => preset.characters === ascii.charset);
  const characterPresetModified = ascii.glyphMode === "characters" && !matchingCharacterPreset;
  const effectiveCharacterPresetId = matchingCharacterPreset?.id ?? ascii.selectedPresetId;
  const selectedCharacterPreset = presets.find((preset) => preset.id === effectiveCharacterPresetId);
  const characterPresetOptions = useMemo(
    () =>
      effectiveCharacterPresetId === "custom-live"
        ? [{ value: "custom-live", label: "Unsaved changes" }, ...presetOptions]
        : presetOptions,
    [effectiveCharacterPresetId, presetOptions]
  );
  const selectedBuiltInImageGlyphPreset = builtInImageGlyphPresets[0] ?? null;
  const effectiveImageGlyphPresetId =
    builtInImageGlyphPresets.find(
      (preset) => ascii.imageGlyphSourceName === preset.name && ascii.imageGlyphs.length === preset.glyphs.length
    )?.id ?? "";
  const selectedUploadedFont = uploadedFonts.find((record) => record.family === font.family);
  const characterTypeControls = (
    <div className="space-y-3 rounded-xl border border-white/[0.06] bg-black/15 p-3">
      <input
        ref={fontInputRef}
        className="hidden"
        type="file"
        accept=".ttf,.otf,.woff,font/ttf,font/otf,font/woff"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            onFontFile(file);
          }
          event.currentTarget.value = "";
        }}
      />
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">
        <Type size={14} />
        Type
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_6rem_auto] items-end gap-2">
        <div className="min-w-0">
          <Select label="Font" value={font.family} options={fontOptions} onChange={(family) => updateFont({ family })} />
        </div>
        <Select label="Weight" value={String(font.weight)} options={weightOptions} onChange={(weight) => updateFont({ weight: Number(weight) })} />
        <IconButton
          title="Remove uploaded font"
          disabled={!selectedUploadedFont}
          onClick={() => {
            if (selectedUploadedFont) {
              removeUploadedFont(selectedUploadedFont.id);
            }
          }}
        >
          <Trash2 size={15} />
        </IconButton>
      </div>
      <CommandButton variant="secondary" onClick={() => fontInputRef.current?.click()}>
        <Type size={16} />
        Upload font
      </CommandButton>
      <Slider label="Font size" value={font.size} min={7} max={32} step={1} unit="px" resetValue={defaultFontSettings.size} onChange={(size) => updateFont({ size })} />
      <Slider label="Line height" value={font.lineHeight} min={0.72} max={1.75} resetValue={defaultFontSettings.lineHeight} onChange={(lineHeight) => updateFont({ lineHeight })} />
      <Slider label="Character spacing" value={font.letterSpacing} min={-2} max={8} resetValue={defaultFontSettings.letterSpacing} onChange={(letterSpacing) => updateFont({ letterSpacing })} />
    </div>
  );
  const visualEditingPreviewControls = useMemo(
    () => ({
      start: onVisualEditPreviewStart,
      end: onVisualEditPreviewEnd,
      pulse: onVisualEditPreviewPulse
    }),
    [onVisualEditPreviewEnd, onVisualEditPreviewPulse, onVisualEditPreviewStart]
  );
  const animationControlsDisabled = !canAnimateImage || stillImageMode !== "animate" || !animation.enabled;
  const glyphShuffleAvailable = isVideoLoaded || !animationControlsDisabled;
  const glyphShuffleSummary = animation.matrixOverlayEnabled ? "On" : "Off";
  const spinRotationsLabel =
    Number.isInteger(animation.spinRotationsPerLoop)
      ? String(animation.spinRotationsPerLoop)
      : animation.spinRotationsPerLoop.toFixed(2).replace(/\.?0+$/, "");
  const spinDurationLabel =
    Number.isInteger(animation.loopDuration)
      ? String(animation.loopDuration)
      : animation.loopDuration.toFixed(1).replace(/\.?0+$/, "");
  const spinLoopDescription = `${spinRotationsLabel} ${
    Math.abs(animation.spinRotationsPerLoop - 1) < 0.0001 ? "rotation" : "rotations"
  } over ${spinDurationLabel} sec`;
  const animationSummary = isVideoLoaded
    ? "Video timeline"
    : canAnimateImage
    ? animation.enabled
      ? {
          wave: "Wave",
          fade: "Fade",
          scale: "Scale",
          matrix: "Glyph Shuffle",
          breakup: "Breakup",
          spin: "360 Spin",
          ambient: "Ambient"
        }[animation.type]
      : "disabled"
    : "Load a still image";
  const selectedFrameLabel =
    frame.aspectRatio === "custom"
      ? `Custom ${frame.customCanvasWidth} x ${frame.customCanvasHeight}`
      : frame.aspectRatio === "free" && sourceCanvasSize
        ? `Free ${sourceCanvasSize.width} x ${sourceCanvasSize.height}`
        : selectedRatio.label;
  const canvasWidth = grid ? Math.max(1, Math.round(grid.width)) : null;
  const canvasHeight = grid ? Math.max(1, Math.round(grid.height)) : null;
  const physicalWidth = canvasWidth ? canvasWidth / Math.max(1, frame.dpi) : null;
  const physicalHeight = canvasHeight ? canvasHeight / Math.max(1, frame.dpi) : null;
  const activeRatioGroup = ratioGroups.find((group) => group.ids.includes(frame.aspectRatio));
  const ratioOrientation =
    frame.aspectRatio.startsWith("portrait") || frame.aspectRatio === "a3"
      ? "Vertical"
      : frame.aspectRatio.startsWith("landscape") || frame.aspectRatio === "a3-landscape"
        ? "Horizontal"
        : "";
  const maskSummary = mask.enabled && mask.mix > 0 ? `${Math.round(mask.mix)}% cloud reveal` : "Off";
  const updateMaskWithPreview = (patch: Parameters<typeof updateMask>[0]) => {
    onMaskPreviewPulse();
    updateMask(patch);
  };
  const randomizeMaskSeed = () => updateMaskWithPreview({ seed: Math.floor(Math.random() * 2_147_483_647) });
  const hintsOfColorSummary = !color.hitsOfColor.enabled
    ? "Off"
    : color.hitsOfColor.animated
      ? `${Math.round(color.hitsOfColor.animatedHintAmount)}% animated`
      : `${Math.round(color.hitsOfColor.amount)}% static`;
  const hintsAmountValue = color.hitsOfColor.animated
    ? color.hitsOfColor.animatedHintAmount
    : color.hitsOfColor.amount;
  const hintsAmountResetValue = color.hitsOfColor.animated
    ? defaultColorSettings.hitsOfColor.animatedHintAmount
    : defaultColorSettings.hitsOfColor.amount;
  const updateHintsOfColor = (patch: Partial<typeof color.hitsOfColor>) =>
    updateColor({ hitsOfColor: { ...color.hitsOfColor, ...patch } });
  const colorModeLabel =
    color.paletteMode === "single"
      ? "Duotone"
      : color.paletteMode === "custom"
        ? "Custom"
        : color.paletteMode === "source"
          ? "Source Image Colors"
          : "Grayscale";
  const activeCustomPalette = color.customPalette.length
    ? color.customPalette
    : [color.backgroundColor, color.foregroundColor];
  const activeSourcePalette = color.sourcePalette.length
    ? color.sourcePalette
    : defaultColorSettings.sourcePalette;
  const activeSourcePaletteOriginal = color.sourcePaletteOriginal.length
    ? color.sourcePaletteOriginal
    : activeSourcePalette;
  const sourcePaletteResetColor = (index: number) =>
    activeSourcePaletteOriginal[index] ??
    activeSourcePalette[index] ??
    defaultColorSettings.sourcePalette[index % defaultColorSettings.sourcePalette.length];
  const sourcePaletteMatchesOriginal =
    activeSourcePalette.length === activeSourcePaletteOriginal.length &&
    activeSourcePalette.every((paletteColor, index) => paletteColor.toUpperCase() === activeSourcePaletteOriginal[index]?.toUpperCase());
  const colorInvertControl = (
    <div className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-black/20 px-3 py-2">
      <span className="text-xs text-zinc-500">Color invert</span>
      <IconButton
        title="Invert final output colors"
        active={color.invert}
        onClick={() => updateColor({ invert: !color.invert })}
      >
        <Contrast size={16} />
      </IconButton>
    </div>
  );
  const resolveCanvasSizeForAspect = (aspectRatio: AspectRatioId) => {
    const ratio = aspectValueForId(aspectRatio);
    const width = clampCanvasDimension(displayedCanvasSize.width);
    if (!ratio) {
      return {
        customCanvasWidth: width,
        customCanvasHeight: clampCanvasDimension(displayedCanvasSize.height)
      };
    }
    return {
      customCanvasWidth: width,
      customCanvasHeight: clampCanvasDimension(width / ratio)
    };
  };
  const selectRatioGroup = (group: (typeof ratioGroups)[number]) => {
    if (!group.ids.includes(frame.aspectRatio)) {
      if (group.defaultId === "free") {
        updateFrame({ aspectRatio: "free" });
        return;
      }
      updateFrame({
        aspectRatio: group.defaultId,
        ...resolveCanvasSizeForAspect(group.defaultId)
      });
    }
  };
  const toggleRatioOrientation = (group: (typeof ratioGroups)[number]) => {
    if (!group.alternateId) {
      updateFrame({
        aspectRatio: group.defaultId,
        ...resolveCanvasSizeForAspect(group.defaultId)
      });
      return;
    }
    const nextAspectRatio = frame.aspectRatio === group.defaultId ? group.alternateId : group.defaultId;
    updateFrame({
      aspectRatio: nextAspectRatio,
      ...resolveCanvasSizeForAspect(nextAspectRatio)
    });
  };

  useEffect(() => {
    setCustomCanvasWidth(String(displayedCanvasSize.width));
    setCustomCanvasHeight(String(displayedCanvasSize.height));
  }, [displayedCanvasSize.height, displayedCanvasSize.width]);

  useEffect(() => {
    setDpiDraft(String(frame.dpi));
  }, [frame.dpi]);

  useEffect(() => {
    setBreakupSeedDraft(String(breakup.seed));
  }, [breakup.seed]);

  useEffect(() => {
    const folderInput = imageGlyphFolderInputRef.current;
    if (!folderInput) {
      return;
    }
    folderInput.setAttribute("webkitdirectory", "");
    folderInput.setAttribute("directory", "");
  }, []);

  useEffect(() => {
    if (!characterPresetModified && presetName) {
      setPresetName("");
    }
  }, [characterPresetModified, presetName]);

  const applyCustomCanvas = () => {
    let width = Math.round(evaluateNumberExpression(customCanvasWidth) ?? Number.NaN);
    let height = Math.round(evaluateNumberExpression(customCanvasHeight) ?? Number.NaN);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      setCustomCanvasError("Use positive pixel values.");
      return;
    }
    const fixedRatio = frame.aspectRatio !== "custom" && frame.aspectRatio !== "free"
      ? aspectValueForId(frame.aspectRatio)
      : null;
    if (fixedRatio) {
      height = Math.max(1, Math.round(width / fixedRatio));
    }
    const nextAspectRatio = frame.aspectRatio === "free" ? "custom" : frame.aspectRatio;
    updateFrame({
      aspectRatio: nextAspectRatio,
      customCanvasWidth: clampCanvasDimension(width),
      customCanvasHeight: clampCanvasDimension(height)
    });
    setCustomCanvasError(null);
  };

  const toggleCustomCanvasRatioLock = () => {
    const width = clampCanvasDimension(
      Math.round(evaluateNumberExpression(customCanvasWidth) ?? displayedCanvasSize.width)
    );
    const height = clampCanvasDimension(
      Math.round(evaluateNumberExpression(customCanvasHeight) ?? displayedCanvasSize.height)
    );
    if (frame.aspectRatio !== "custom") {
      updateFrame({
        aspectRatio: "custom",
        customCanvasWidth: width,
        customCanvasHeight: height
      });
    }
    setCustomCanvasRatioLocked((locked) => {
      const nextLocked = !locked;
      if (nextLocked) {
        customCanvasRatioRef.current = width / Math.max(1, height);
      }
      return nextLocked;
    });
  };

  const handleCustomCanvasWidthChange = (value: string) => {
    setCustomCanvasWidth(value);
    const fixedRatio = frame.aspectRatio !== "custom" && frame.aspectRatio !== "free"
      ? aspectValueForId(frame.aspectRatio)
      : null;
    if (!fixedRatio && !customCanvasRatioLocked) {
      return;
    }
    const width = evaluateNumberExpression(value);
    if (typeof width === "number" && Number.isFinite(width) && width > 0) {
      const ratio = fixedRatio ?? customCanvasRatioRef.current;
      setCustomCanvasHeight(String(Math.max(1, Math.round(width / Math.max(0.0001, ratio)))));
    }
  };

  const handleCustomCanvasHeightChange = (value: string) => {
    setCustomCanvasHeight(value);
    const fixedRatio = frame.aspectRatio !== "custom" && frame.aspectRatio !== "free"
      ? aspectValueForId(frame.aspectRatio)
      : null;
    if (!fixedRatio && !customCanvasRatioLocked) {
      return;
    }
    const height = evaluateNumberExpression(value);
    if (typeof height === "number" && Number.isFinite(height) && height > 0) {
      const ratio = fixedRatio ?? customCanvasRatioRef.current;
      setCustomCanvasWidth(String(Math.max(1, Math.round(height * ratio))));
    }
  };

  const applyDpiDraft = () => {
    const dpi = Math.round(evaluateNumberExpression(dpiDraft) ?? Number.NaN);
    if (!Number.isFinite(dpi) || dpi <= 0) {
      setDpiDraft(String(frame.dpi));
      return;
    }
    updateFrame({ dpi: Math.min(2400, Math.max(1, dpi)) });
  };

  const applyBreakupSeedDraft = () => {
    const seed = Math.trunc(evaluateNumberExpression(breakupSeedDraft) ?? Number.NaN);
    if (!Number.isFinite(seed)) {
      setBreakupSeedDraft(String(breakup.seed));
      return;
    }
    updateBreakup({ seed });
  };

  const handleImageGlyphFiles = async (files: FileList | null, sourceKind: "files" | "folder" = "files") => {
    const selectedFiles = Array.from(files ?? []);
    if (!selectedFiles.length) {
      return;
    }

    const batchId = Date.now();
    const imageFiles = selectedFiles.filter((file) => !isZipFile(file));
    const zipFiles = selectedFiles.filter(isZipFile);
    if (!imageFiles.length && !zipFiles.length) {
      setCharacterPresetMessage("Use image glyph files or a ZIP archive.");
      return;
    }

    try {
      const imported: ImageGlyphRecord[] = [
        ...(await readImageGlyphFiles(imageFiles, batchId)),
        ...(await zipFiles.reduce<Promise<ImageGlyphRecord[]>>(async (promise, zipFile, index) => {
          const previous = await promise;
          return [...previous, ...(await readImageGlyphZip(zipFile, batchId + index + 1))];
        }, Promise.resolve([])))
      ];

      if (!imported.length) {
        setCharacterPresetMessage("No supported image glyphs were found.");
        return;
      }

      const sourceName =
        zipFiles.length === 1 && imageFiles.length === 0
          ? zipFiles[0].name
          : sourceKind === "folder"
            ? selectedFiles[0]?.webkitRelativePath?.split("/")[0] || "Glyph folder"
            : ascii.imageGlyphSourceName;
      const imageGlyphs = [...ascii.imageGlyphs, ...imported].slice(0, maxImageGlyphs);
      updateAscii({
        glyphMode: "images",
        imageGlyphs,
        imageGlyphSourceName: sourceName
      });
      setCharacterPresetMessage(
        `Imported ${imported.length} image glyph${imported.length === 1 ? "" : "s"}${
          imageGlyphs.length >= maxImageGlyphs ? ` (limited to ${maxImageGlyphs})` : ""
        }`
      );
    } catch (error) {
      setCharacterPresetMessage(error instanceof Error ? error.message : "Image glyph import failed.");
    }
  };

  const handleBuiltInImageGlyphPreset = async (presetId: string) => {
    if (!presetId) {
      return;
    }
    const preset = builtInImageGlyphPresets.find((item) => item.id === presetId);
    if (!preset) {
      return;
    }
    setLoadingImageGlyphPresetId(preset.id);
    setCharacterPresetMessage(`Loading ${preset.name}...`);
    try {
      const imageGlyphs = await loadBuiltInImageGlyphPreset(preset);
      updateAscii({
        glyphMode: "images",
        imageGlyphs,
        imageGlyphSourceName: preset.name
      });
      setCharacterPresetMessage(`Loaded ${preset.name}`);
    } catch (error) {
      setCharacterPresetMessage(error instanceof Error ? error.message : "Built-in image glyph preset failed to load.");
    } finally {
      setLoadingImageGlyphPresetId(null);
    }
  };

  const updateCharacterSet = (charset: string) => {
    const matchingPreset = presets.find((preset) => preset.characters === charset);
    updateAscii({
      charset,
      selectedPresetId: matchingPreset?.id ?? "custom-live"
    });
  };

  return (
    <VisualEditingPreviewProvider value={visualEditingPreviewControls}>
      <motion.aside
        initial={{ opacity: 0, x: 24 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
        className="z-20 flex h-full w-[380px] max-w-[42vw] shrink-0 flex-col border-l border-white/[0.06] bg-panel"
      >
      <div
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-6 pt-5"
        style={{ scrollbarGutter: "stable" }}
      >
        <Section title="Frame" icon={<Crop size={16} />} order={3} summary={selectedFrameLabel} defaultOpen>
          <div className="grid grid-cols-2 gap-2">
            {ratioGroups.map((ratio) => {
              const selected = activeRatioGroup === ratio;
              const isVertical =
                selected && (frame.aspectRatio.startsWith("portrait") || frame.aspectRatio === "a3");
              const iconWidth = selected && isVertical && ratio.alternateId ? ratio.height : ratio.width;
              const iconHeight = selected && isVertical && ratio.alternateId ? ratio.width : ratio.height;
              return (
                <button
                  key={ratio.label}
                  type="button"
                  className={`flex h-10 items-center justify-center gap-1.5 rounded-xl border px-2 text-xs font-semibold transition ${
                    selected
                      ? "border-signal/40 bg-signal/15 text-signal"
                      : "border-white/[0.06] bg-black/20 text-zinc-500 hover:border-white/[0.12] hover:text-zinc-100"
                  }`}
                  title={ratio.alternateId ? "Double click to switch orientation" : undefined}
                  onClick={() => selectRatioGroup(ratio)}
                  onDoubleClick={() => toggleRatioOrientation(ratio)}
                >
                  <RatioIcon width={iconWidth} height={iconHeight} dashed={ratio.dashed} />
                  <span className="truncate">{ratio.label}</span>
                </button>
              );
            })}
          </div>
          {ratioOrientation && activeRatioGroup?.alternateId && (
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="text-zinc-500">Orientation</span>
              <button
                type="button"
                title="Toggle orientation"
                aria-label="Toggle orientation"
                className="flex h-8 items-center gap-2 rounded-lg border border-white/[0.06] bg-black/20 px-2.5 text-[11px] font-medium text-zinc-500 transition hover:border-white/[0.12] hover:text-zinc-100"
                onClick={() => toggleRatioOrientation(activeRatioGroup)}
              >
                <Rotate3D size={14} />
                {ratioOrientation}
              </button>
            </div>
          )}
          <div className="space-y-3 rounded-xl border border-white/[0.06] bg-black/20 p-3">
            <div className="text-xs font-medium text-zinc-400">{selectedFrameLabel}</div>
            <div className="grid grid-cols-[minmax(0,1fr)_2.5rem_minmax(0,1fr)] items-end gap-2">
              <label className="block">
                <span className="mb-2 block text-xs text-zinc-500">Width</span>
                <input
                  className="h-10 w-full rounded-xl border border-white/[0.06] bg-black/25 px-3 text-sm text-zinc-100 outline-none focus:border-signal/45 focus:shadow-focus"
                  inputMode="numeric"
                  value={customCanvasWidth}
                  onChange={(event) => handleCustomCanvasWidthChange(event.target.value)}
                />
              </label>
              <button
                type="button"
                title={
                  frame.aspectRatio === "custom"
                    ? customCanvasRatioLocked
                      ? "Unlock aspect ratio"
                      : "Lock aspect ratio"
                    : "Switch to Custom size"
                }
                aria-label={
                  frame.aspectRatio === "custom"
                    ? customCanvasRatioLocked
                      ? "Unlock aspect ratio"
                      : "Lock aspect ratio"
                    : "Switch to Custom size"
                }
                className={`grid h-10 w-10 place-items-center rounded-xl border transition-colors ${
                  frame.aspectRatio === "custom" && customCanvasRatioLocked
                    ? "border-signal/45 bg-signal/15 text-signal"
                    : "border-white/[0.06] bg-black/20 text-zinc-500 hover:border-white/[0.12] hover:text-zinc-100"
                }`}
                onClick={toggleCustomCanvasRatioLock}
              >
                {frame.aspectRatio === "custom" && customCanvasRatioLocked ? <Lock size={15} /> : <Unlock size={15} />}
              </button>
              <label className="block">
                <span className="mb-2 block text-xs text-zinc-500">Height</span>
                <input
                  className="h-10 w-full rounded-xl border border-white/[0.06] bg-black/25 px-3 text-sm text-zinc-100 outline-none focus:border-signal/45 focus:shadow-focus"
                  inputMode="numeric"
                  value={customCanvasHeight}
                  onChange={(event) => handleCustomCanvasHeightChange(event.target.value)}
                />
              </label>
            </div>
            <CommandButton variant="secondary" onClick={applyCustomCanvas}>
              <Ruler size={16} />
              Apply size
            </CommandButton>
            {customCanvasError && <div className="text-xs text-ember">{customCanvasError}</div>}
          </div>
          <div className="space-y-3 rounded-xl border border-white/[0.06] bg-black/20 p-3">
            <div className="flex items-end gap-2">
              <label className="block min-w-0 flex-1">
                <span className="mb-2 block text-xs font-medium text-zinc-400">DPI</span>
                <input
                  className="h-10 w-full rounded-xl border border-white/[0.06] bg-black/25 px-3 text-sm text-zinc-100 outline-none focus:border-signal/45 focus:shadow-focus"
                  value={dpiDraft}
                  inputMode="decimal"
                  onChange={(event) => setDpiDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      applyDpiDraft();
                    }
                    if (event.key === "Escape") {
                      setDpiDraft(String(frame.dpi));
                      event.currentTarget.blur();
                    }
                  }}
                />
              </label>
              <button
                type="button"
                className="h-10 rounded-xl border border-white/[0.06] bg-black/20 px-3 text-xs font-semibold text-zinc-400 transition-colors hover:border-white/[0.12] hover:text-zinc-100"
                onClick={applyDpiDraft}
              >
                Apply
              </button>
            </div>
            <div className="rounded-xl border border-white/[0.05] bg-black/20 px-3 py-2 text-[11px] leading-5 text-zinc-500">
              <div className="flex items-center justify-between gap-3">
                  <span>Canvas</span>
                  <span className="tabular-nums text-zinc-300">
                    {canvasWidth && canvasHeight ? `${canvasWidth} x ${canvasHeight} px` : "No render"}
                  </span>
                </div>
              <div className="flex items-center justify-between gap-3">
                <span>DPI</span>
                <span className="tabular-nums text-zinc-300">{frame.dpi}</span>
              </div>
              {physicalWidth && physicalHeight && (
                <div className="flex items-center justify-between gap-3">
                  <span>Physical</span>
                  <span className="tabular-nums text-zinc-300">
                    {physicalWidth.toFixed(2)} x {physicalHeight.toFixed(2)} in
                  </span>
                </div>
              )}
            </div>
          </div>
          <Slider label="Image Scale" value={frame.imageScale} min={0} max={300} step={1} unit="%" resetValue={defaultFrameSettings.imageScale} onChange={(imageScale) => updateFrame({ imageScale })} />
          <Slider label="Offset X" value={frame.imageOffsetX} min={-100} max={100} step={1} unit="%" resetValue={defaultFrameSettings.imageOffsetX} onChange={(imageOffsetX) => updateFrame({ imageOffsetX })} />
          <Slider label="Offset Y" value={frame.imageOffsetY} min={-100} max={100} step={1} unit="%" resetValue={defaultFrameSettings.imageOffsetY} onChange={(imageOffsetY) => updateFrame({ imageOffsetY })} />
          <Slider label="Rotation" value={frame.imageRotation} min={-180} max={180} step={1} unit=" deg" resetValue={defaultFrameSettings.imageRotation} onChange={(imageRotation) => updateFrame({ imageRotation })} />
        </Section>

        <Section title="Animate" icon={<Play size={16} />} order={12} summary={animationSummary} simple>
          <Toggle
            label="Enable animation"
            checked={canAnimateImage && stillImageMode === "animate" && animation.enabled}
            disabled={!canAnimateImage}
            onChange={(enabled) => {
              if (enabled) {
                onStillImageModeChange("animate");
              } else {
                updateAnimation({ enabled: false });
                onStillImageModeChange("static");
              }
            }}
          />
          {isVideoLoaded && (
            <p className="rounded-xl border border-white/[0.06] bg-black/20 px-3 py-2 text-[11px] leading-5 text-zinc-500">
              Video uses its own timeline. Glyph Shuffle and Hints of Color still work from their panels.
            </p>
          )}
          <div
            className={`space-y-4 transition-opacity duration-150 ${
              animationControlsDisabled ? "opacity-45" : "opacity-100"
            }`}
            aria-disabled={animationControlsDisabled}
          >
            <Select
              disabled={animationControlsDisabled}
              label="Animation type"
              value={animation.type}
              options={animationTypeOptions}
              onChange={(type) => updateAnimation({ type: type as typeof animation.type })}
            />
            {animation.type === "wave" && (
              <>
                <Slider disabled={animationControlsDisabled} label="Intensity" value={animation.intensity} min={0} max={100} step={1} unit="%" resetValue={defaultAnimationSettings.intensity} onChange={(intensity) => updateAnimation({ intensity })} />
                <Slider disabled={animationControlsDisabled} label="Strength" value={animation.strength} min={0} max={100} step={1} unit="%" resetValue={defaultAnimationSettings.strength} onChange={(strength) => updateAnimation({ strength })} />
                <Select
                  disabled={animationControlsDisabled}
                  label="Direction"
                  value={animation.direction}
                  options={waveDirectionOptions}
                  onChange={(direction) => updateAnimation({ direction: direction as typeof animation.direction })}
                />
                <Slider
                  disabled={animationControlsDisabled}
                  label="Effect loops"
                  value={animation.effectLoopsPerLoop}
                  min={0.1}
                  max={10}
                  step={0.1}
                  resetValue={defaultAnimationSettings.effectLoopsPerLoop}
                  onChange={(effectLoopsPerLoop) => updateAnimation({ effectLoopsPerLoop })}
                />
              </>
            )}
            {animation.type === "fade" && (
              <>
                <Slider disabled={animationControlsDisabled} label="Strength" value={animation.strength} min={0} max={100} step={1} unit="%" resetValue={defaultAnimationSettings.strength} onChange={(strength) => updateAnimation({ strength })} />
                <Slider disabled={animationControlsDisabled} label="Speed" value={animation.velocity} min={0} max={400} step={1} unit="%" resetValue={defaultAnimationSettings.velocity} onChange={(velocity) => updateAnimation({ velocity })} />
                <Slider disabled={animationControlsDisabled} label="Character variation" value={animation.characterVariation} min={0} max={100} step={1} unit="%" resetValue={defaultAnimationSettings.characterVariation} onChange={(characterVariation) => updateAnimation({ characterVariation })} />
              </>
            )}
            {animation.type === "scale" && (
              <>
                <Slider
                  disabled={animationControlsDisabled}
                  label="Minimum scale"
                  value={animation.scaleMin}
                  min={5}
                  max={100}
                  step={1}
                  unit="%"
                  resetValue={defaultAnimationSettings.scaleMin}
                  onChange={(scaleMin) => updateAnimation({ scaleMin, scaleMax: Math.max(animation.scaleMax, scaleMin) })}
                />
                <Slider
                  disabled={animationControlsDisabled}
                  label="Maximum scale"
                  value={animation.scaleMax}
                  min={10}
                  max={200}
                  step={1}
                  unit="%"
                  resetValue={defaultAnimationSettings.scaleMax}
                  onChange={(scaleMax) => updateAnimation({ scaleMax: Math.max(scaleMax, animation.scaleMin) })}
                />
                <Select
                  disabled={animationControlsDisabled}
                  label="Movement style"
                  value={animation.scaleMovement}
                  options={[
                    { value: "ease", label: "Ease / Ping-pong" },
                    { value: "constant", label: "Constant" }
                  ]}
                  onChange={(scaleMovement) => updateAnimation({ scaleMovement: scaleMovement as typeof animation.scaleMovement })}
                />
                <Slider
                  disabled={animationControlsDisabled}
                  label="Effect loops"
                  value={animation.effectLoopsPerLoop}
                  min={0.1}
                  max={10}
                  step={0.1}
                  resetValue={defaultAnimationSettings.effectLoopsPerLoop}
                  onChange={(effectLoopsPerLoop) => updateAnimation({ effectLoopsPerLoop })}
                />
              </>
            )}
            {animation.type === "matrix" && (
              <>
                <Slider disabled={animationControlsDisabled} label="Change speed" value={animation.velocity} min={0} max={400} step={1} unit="%" resetValue={defaultAnimationSettings.velocity} onChange={(velocity) => updateAnimation({ velocity })} />
                <Slider disabled={animationControlsDisabled} label="Change amount" value={animation.strength} min={0} max={100} step={1} unit="%" resetValue={defaultAnimationSettings.strength} onChange={(strength) => updateAnimation({ strength })} />
                <Slider
                  disabled={animationControlsDisabled}
                  label="Effect loops"
                  value={animation.effectLoopsPerLoop}
                  min={0.1}
                  max={10}
                  step={0.1}
                  resetValue={defaultAnimationSettings.effectLoopsPerLoop}
                  onChange={(effectLoopsPerLoop) => updateAnimation({ effectLoopsPerLoop })}
                />
              </>
            )}
            {animation.type === "breakup" && (
              <Slider disabled={animationControlsDisabled} label="Speed" value={animation.velocity} min={0} max={200} step={1} unit="%" resetValue={defaultAnimationSettings.velocity} onChange={(velocity) => updateAnimation({ velocity })} />
            )}
            {animation.type === "spin" && (
              <>
                <Slider
                  disabled={animationControlsDisabled}
                  label="Rotations per loop"
                  value={animation.spinRotationsPerLoop}
                  min={0.05}
                  max={10}
                  step={0.05}
                  resetValue={defaultAnimationSettings.spinRotationsPerLoop}
                  onChange={(spinRotationsPerLoop) => updateAnimation({ spinRotationsPerLoop })}
                />
                <p className="text-[11px] text-white/45">{spinLoopDescription}</p>
                <Select
                  disabled={animationControlsDisabled}
                  label="Rotation direction"
                  value={animation.spinDirection}
                  options={spinDirectionOptions}
                  onChange={(spinDirection) => updateAnimation({ spinDirection: spinDirection as typeof animation.spinDirection })}
                />
              </>
            )}
            {animation.type === "ambient" && (
              <>
                <Select
                  disabled={animationControlsDisabled}
                  label="Direction"
                  value={animation.ambientDirection}
                  options={ambientDirectionOptions}
                  onChange={(ambientDirection) =>
                    updateAnimation({ ambientDirection: ambientDirection as typeof animation.ambientDirection })
                  }
                />
                {animation.ambientDirection === "angle" && (
                  <Slider
                    disabled={animationControlsDisabled}
                    label="Custom Angle"
                    value={animation.ambientAngle}
                    min={-180}
                    max={180}
                    step={1}
                    unit=" deg"
                    resetValue={defaultAnimationSettings.ambientAngle}
                    onChange={(ambientAngle) => updateAnimation({ ambientAngle })}
                  />
                )}
                <Slider
                  disabled={animationControlsDisabled}
                  label="Movement Amount"
                  value={animation.intensity}
                  min={0}
                  max={100}
                  step={1}
                  unit="%"
                  resetValue={defaultAnimationSettings.intensity}
                  onChange={(intensity) => updateAnimation({ intensity })}
                />
                <Slider
                  disabled={animationControlsDisabled}
                  label="Smoothness"
                  value={animation.strength}
                  min={0}
                  max={100}
                  step={1}
                  unit="%"
                  resetValue={defaultAnimationSettings.strength}
                  onChange={(strength) => updateAnimation({ strength })}
                />
                <Slider
                  disabled={animationControlsDisabled}
                  label="Effect loops"
                  value={animation.effectLoopsPerLoop}
                  min={0.1}
                  max={10}
                  step={0.1}
                  resetValue={defaultAnimationSettings.effectLoopsPerLoop}
                  onChange={(effectLoopsPerLoop) => updateAnimation({ effectLoopsPerLoop })}
                />
              </>
            )}
            <Slider disabled={animationControlsDisabled} label="Loop Duration" value={animation.loopDuration} min={1} max={12} step={0.5} unit=" sec" resetValue={defaultAnimationSettings.loopDuration} onChange={(loopDuration) => updateAnimation({ loopDuration })} />
            <Slider disabled={animationControlsDisabled} label="Animation FPS" value={animation.fps} min={1} max={60} step={1} unit=" fps" resetValue={defaultAnimationSettings.fps} onChange={(fps) => updateAnimation({ fps })} />
            <div className="rounded-xl border border-white/[0.06] bg-black/20">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
                onClick={() => setEchoOpen((open) => !open)}
              >
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-zinc-300">Echo</span>
                  <span className="mt-0.5 block text-[11px] text-zinc-500">
                    {animation.echoEnabled ? `${animation.echoCount} frame trail` : "Off"}
                  </span>
                </span>
                <motion.span
                  animate={{ rotate: echoOpen ? 180 : 0 }}
                  transition={{ duration: 0.14, ease: "easeOut" }}
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-zinc-500"
                >
                  <ChevronDown size={15} />
                </motion.span>
              </button>
              {echoOpen && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.12, ease: "easeOut" }}
                  className="space-y-4 px-3 pb-3"
                >
                  <Toggle
                    label="Enable Echo"
                    checked={animation.echoEnabled}
                    disabled={animationControlsDisabled}
                    onChange={(echoEnabled) => updateAnimation({ echoEnabled })}
                  />
                  <div
                    className={`space-y-4 transition-opacity duration-150 ${
                      animation.echoEnabled && !animationControlsDisabled ? "opacity-100" : "opacity-45"
                    }`}
                  >
                    <Slider
                      disabled={animationControlsDisabled || !animation.echoEnabled}
                      label="Echo Count"
                      value={animation.echoCount}
                      min={0}
                      max={20}
                      step={1}
                      resetValue={defaultAnimationSettings.echoCount}
                      onChange={(echoCount) => updateAnimation({ echoCount })}
                    />
                    <Slider
                      disabled={animationControlsDisabled || !animation.echoEnabled}
                      label="Echo Opacity"
                      value={animation.echoOpacity}
                      min={0}
                      max={100}
                      step={1}
                      unit="%"
                      resetValue={defaultAnimationSettings.echoOpacity}
                      onChange={(echoOpacity) => updateAnimation({ echoOpacity })}
                    />
                    <Slider
                      disabled={animationControlsDisabled || !animation.echoEnabled}
                      label="Echo Spacing"
                      value={animation.echoSpacing}
                      min={0}
                      max={100}
                      step={1}
                      unit="%"
                      resetValue={defaultAnimationSettings.echoSpacing}
                      onChange={(echoSpacing) => updateAnimation({ echoSpacing })}
                    />
                    <Select
                      disabled={animationControlsDisabled || !animation.echoEnabled}
                      label="Echo Fade Curve"
                      value={animation.echoFadeCurve}
                      options={[
                        { value: "linear", label: "Linear" },
                        { value: "smooth", label: "Smooth" },
                        { value: "exponential", label: "Exponential" }
                      ]}
                      onChange={(echoFadeCurve) => updateAnimation({ echoFadeCurve: echoFadeCurve as typeof animation.echoFadeCurve })}
                    />
                  </div>
                </motion.div>
              )}
            </div>
          </div>
        </Section>

        <Section title="Tone" icon={<ImageIcon size={16} />} order={5}>
          <div className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-black/20 px-3 py-2">
            <span className="text-xs text-zinc-500">Tonal map</span>
            <IconButton
              title="Invert source colors before tonal and glyph sampling"
              active={image.invertTone}
              onClick={() => updateImage({ invertTone: !image.invertTone })}
            >
              <Contrast size={16} />
            </IconButton>
          </div>
          <Slider
            label="Exposure"
            value={exposureControlValue(image)}
            min={-2}
            max={2}
            resetValue={exposureControlValue(defaultImageSettings)}
            onChange={(exposure) => updateImage({ exposure, brightness: defaultImageSettings.brightness })}
          />
          <Slider label="Contrast" value={image.contrast} min={0.35} max={2.4} resetValue={defaultImageSettings.contrast} onChange={(contrast) => updateImage({ contrast })} />
          <Slider
            label="Saturation"
            value={image.saturation}
            min={-100}
            max={100}
            step={1}
            unit="%"
            resetValue={defaultImageSettings.saturation}
            onChange={(saturation) => updateImage({ saturation })}
          />
          <Slider
            label="Hue"
            value={image.hue}
            min={-180}
            max={180}
            step={1}
            unit=" deg"
            resetValue={defaultImageSettings.hue}
            onChange={(hue) => updateImage({ hue })}
          />
          <TonalRangeGroup title="Shadows" icon={<Moon size={15} />}>
            <Slider
              label="Strength"
              value={image.shadows}
              min={-100}
              max={100}
              step={1}
              unit="%"
              resetValue={defaultImageSettings.shadows}
              onChange={(shadows) => updateImage({ shadows })}
            />
            <Slider
              label="Range"
              value={image.shadowsRange}
              min={0}
              max={100}
              step={1}
              unit="%"
              resetValue={defaultImageSettings.shadowsRange}
              onInteractionStart={() => onToneRangePreviewChange("shadows")}
              onInteractionEnd={() => onToneRangePreviewChange(null)}
              onChange={(shadowsRange) => updateImage({ shadowsRange })}
            />
          </TonalRangeGroup>
          <TonalRangeGroup title="Midtones" icon={<CircleDot size={15} />}>
            <Slider
              label="Strength"
              value={image.midtones}
              min={-100}
              max={100}
              step={1}
              unit="%"
              resetValue={defaultImageSettings.midtones}
              onChange={(midtones) => updateImage({ midtones })}
            />
            <Slider
              label="Range"
              value={image.midtonesRange}
              min={0}
              max={100}
              step={1}
              unit="%"
              resetValue={defaultImageSettings.midtonesRange}
              onInteractionStart={() => onToneRangePreviewChange("midtones")}
              onInteractionEnd={() => onToneRangePreviewChange(null)}
              onChange={(midtonesRange) => updateImage({ midtonesRange })}
            />
          </TonalRangeGroup>
          <TonalRangeGroup title="Highlights" icon={<Sun size={15} />}>
            <Slider
              label="Strength"
              value={image.highlights}
              min={-100}
              max={100}
              step={1}
              unit="%"
              resetValue={defaultImageSettings.highlights}
              onChange={(highlights) => updateImage({ highlights })}
            />
            <Slider
              label="Range"
              value={image.highlightsRange}
              min={0}
              max={100}
              step={1}
              unit="%"
              resetValue={defaultImageSettings.highlightsRange}
              onInteractionStart={() => onToneRangePreviewChange("highlights")}
              onInteractionEnd={() => onToneRangePreviewChange(null)}
              onChange={(highlightsRange) => updateImage({ highlightsRange })}
            />
          </TonalRangeGroup>
          <Slider
            label="Blur / Sharpness"
            value={blurSharpnessControlValue(image)}
            min={-100}
            max={100}
            step={1}
            unit="%"
            resetValue={defaultBlurSharpnessControlValue}
            onChange={(value) => updateImage(blurSharpnessPatchFromControl(value))}
          />
        </Section>

        <Section title="ASCII" icon={<Hash size={16} />} order={6}>
          <input
            ref={characterPresetInputRef}
            className="hidden"
            type="file"
            accept="application/json,text/plain,.json,.txt"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.currentTarget.value = "";
              if (!file) {
                return;
              }
              try {
                const preset = parseCharacterPresetFile(await file.text(), file.name);
                saveCharacterPreset(preset.name, preset.characters);
                setPresetName("");
                setCharacterPresetMessage(`Imported ${preset.name}`);
              } catch (error) {
                setCharacterPresetMessage(error instanceof Error ? error.message : "Character preset import failed.");
              }
            }}
          />
          <input
            ref={imageGlyphInputRef}
            className="hidden"
            type="file"
            accept="image/png,image/svg+xml,image/jpeg,image/webp,application/zip,.png,.svg,.jpg,.jpeg,.webp,.zip"
            multiple
            onChange={async (event) => {
              await handleImageGlyphFiles(event.target.files, "files");
              event.currentTarget.value = "";
            }}
          />
          <input
            ref={imageGlyphFolderInputRef}
            className="hidden"
            type="file"
            accept="image/png,image/svg+xml,image/jpeg,image/webp,.png,.svg,.jpg,.jpeg,.webp"
            multiple
            onChange={async (event) => {
              await handleImageGlyphFiles(event.target.files, "folder");
              event.currentTarget.value = "";
            }}
          />
          <Select
            label="Glyph mode"
            value={ascii.glyphMode}
            options={[
              { value: "characters", label: "Characters" },
              { value: "images", label: "Image glyphs" }
            ]}
            onChange={(glyphMode) => updateAscii({ glyphMode: glyphMode as typeof ascii.glyphMode })}
          />
          <Slider
            label="Render Resolution"
            value={ascii.renderResolution}
            min={1}
            max={300}
            step={1}
            unit="%"
            resetValue={defaultAsciiSettings.renderResolution}
            onChange={(renderResolution) => updateAscii({ renderResolution })}
          />
          <Slider
            label="Glyph Scale"
            value={Math.round(ascii.characterScale * 100)}
            min={25}
            max={200}
            step={1}
            unit="%"
            resetValue={defaultAsciiSettings.characterScale * 100}
            onChange={(glyphScale) => updateAscii({ characterScale: glyphScale / 100 })}
          />
          {ascii.glyphMode === "images" && (
            <>
              {selectedBuiltInImageGlyphPreset && (
                <div className="rounded-xl border border-white/[0.06] bg-black/15 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs text-zinc-500">Built-in image glyph preset</div>
                      <div className="mt-1 truncate text-sm font-medium text-zinc-200">
                        {selectedBuiltInImageGlyphPreset.name}
                      </div>
                    </div>
                    <CommandButton
                      variant="secondary"
                      disabled={Boolean(loadingImageGlyphPresetId)}
                      onClick={() => {
                        void handleBuiltInImageGlyphPreset(selectedBuiltInImageGlyphPreset.id);
                      }}
                    >
                      {loadingImageGlyphPresetId === selectedBuiltInImageGlyphPreset.id
                        ? "Loading..."
                        : effectiveImageGlyphPresetId === selectedBuiltInImageGlyphPreset.id
                          ? "Reload"
                          : "Load"}
                    </CommandButton>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <CommandButton
                  variant="secondary"
                  disabled={ascii.imageGlyphs.length >= maxImageGlyphs}
                  onClick={() => imageGlyphInputRef.current?.click()}
                >
                  <ImageIcon size={16} />
                  Add Files
                </CommandButton>
                <CommandButton
                  variant="secondary"
                  disabled={ascii.imageGlyphs.length >= maxImageGlyphs}
                  onClick={() => imageGlyphFolderInputRef.current?.click()}
                >
                  <FolderOpen size={16} />
                  Add folder
                </CommandButton>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className="flex h-9 items-center justify-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.045] px-3 text-xs font-semibold text-zinc-300 transition-colors hover:border-white/[0.12] hover:bg-white/[0.075] hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={ascii.imageGlyphs.length < 2}
                  onClick={() => {
                    updateAscii({ imageGlyphs: [...ascii.imageGlyphs].reverse() });
                    setCharacterPresetMessage("Reversed image glyph order");
                  }}
                >
                  <FlipHorizontal size={14} />
                  Reverse
                </button>
                <button
                  type="button"
                  className="flex h-9 items-center justify-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.045] px-3 text-xs font-semibold text-zinc-300 transition-colors hover:border-white/[0.12] hover:bg-white/[0.075] hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={!ascii.imageGlyphs.length}
                  onClick={() => {
                    updateAscii({ imageGlyphs: [], imageGlyphSourceName: null });
                    setCharacterPresetMessage("Cleared image glyphs");
                  }}
                >
                  <Trash2 size={14} />
                  Clear all
                </button>
              </div>
            </>
          )}
          {ascii.glyphMode === "characters" ? (
            <>
              {characterTypeControls}
              <div className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <Select
                    label="Character preset"
                    value={effectiveCharacterPresetId}
                    options={characterPresetOptions}
                    onChange={(id) => {
                      if (id === "custom-live") {
                        return;
                      }
                      const preset = presets.find((item) => item.id === id);
                      if (preset) {
                        setCharacterPreset(preset);
                        setPresetName("");
                        setCharacterPresetMessage(`Loaded ${preset.name}`);
                      }
                    }}
                  />
                </div>
                <div className="flex shrink-0 gap-1">
                  <IconButton
                    title="Remove character preset"
                    disabled={!selectedCharacterPreset || selectedCharacterPreset.builtIn}
                    onClick={() => {
                      if (!selectedCharacterPreset || selectedCharacterPreset.builtIn) {
                        return;
                      }
                      removeCharacterPreset(selectedCharacterPreset.id);
                      setCharacterPresetMessage(`Removed ${selectedCharacterPreset.name}`);
                    }}
                  >
                    <Trash2 size={15} />
                  </IconButton>
                  <IconButton title="Reverse character order" onClick={() => updateCharacterSet(reverseCharacterSet(ascii.charset))}>
                    <FlipHorizontal size={16} />
                  </IconButton>
                  <IconButton title="Import character preset" onClick={() => characterPresetInputRef.current?.click()}>
                    <Upload size={16} />
                  </IconButton>
                </div>
              </div>
              <textarea
                className="min-h-28 w-full resize-y rounded-xl border border-white/[0.06] bg-black/25 p-3 font-mono text-sm leading-relaxed text-zinc-100 outline-none transition focus:border-signal/45 focus:shadow-focus"
                value={ascii.charset}
                spellCheck={false}
                onChange={(event) => updateCharacterSet(event.target.value)}
              />
              <div className="flex gap-2">
                <input
                  className="h-10 min-w-0 flex-1 rounded-xl border border-white/[0.06] bg-black/25 px-3 text-sm text-zinc-100 outline-none transition focus:border-signal/45 focus:shadow-focus disabled:cursor-not-allowed disabled:opacity-45"
                  placeholder={characterPresetModified ? "Preset name" : "Modify characters to save"}
                  disabled={!characterPresetModified}
                  value={presetName}
                  onChange={(event) => setPresetName(event.target.value)}
                />
                <IconButton
                  title="Save character preset"
                  disabled={!characterPresetModified || !presetName.trim()}
                  onClick={() => {
                    saveCharacterPreset(presetName.trim(), ascii.charset);
                    setCharacterPresetMessage(`Saved ${presetName.trim()}`);
                    setPresetName("");
                  }}
                >
                  <Save size={16} />
                </IconButton>
              </div>
            </>
          ) : (
            <div className="space-y-3">
              {ascii.imageGlyphs.length > 0 && (
                <div className="rounded-xl border border-white/[0.06] bg-black/20 px-3 py-2 text-xs text-zinc-500">
                  <div className="flex items-center justify-between gap-3">
                    <span>Imported glyphs</span>
                    <span className="tabular-nums text-zinc-300">{ascii.imageGlyphs.length}</span>
                  </div>
                  {ascii.imageGlyphSourceName && (
                    <div className="mt-1 truncate">Loaded source: {ascii.imageGlyphSourceName}</div>
                  )}
                </div>
              )}
              <div className="space-y-2">
                {ascii.imageGlyphs.map((glyph, index, glyphs) => (
                  <div key={glyph.id} className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-black/20 p-2">
                    <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-lg border border-white/[0.08] bg-white/[0.035]">
                      <img src={glyph.dataUrl} alt="" className="max-h-full max-w-full object-contain" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-zinc-200">
                        {index === 0 ? "Low" : index === glyphs.length - 1 ? "High" : `Mid ${index}`}
                      </div>
                      <div className="truncate text-[11px] text-zinc-500">{glyph.name}</div>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <IconButton
                        title="Move image glyph up"
                        disabled={index === 0}
                        onClick={() => updateAscii({ imageGlyphs: moveItem(ascii.imageGlyphs, index, -1) })}
                      >
                        <ArrowUp size={14} />
                      </IconButton>
                      <IconButton
                        title="Move image glyph down"
                        disabled={index === glyphs.length - 1}
                        onClick={() => updateAscii({ imageGlyphs: moveItem(ascii.imageGlyphs, index, 1) })}
                      >
                        <ArrowDown size={14} />
                      </IconButton>
                    </div>
                    <IconButton
                      title="Remove image glyph"
                      onClick={() => {
                        const imageGlyphs = ascii.imageGlyphs.filter((item) => item.id !== glyph.id);
                        updateAscii({
                          imageGlyphs,
                          imageGlyphSourceName: imageGlyphs.length ? ascii.imageGlyphSourceName : null
                        });
                        setCharacterPresetMessage(`Removed ${glyph.name}`);
                      }}
                    >
                      <Trash2 size={15} />
                    </IconButton>
                  </div>
                ))}
              </div>
              {ascii.imageGlyphs.length < 2 && (
                <div className="rounded-xl border border-white/[0.06] bg-black/20 px-3 py-2 text-xs leading-5 text-zinc-400">
                  Add at least two image glyphs so brightness can map from low to high.
                </div>
              )}
            </div>
          )}
          {characterPresetMessage && (
            <div className="rounded-xl border border-white/[0.06] bg-black/20 px-3 py-2 text-xs text-zinc-400">
              {characterPresetMessage}
            </div>
          )}
          <Slider
            label="Cell spacing"
            value={ascii.cellSpacing}
            min={0}
            max={100}
            step={1}
            unit="%"
            resetValue={defaultAsciiSettings.cellSpacing}
            onChange={(cellSpacing) => updateAscii({ cellSpacing })}
          />
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <Slider
                label="Randomness"
                value={ascii.randomness}
                min={0}
                max={100}
                step={1}
                unit="%"
                resetValue={defaultAsciiSettings.randomness}
                onChange={(randomness) => updateAscii({ randomness })}
              />
            </div>
            <IconButton
              title="Regenerate randomness seed"
              disabled={ascii.randomness <= 0}
              onClick={() => updateAscii({ randomSeed: Math.floor(Math.random() * 1_000_000_000) })}
            >
              <Shuffle size={15} />
            </IconButton>
          </div>
          <Slider label="Glyph opacity" value={ascii.glyphOpacity} min={0} max={1} resetValue={defaultAsciiSettings.glyphOpacity} onChange={(glyphOpacity) => updateAscii({ glyphOpacity })} />
          <Slider
            label="Background opacity"
            value={ascii.backgroundOpacity}
            min={0}
            max={1}
            disabled={color.paletteMode === "single"}
            resetValue={defaultAsciiSettings.backgroundOpacity}
            onChange={(backgroundOpacity) => updateAscii({ backgroundOpacity })}
          />
        </Section>

        <Section title="Mask" icon={<Cloud size={16} />} order={7} summary={maskSummary}>
          <div className="space-y-4">
            <p className="rounded-xl border border-white/[0.06] bg-black/20 px-3 py-2 text-xs leading-5 text-zinc-400">
              Use a soft cloud mask to reveal the original image through the ASCII render.
            </p>
            <Toggle
              label="Enable Mask"
              checked={mask.enabled}
              onChange={(enabled) => updateMaskWithPreview({ enabled })}
            />
            <div className={`space-y-4 ${mask.enabled ? "opacity-100" : "opacity-45"}`}>
              <Slider
                disabled={!mask.enabled}
                label="Mix"
                value={mask.mix}
                min={0}
                max={100}
                step={1}
                unit="%"
                resetValue={defaultMaskSettings.mix}
                onInteractionStart={onMaskPreviewStart}
                onInteractionEnd={onMaskPreviewEnd}
                onChange={(mix) => updateMaskWithPreview({ mix })}
              />
              <Slider
                disabled={!mask.enabled}
                label="Cloud Size"
                value={mask.cloudSize}
                min={1}
                max={100}
                step={1}
                resetValue={defaultMaskSettings.cloudSize}
                onInteractionStart={onMaskPreviewStart}
                onInteractionEnd={onMaskPreviewEnd}
                onChange={(cloudSize) => updateMaskWithPreview({ cloudSize })}
              />
              <Slider
                disabled={!mask.enabled}
                label="Softness"
                value={mask.softness}
                min={0}
                max={100}
                step={1}
                unit="%"
                resetValue={defaultMaskSettings.softness}
                onInteractionStart={onMaskPreviewStart}
                onInteractionEnd={onMaskPreviewEnd}
                onChange={(softness) => updateMaskWithPreview({ softness })}
              />
              <Toggle
                disabled={!mask.enabled}
                label="Invert"
                checked={mask.invert}
                onChange={(invert) => updateMaskWithPreview({ invert })}
              />
              <CommandButton
                variant="secondary"
                disabled={!mask.enabled}
                onClick={randomizeMaskSeed}
              >
                <Shuffle size={16} />
                New Pattern
              </CommandButton>
            </div>
          </div>
        </Section>

        <Section title="Glyph Shuffle" icon={<Shuffle size={16} />} order={8} summary={glyphShuffleSummary}>
          <div className="space-y-4">
            <Toggle
              label="Enable Glyph Shuffle"
              checked={animation.matrixOverlayEnabled}
              disabled={!glyphShuffleAvailable}
              onChange={(matrixOverlayEnabled) => updateAnimation({ matrixOverlayEnabled })}
            />
            {isVideoLoaded && (
              <p className="text-[11px] leading-5 text-zinc-500">
                Uses the current video time while playing, paused, or scrubbing.
              </p>
            )}
            <div
              className={`space-y-4 transition-opacity duration-150 ${
                animation.matrixOverlayEnabled && glyphShuffleAvailable ? "opacity-100" : "opacity-45"
              }`}
            >
              <Slider
                disabled={!glyphShuffleAvailable || !animation.matrixOverlayEnabled}
                label="Shuffle Intensity"
                value={animation.matrixOverlayIntensity}
                min={0}
                max={100}
                step={1}
                unit="%"
                resetValue={defaultAnimationSettings.matrixOverlayIntensity}
                onChange={(matrixOverlayIntensity) => updateAnimation({ matrixOverlayIntensity })}
              />
              <Slider
                disabled={!glyphShuffleAvailable || !animation.matrixOverlayEnabled}
                label="Shuffle Speed"
                value={animation.matrixOverlaySpeed}
                min={0}
                max={400}
                step={1}
                unit="%"
                resetValue={defaultAnimationSettings.matrixOverlaySpeed}
                onChange={(matrixOverlaySpeed) => updateAnimation({ matrixOverlaySpeed })}
              />
              <Slider
                disabled={!glyphShuffleAvailable || !animation.matrixOverlayEnabled}
                label="Change Rate"
                value={animation.matrixOverlayChangeRate}
                min={0}
                max={100}
                step={1}
                unit="%"
                resetValue={defaultAnimationSettings.matrixOverlayChangeRate}
                onChange={(matrixOverlayChangeRate) => updateAnimation({ matrixOverlayChangeRate })}
              />
              <Slider
                disabled={!glyphShuffleAvailable || !animation.matrixOverlayEnabled}
                label="Randomness"
                value={animation.matrixOverlayRandomness}
                min={0}
                max={100}
                step={1}
                unit="%"
                resetValue={defaultAnimationSettings.matrixOverlayRandomness}
                onChange={(matrixOverlayRandomness) => updateAnimation({ matrixOverlayRandomness })}
              />
            </div>
          </div>
        </Section>

        <Section title="Hints of Color" icon={<Sparkles size={16} />} order={9} summary={hintsOfColorSummary}>
          <div className="space-y-4">
            <Toggle
              label="Enable Hints"
              checked={color.hitsOfColor.enabled}
              onChange={(enabled) =>
                updateHintsOfColor({
                  enabled,
                  animated: enabled ? color.hitsOfColor.animated : false
                })
              }
            />
            {isVideoLoaded && (
              <p className="text-[11px] leading-5 text-zinc-500">
                Static hints stay fixed; animated hints follow the current video time.
              </p>
            )}
            <div className={`space-y-4 transition-opacity duration-150 ${color.hitsOfColor.enabled ? "opacity-100" : "opacity-45"}`}>
              <ColorInput
                label="Hint Color"
                disabled={!color.hitsOfColor.enabled}
                value={color.hitsOfColor.color}
                onChange={(hintColor) => updateHintsOfColor({ color: hintColor })}
              />
              <Slider
                label="Amount"
                disabled={!color.hitsOfColor.enabled}
                value={hintsAmountValue}
                min={0}
                max={100}
                step={1}
                unit="%"
                resetValue={hintsAmountResetValue}
                onChange={(amount) =>
                  updateHintsOfColor(
                    color.hitsOfColor.animated
                      ? { animatedHintAmount: amount }
                      : { amount }
                  )
                }
              />
              <Toggle
                label="Animate Hints"
                disabled={!color.hitsOfColor.enabled}
                checked={color.hitsOfColor.animated}
                onChange={(animated) => updateHintsOfColor({ animated })}
              />
            </div>
          </div>
        </Section>

        <Section
          title="Particles"
          icon={<Sparkles size={16} />}
          order={10}
          summary={breakup.amount > 0 ? `${Math.round(breakup.amount)}%` : "Off"}
        >
          <Slider label="Breakup Strength" value={breakup.amount} min={0} max={100} step={1} unit="%" resetValue={defaultBreakupSettings.amount} onChange={(amount) => updateBreakup({ amount })} />
          <Slider label="Particle Amount" value={breakup.density} min={0} max={100} step={1} unit="%" resetValue={defaultBreakupSettings.density} onChange={(density) => updateBreakup({ density })} />
          <Slider label="Chunk Size" value={breakup.chunkSize} min={1} max={5} step={1} unit=" cells" resetValue={defaultBreakupSettings.chunkSize} onChange={(chunkSize) => updateBreakup({ chunkSize })} />
          <Slider label="Spread Distance" value={breakup.spread} min={0} max={100} step={1} unit="%" resetValue={defaultBreakupSettings.spread} onChange={(spread) => updateBreakup({ spread })} />
          <Slider label="Brightness Falloff" value={breakup.fadeStrength} min={0} max={100} step={1} unit="%" resetValue={defaultBreakupSettings.fadeStrength} onChange={(fadeStrength) => updateBreakup({ fadeStrength })} />
          <Slider label="Edge Erosion" value={breakup.erosionAmount} min={0} max={100} step={1} unit="%" resetValue={defaultBreakupSettings.erosionAmount} onChange={(erosionAmount) => updateBreakup({ erosionAmount })} />
          <Slider label="Cluster Amount" value={breakup.clusterAmount} min={0} max={100} step={1} unit="%" resetValue={defaultBreakupSettings.clusterAmount} onChange={(clusterAmount) => updateBreakup({ clusterAmount })} />
          <Slider label="Particle Chaos" value={breakup.randomness} min={0} max={100} step={1} unit="%" resetValue={defaultBreakupSettings.randomness} onChange={(randomness) => updateBreakup({ randomness })} />
          <Select
            label="Direction Bias"
            value={breakup.directionBias}
            options={particleDirectionOptions}
            onChange={(directionBias) => updateBreakup({ directionBias: directionBias as typeof breakup.directionBias })}
          />
          <label className="block">
            <span className="mb-2 block text-xs text-zinc-500">Seed</span>
            <input
              className="h-10 w-full rounded-xl border border-white/[0.06] bg-black/25 px-3 text-sm text-zinc-100 outline-none focus:border-signal/45 focus:shadow-focus"
              inputMode="numeric"
              value={breakupSeedDraft}
              onChange={(event) => setBreakupSeedDraft(event.target.value)}
              onBlur={applyBreakupSeedDraft}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur();
                }
                if (event.key === "Escape") {
                  setBreakupSeedDraft(String(breakup.seed));
                  event.currentTarget.blur();
                }
              }}
            />
          </label>
        </Section>

        <Section title="Color" icon={<Palette size={16} />} order={11} summary={colorModeLabel}>
          <Select
            label="Mode"
            value={color.paletteMode}
            options={[
              { value: "single", label: "Duotone" },
              { value: "grayscale", label: "Grayscale" },
              { value: "custom", label: "Custom" },
              { value: "source", label: "Source Image Colors" }
            ]}
            onChange={(paletteMode) => updateColor({ paletteMode: paletteMode as typeof color.paletteMode })}
          />
          {color.paletteMode !== "source" && colorInvertControl}
          {color.paletteMode === "single" && (
            <div className="space-y-3">
              <ColorInput
                label="Character"
                value={color.foregroundColor}
                onChange={(foregroundColor) => updateColor({ foregroundColor })}
              />
              <ColorInput
                label="Background"
                value={color.backgroundColor}
                onChange={(backgroundColor) => updateColor({ backgroundColor })}
              />
            </div>
          )}
          {color.paletteMode === "custom" && (
            <div className="space-y-2">
              {activeCustomPalette.map((paletteColor, index, palette) => (
                <div key={`${index}-${palette.length}`} className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <ColorInput
                      label={index === 0 ? "Low" : index === palette.length - 1 ? "High" : `Mid ${index}`}
                      value={paletteColor}
                      onChange={(nextColor) => {
                        const customPalette = [...palette];
                        customPalette[index] = nextColor;
                        updateColor(colorPatchFromPalette(customPalette));
                      }}
                    />
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <IconButton
                      title="Move color up"
                      disabled={index === 0}
                      onClick={() => updateColor(colorPatchFromPalette(moveItem(palette, index, -1)))}
                    >
                      <ArrowUp size={14} />
                    </IconButton>
                    <IconButton
                      title="Move color down"
                      disabled={index === palette.length - 1}
                      onClick={() => updateColor(colorPatchFromPalette(moveItem(palette, index, 1)))}
                    >
                      <ArrowDown size={14} />
                    </IconButton>
                  </div>
                  <IconButton
                    title="Remove color"
                    disabled={palette.length <= 2}
                    onClick={() => {
                      const customPalette = palette.filter((_, itemIndex) => itemIndex !== index);
                      updateColor(colorPatchFromPalette(customPalette));
                    }}
                  >
                    <Trash2 size={15} />
                  </IconButton>
                </div>
              ))}
              <div className="grid grid-cols-2 gap-2">
                <CommandButton
                  variant="secondary"
                  disabled={activeCustomPalette.length >= 12}
                  onClick={() => {
                    const customPalette = activeCustomPalette.length
                      ? [...activeCustomPalette, "#9F39FF"]
                      : [color.backgroundColor, "#9F39FF", color.foregroundColor];
                    updateColor({ customPalette });
                  }}
                >
                  <Plus size={16} />
                  Add color
                </CommandButton>
                <CommandButton
                  variant="secondary"
                  disabled={activeCustomPalette.length < 2}
                  onClick={() => updateColor(colorPatchFromPalette([...activeCustomPalette].reverse()))}
                >
                  <FlipHorizontal size={16} />
                  Reverse
                </CommandButton>
              </div>
            </div>
          )}
          {color.paletteMode === "source" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-black/20 px-3 py-2">
                <span className="text-xs text-zinc-500">Palette size</span>
                <div className="flex items-center gap-2">
                  <IconButton
                    title="Decrease palette size"
                    disabled={color.sourcePaletteSize <= 4}
                    onClick={() => updateColor({ sourcePaletteSize: Math.max(4, color.sourcePaletteSize - 1) })}
                  >
                    <Minus size={15} />
                  </IconButton>
                  <span className="w-6 text-center text-xs tabular-nums text-zinc-300">{color.sourcePaletteSize}</span>
                  <IconButton
                    title="Increase palette size"
                    disabled={color.sourcePaletteSize >= 16}
                    onClick={() => updateColor({ sourcePaletteSize: Math.min(16, color.sourcePaletteSize + 1) })}
                  >
                    <Plus size={15} />
                  </IconButton>
                </div>
              </div>
              <Select
                label="Mapping"
                value={color.sourceColorMapping}
                options={[
                  { value: "palette-map", label: "Palette Map" },
                  { value: "source-match", label: "Source Match" }
                ]}
                onChange={(sourceColorMapping) =>
                  updateColor({ sourceColorMapping: sourceColorMapping as typeof color.sourceColorMapping })
                }
              />
              {color.sourceColorMapping === "source-match" && (
                <Select
                  label="Source Match Background"
                  value={color.sourceMatchBackground}
                  options={[
                    { value: "foreground-only", label: "Foreground only" },
                    { value: "cell-background", label: "Cell background" }
                  ]}
                  onChange={(sourceMatchBackground) =>
                    updateColor({ sourceMatchBackground: sourceMatchBackground as typeof color.sourceMatchBackground })
                  }
                />
              )}
              <div className="grid grid-cols-2 gap-2">
                <CommandButton
                  variant="secondary"
                  disabled={sourcePaletteMatchesOriginal}
                  onClick={() => updateColor({ sourcePalette: activeSourcePaletteOriginal })}
                >
                  <RotateCcw size={16} />
                  Reset all
                </CommandButton>
                <CommandButton
                  variant="secondary"
                  disabled={activeSourcePalette.length < 2}
                  onClick={() => updateColor({ sourcePalette: [...activeSourcePalette].reverse() })}
                >
                  <FlipHorizontal size={16} />
                  Reverse
                </CommandButton>
              </div>
              {colorInvertControl}
              <div className="space-y-2">
                {activeSourcePalette.map((paletteColor, index, palette) => {
                  const resetColor = sourcePaletteResetColor(index);
                  return (
                    <div key={`${index}-${palette.length}`} className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <ColorInput
                          label={`Color ${index + 1}`}
                          value={paletteColor}
                          onChange={(nextColor) => {
                            const sourcePalette = [...palette];
                            sourcePalette[index] = nextColor;
                            updateColor({ sourcePalette });
                          }}
                        />
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <IconButton
                          title="Move color up"
                          disabled={index === 0}
                          onClick={() =>
                            updateColor({
                              sourcePalette: moveItem(palette, index, -1)
                            })
                          }
                        >
                          <ArrowUp size={14} />
                        </IconButton>
                        <IconButton
                          title="Move color down"
                          disabled={index === palette.length - 1}
                          onClick={() =>
                            updateColor({
                              sourcePalette: moveItem(palette, index, 1)
                            })
                          }
                        >
                          <ArrowDown size={14} />
                        </IconButton>
                        <IconButton
                          title="Reset color"
                          disabled={paletteColor.toUpperCase() === resetColor.toUpperCase()}
                          onClick={() => {
                            const sourcePalette = [...palette];
                            sourcePalette[index] = resetColor;
                            updateColor({ sourcePalette });
                          }}
                        >
                          <RotateCcw size={14} />
                        </IconButton>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Section>

        <Section title="Presets" icon={<Save size={16} />} order={2} summary={selectedSettingsPreset?.name}>
          <input
            ref={presetInputRef}
            className="hidden"
            type="file"
            accept="application/json,.json"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.currentTarget.value = "";
              if (!file) {
                return;
              }
              try {
                const preset = parseSettingsPresetFile(await file.text());
                onToneRangePreviewChange(null);
                importSettingsPreset(preset.name, preset.settings);
                setSettingsPresetName("");
                setSettingsPresetError(null);
              } catch (error) {
                setSettingsPresetError(error instanceof Error ? error.message : "Preset import failed.");
              }
            }}
          />
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <Select
                label="Saved render preset"
                value={activeSettingsPresetId ?? ""}
                options={settingsPresetOptions}
                onChange={(id) => {
                  if (!id) {
                    return;
                  }
                  onToneRangePreviewChange(null);
                  loadSettingsPreset(id);
                  setSettingsPresetName("");
                  setSettingsPresetError(null);
                }}
              />
            </div>
            <IconButton
              title="Remove selected preset"
              disabled={!selectedSettingsPreset || selectedSettingsPreset.builtIn}
              onClick={() => {
                if (!selectedSettingsPreset || selectedSettingsPreset.builtIn) {
                  return;
                }
                removeSettingsPreset(selectedSettingsPreset.id);
                setSettingsPresetName("");
                setSettingsPresetError(null);
              }}
            >
              <Trash2 size={15} />
            </IconButton>
          </div>
          <input
            className="h-10 w-full rounded-xl border border-white/[0.06] bg-black/25 px-3 text-sm text-zinc-100 outline-none focus:border-signal/45 focus:shadow-focus"
            placeholder="Render preset name"
            value={settingsPresetName}
            onChange={(event) => {
              setSettingsPresetName(event.target.value);
              setSettingsPresetError(null);
            }}
          />
          <div className="grid grid-cols-2 gap-2">
            <CommandButton
              variant="secondary"
              onClick={() => presetInputRef.current?.click()}
            >
              <Upload size={16} />
              Import
            </CommandButton>
            <CommandButton
              variant="secondary"
              onClick={() => {
                const name = settingsPresetName.trim() || selectedSettingsPreset?.name || "Current settings";
                const file = createSettingsPresetFile(name, currentSettings);
                downloadBlob(new Blob([JSON.stringify(file, null, 2)], { type: "application/json;charset=utf-8" }), presetFileName(name));
                setSettingsPresetError(null);
              }}
            >
              <Download size={16} />
              Export
            </CommandButton>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <CommandButton
              variant="secondary"
              disabled={!settingsPresetName.trim()}
              onClick={() => {
                saveSettingsPreset(settingsPresetName.trim());
                setSettingsPresetName("");
                setSettingsPresetError(null);
              }}
            >
              <Save size={16} />
              Save
            </CommandButton>
            <CommandButton
              variant="secondary"
              disabled={!selectedSettingsPreset}
              onClick={() => {
                if (!selectedSettingsPreset) {
                  return;
                }
                onToneRangePreviewChange(null);
                loadSettingsPreset(selectedSettingsPreset.id);
                setSettingsPresetName("");
                setSettingsPresetError(null);
              }}
            >
              <FolderOpen size={16} />
              Load
            </CommandButton>
            <CommandButton
              variant="secondary"
              title="Reset settings to defaults without clearing uploaded media"
              onClick={() => {
                onToneRangePreviewChange(null);
                resetProcessing();
                setSettingsPresetName("");
                setSettingsPresetError(null);
              }}
            >
              <RotateCcw size={16} />
              Reset
            </CommandButton>
          </div>
          {settingsPresetError && (
            <div className="rounded-2xl border border-ember/20 bg-ember/10 px-3 py-2 text-xs text-ember">
              {settingsPresetError}
            </div>
          )}
        </Section>
      </div>
      </motion.aside>
    </VisualEditingPreviewProvider>
  );
};
