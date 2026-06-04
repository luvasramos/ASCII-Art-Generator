import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Copy, Download, Upload } from "lucide-react";
import { estimateAnimatedExportSize, formatBytes, resolveAnimatedExportFps } from "../export/exportQuality";
import { defaultExportOptions, defaultExportScale } from "../state/defaults";
import { useStudioStore } from "../state/useStudioStore";
import type { AnimationType, RenderGrid } from "../renderer/types";
import { CommandButton, Select, Slider, Toggle } from "./controls";

interface TopLeftActionsProps {
  grid: RenderGrid | null;
  imageName: string;
  onMediaFile: (file: File) => void;
  onExport: () => void;
  onCopyPng: () => void;
  onExportSvg: () => void;
  onExportVideo: () => void;
  onExportVideoMp4: () => void;
  onExportAnimation: () => void;
  onExportAnimationMp4: () => void;
  onExportAnimationGif: () => void;
  onCancelVideoExport: () => void;
  isVideoLoaded: boolean;
  showAnimationExports: boolean;
  isProcessing: boolean;
  isExportingVideo: boolean;
  videoExportProgress: number;
  animationFps: number;
  animationDuration: number;
  animationType: AnimationType;
  videoDuration: number;
  status: string;
}

const compactFileName = (name: string) => (name.length > 36 ? `${name.slice(0, 33)}...` : name);

type ExportFileType = "png" | "svg" | "webm" | "mp4" | "gif";

const exportFileTypeOptions: Array<{ value: ExportFileType; label: string }> = [
  { value: "png", label: "PNG" },
  { value: "svg", label: "SVG" },
  { value: "webm", label: "WebM" },
  { value: "mp4", label: "MP4" },
  { value: "gif", label: "GIF" }
];

const qualityToValue = {
  small: 0,
  balanced: 50,
  high: 100
} as const;

const qualityLabels = {
  small: "Small",
  balanced: "Balanced",
  high: "High Quality"
} as const;

const qualityFromValue = (value: number): "small" | "balanced" | "high" => {
  if (value < 25) return "small";
  if (value < 75) return "balanced";
  return "high";
};

export const TopLeftActions = ({
  grid,
  imageName,
  onMediaFile,
  onExport,
  onCopyPng,
  onExportSvg,
  onExportVideo,
  onExportVideoMp4,
  onExportAnimation,
  onExportAnimationMp4,
  onExportAnimationGif,
  onCancelVideoExport,
  isVideoLoaded,
  showAnimationExports,
  isProcessing,
  isExportingVideo,
  videoExportProgress,
  animationFps,
  animationDuration,
  animationType,
  videoDuration,
  status
}: TopLeftActionsProps) => {
  const mediaInputRef = useRef<HTMLInputElement | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [fileType, setFileType] = useState<ExportFileType>("png");
  const [animatedInfoOpen, setAnimatedInfoOpen] = useState(false);
  const { font, exportOptions, exportScale, updateFont, updateExportOptions, updateExportScale } = useStudioStore();
  const exportDisabled = !grid || isExportingVideo;
  const animatedDuration = isVideoLoaded ? videoDuration : showAnimationExports ? animationDuration : 0;
  const animatedEstimate = estimateAnimatedExportSize({
    grid,
    duration: animatedDuration,
    fps: animationFps,
    quality: exportOptions.animatedExportQuality,
    animationType
  });
  const effectiveAnimatedFps = resolveAnimatedExportFps(animationFps, exportOptions.animatedExportQuality, animationType);
  const animatedExportAvailable = isVideoLoaded || showAnimationExports;
  const selectedAnimatedVideoExport = fileType === "webm" || fileType === "mp4";
  const selectedGifExport = fileType === "gif";
  const showAnimatedControls =
    (selectedAnimatedVideoExport && animatedExportAvailable) || (selectedGifExport && showAnimationExports);
  const showPngControls = fileType === "png";
  const selectedExportDisabled =
    exportDisabled ||
    ((selectedAnimatedVideoExport || selectedGifExport) && isProcessing) ||
    (selectedAnimatedVideoExport && !animatedExportAvailable) ||
    (selectedGifExport && !showAnimationExports);
  const selectedQualityValue = qualityToValue[exportOptions.animatedExportQuality] ?? qualityToValue.balanced;
  const selectedQualityLabel = qualityLabels[exportOptions.animatedExportQuality] ?? qualityLabels.balanced;
  const visibleStatus = /^(exporting|exported|copied|loading|writing|reading|rendering|converting|downloading|ffmpeg|mp4|webm|gif|png|svg|export failed|video export canceled|animation export canceled|gif export canceled)/i.test(
    status
  )
    ? status
    : "";
  const openMediaPicker = () => mediaInputRef.current?.click();
  const toggleExportPanel = () => setExportOpen((value) => !value);
  const runSelectedExport = () => {
    if (selectedExportDisabled) {
      return;
    }

    if (fileType === "png") {
      onExport();
      return;
    }

    if (fileType === "svg") {
      onExportSvg();
      return;
    }

    if (fileType === "gif") {
      onExportAnimationGif();
      return;
    }

    if (fileType === "mp4") {
      if (isVideoLoaded) {
        onExportVideoMp4();
      } else {
        onExportAnimationMp4();
      }
      return;
    }

    if (isVideoLoaded) {
      onExportVideo();
    } else {
      onExportAnimation();
    }
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "o") {
        event.preventDefault();
        openMediaPicker();
      } else if (key === "e") {
        event.preventDefault();
        toggleExportPanel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="pointer-events-auto absolute left-6 top-6 z-30 w-max">
      <input
        ref={mediaInputRef}
        className="hidden"
        type="file"
        accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime,video/x-m4v,.jpg,.jpeg,.png,.webp,.mp4,.webm,.mov,.m4v"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            onMediaFile(file);
          }
          event.currentTarget.value = "";
        }}
      />
      <div className="flex w-max items-center gap-2 rounded-2xl border border-white/[0.06] bg-panel p-2">
        <div className="group relative">
          <button
            type="button"
            aria-label="Upload media"
            title="Upload media (Ctrl/Cmd+O)"
            className="grid h-9 w-9 place-items-center rounded-xl text-zinc-400 transition hover:bg-white/[0.055] hover:text-zinc-100"
            onClick={openMediaPicker}
          >
            <Upload size={16} />
          </button>
          <div className="pointer-events-none absolute left-0 top-12 z-[80] max-w-64 whitespace-nowrap rounded-xl border border-white/[0.06] bg-panel2 px-3 py-2 text-xs text-zinc-300 opacity-0 transition group-hover:opacity-100">
            Upload: {compactFileName(imageName)}
          </div>
        </div>
        <div className="group relative">
          <button
            type="button"
            aria-label="Export"
            title="Export (Ctrl/Cmd+E)"
            className={`grid h-9 w-9 place-items-center rounded-xl border transition ${
              exportOpen
                ? "border-signal/45 bg-signal/15 text-signal"
                : "border-signal/25 bg-signal/10 text-signal hover:bg-signal/15"
            }`}
            onClick={toggleExportPanel}
          >
            <Download size={16} />
          </button>
          <div className="pointer-events-none absolute left-0 top-12 z-[80] whitespace-nowrap rounded-xl border border-white/[0.06] bg-panel2 px-3 py-2 text-xs text-zinc-300 opacity-0 transition group-hover:opacity-100">
            Export
          </div>
        </div>
      </div>

      {exportOpen && (
        <div
          data-ascii-export-panel="true"
          className="absolute left-0 top-full z-50 mt-3 w-80 space-y-4 rounded-2xl border border-white/[0.06] bg-panel p-4"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-zinc-100">Export</div>
              <div className="mt-0.5 text-xs text-zinc-500">Choose a file type</div>
            </div>
            <div className="text-xs tabular-nums text-zinc-500">{exportScale}x</div>
          </div>

          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <Select
                label="File type"
                value={fileType}
                options={exportFileTypeOptions}
                onChange={(value) => setFileType(value as ExportFileType)}
              />
            </div>
            <div className="w-28">
              <CommandButton disabled={selectedExportDisabled} onClick={runSelectedExport}>
                <Download size={16} />
                Export
              </CommandButton>
            </div>
            <button
              type="button"
              aria-label="Copy PNG"
              title="Copy PNG"
              disabled={exportDisabled}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/[0.06] bg-panel2 text-zinc-400 transition disabled:cursor-not-allowed disabled:opacity-40 hover:border-white/[0.12] hover:text-zinc-100"
              onClick={onCopyPng}
            >
              <Copy size={16} />
            </button>
          </div>

          {isExportingVideo && (
            <div className="flex items-center gap-3">
              <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-black/35">
                <div
                  className="h-full rounded-full bg-signal transition-all duration-300"
                  style={{ width: `${Math.round(videoExportProgress * 100)}%` }}
                />
              </div>
              <span className="w-10 text-right text-xs tabular-nums text-zinc-400">
                {Math.round(videoExportProgress * 100)}%
              </span>
              <button
                type="button"
                className="rounded-full border border-white/[0.08] px-3 py-1.5 text-xs font-semibold text-zinc-300 transition hover:border-white/[0.16] hover:text-zinc-100"
                onClick={onCancelVideoExport}
              >
                Cancel
              </button>
            </div>
          )}
          {visibleStatus && (
            <div className="px-1 text-xs leading-5 text-zinc-400">
              {visibleStatus}
            </div>
          )}

          <div className="space-y-3 rounded-2xl border border-white/[0.06] bg-black/20 px-3 py-2.5">
            <Toggle label="Font smoothing" checked={font.smoothing} onChange={(smoothing) => updateFont({ smoothing })} />
            <Toggle label="Anti alias" checked={font.antiAlias} onChange={(antiAlias) => updateFont({ antiAlias })} />
          </div>

          {showAnimatedControls && (
            <div className="space-y-2">
              <Slider
                label="Animated quality"
                value={selectedQualityValue}
                min={0}
                max={100}
                step={50}
                resetValue={qualityToValue.balanced}
                onChange={(value) => updateExportOptions({ animatedExportQuality: qualityFromValue(value) })}
              />
              <div className="-mt-2 text-right text-xs font-medium text-zinc-400">{selectedQualityLabel}</div>
              <div className="overflow-hidden rounded-2xl border border-white/[0.06] bg-black/20">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs font-semibold text-zinc-300 transition hover:bg-white/[0.035]"
                  onClick={() => setAnimatedInfoOpen((value) => !value)}
                >
                  <span>Animated export info</span>
                  <motion.span animate={{ rotate: animatedInfoOpen ? 180 : 0 }} transition={{ duration: 0.16 }}>
                    <ChevronDown size={14} />
                  </motion.span>
                </button>
                <AnimatePresence initial={false}>
                  {animatedInfoOpen && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.14 }}
                      className="border-t border-white/[0.05] px-3 py-2 text-[11px] leading-5 text-zinc-500"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span>Animated FPS</span>
                        <span className="tabular-nums text-zinc-400">{effectiveAnimatedFps} fps</span>
                      </div>
                      {animatedEstimate && (
                        <>
                          <div className="flex items-center justify-between gap-3">
                            <span>Estimated WebM</span>
                            <span className="tabular-nums text-zinc-400">
                              {formatBytes(animatedEstimate.webmBytes)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span>Estimated MP4</span>
                            <span className="tabular-nums text-zinc-400">{formatBytes(animatedEstimate.mp4Bytes)}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span>Estimated GIF</span>
                            <span className="tabular-nums text-zinc-400">{formatBytes(animatedEstimate.gifBytes)}</span>
                          </div>
                        </>
                      )}
                      <div className="pt-1 text-zinc-500">WebM is recommended for smaller animation files.</div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          )}

          {showPngControls && (
            <>
              <Slider
                label="PNG scale"
                value={exportScale}
                min={1}
                max={4}
                step={1}
                unit="x"
                resetValue={defaultExportScale}
                onChange={updateExportScale}
              />
              <Toggle
                label="Transparent Background"
                checked={exportOptions.transparentBackground}
                onChange={(transparentBackground) => updateExportOptions({ transparentBackground })}
              />
              {exportOptions.transparentBackground && (
                <Slider
                  label="Alpha Threshold"
                  value={exportOptions.alphaThreshold}
                  min={0}
                  max={100}
                  step={1}
                  unit="%"
                  resetValue={defaultExportOptions.alphaThreshold}
                  onChange={(alphaThreshold) => updateExportOptions({ alphaThreshold })}
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};
