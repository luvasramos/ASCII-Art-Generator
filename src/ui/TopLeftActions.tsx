import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Copy, Download, Upload } from "lucide-react";
import {
  animatedExportQualityOptions,
  estimateAnimatedExportSize,
  formatBitrate,
  formatBytes,
  resolveAnimatedExportFps,
  resolveAnimatedExportProfile
} from "../export/exportQuality";
import { defaultExportOptions } from "../state/defaults";
import { useStudioStore } from "../state/useStudioStore";
import type { AnimatedExportQuality, AnimationType, RenderGrid } from "../renderer/types";
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
  onExportAnimationPngSequence: () => void;
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

type ExportFileType = "png" | "png-sequence" | "svg" | "webm" | "mp4" | "gif";

const exportFileTypeOptions: Array<{ value: ExportFileType; label: string }> = [
  { value: "png", label: "PNG" },
  { value: "png-sequence", label: "PNG Sequence (.zip)" },
  { value: "svg", label: "SVG" },
  { value: "webm", label: "WebM" },
  { value: "mp4", label: "MP4" },
  { value: "gif", label: "GIF" }
];

const videoScaleOptions = [
  { value: "1", label: "1x" },
  { value: "2", label: "2x" },
  { value: "4", label: "4x" }
];

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
  onExportAnimationPngSequence,
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
  const { font, exportOptions, exportScale, updateFont, updateExportOptions, updateExportScale } = useStudioStore();
  const availableExportFileTypeOptions = showAnimationExports
    ? exportFileTypeOptions
    : exportFileTypeOptions.filter((option) => option.value !== "png-sequence");
  const exportDisabled = !grid || isExportingVideo;
  const animatedDuration = isVideoLoaded ? videoDuration : showAnimationExports ? animationDuration : 0;
  const animatedEstimate = estimateAnimatedExportSize({
    grid,
    duration: animatedDuration,
    fps: animationFps,
    quality: exportOptions.animatedExportQuality,
    animationType,
    exportScale
  });
  const effectiveAnimatedFps = resolveAnimatedExportFps(animationFps, exportOptions.animatedExportQuality, animationType);
  const selectedQualityProfile = resolveAnimatedExportProfile(exportOptions.animatedExportQuality, animationType);
  const animatedExportAvailable = isVideoLoaded || showAnimationExports;
  const selectedAnimatedVideoExport = fileType === "webm" || fileType === "mp4";
  const selectedGifExport = fileType === "gif";
  const selectedPngSequenceExport = fileType === "png-sequence";
  const showAnimatedControls =
    (selectedAnimatedVideoExport && animatedExportAvailable) ||
    (selectedGifExport && showAnimationExports) ||
    (selectedPngSequenceExport && showAnimationExports);
  const showPngControls = fileType === "png";
  const selectedExportDisabled =
    exportDisabled ||
    ((selectedAnimatedVideoExport || selectedGifExport || selectedPngSequenceExport) && isProcessing) ||
    (selectedAnimatedVideoExport && !animatedExportAvailable) ||
    (selectedGifExport && !showAnimationExports) ||
    (selectedPngSequenceExport && !showAnimationExports);
  const outputScale = fileType === "svg" ? 1 : exportScale;
  const canvasWidth = grid ? Math.max(1, Math.round(grid.width)) : null;
  const canvasHeight = grid ? Math.max(1, Math.round(grid.height)) : null;
  const rawOutputWidth = canvasWidth ? Math.max(1, Math.round(canvasWidth * outputScale)) : null;
  const rawOutputHeight = canvasHeight ? Math.max(1, Math.round(canvasHeight * outputScale)) : null;
  const outputWidth =
    rawOutputWidth && selectedAnimatedVideoExport ? rawOutputWidth + (rawOutputWidth % 2) : rawOutputWidth;
  const outputHeight =
    rawOutputHeight && selectedAnimatedVideoExport ? rawOutputHeight + (rawOutputHeight % 2) : rawOutputHeight;
  const selectedEstimate =
    animatedEstimate && fileType === "mp4"
      ? animatedEstimate.mp4Bytes
      : animatedEstimate && fileType === "webm"
        ? animatedEstimate.webmBytes
        : animatedEstimate && fileType === "gif"
          ? animatedEstimate.gifBytes
          : null;
  const selectedFileTypeLabel =
    exportFileTypeOptions.find((option) => option.value === fileType)?.label ?? fileType.toUpperCase();
  const selectedAnimatedScaleLabel = selectedPngSequenceExport ? "Export Scale" : "Video Scale";
  const selectedAnimatedQualityLabel = selectedPngSequenceExport ? "Animation Quality" : "Video Quality";
  const selectedAnimatedScaleSummaryLabel = selectedPngSequenceExport ? "Export scale" : "Video scale";
  const mp4HighResolutionWarning =
    fileType === "mp4" &&
    showAnimatedControls &&
    ((outputWidth !== null && outputHeight !== null && (outputWidth > 1920 || outputHeight > 1080)) ||
      exportOptions.animatedExportQuality === "master");
  const visibleStatus = /^(preparing|exporting|exported|copied|loading|writing|reading|rendering|recording|converting|finalizing|download ready|downloading|ffmpeg|mp4|webm|gif|png|svg|export failed|video export canceled|animation export canceled|gif export canceled)/i.test(
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

    if (fileType === "png-sequence") {
      onExportAnimationPngSequence();
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
    if (fileType === "png-sequence" && !showAnimationExports) {
      setFileType("png");
    }
  }, [fileType, showAnimationExports]);

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
            <div className="text-xs tabular-nums text-zinc-500">Scale {exportScale}x</div>
          </div>

          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <Select
                label="File type"
                value={fileType}
                options={availableExportFileTypeOptions}
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

          {!showAnimatedControls && (
            <div className="rounded-2xl border border-white/[0.06] bg-black/20 px-3 py-2 text-[11px] leading-5 text-zinc-500">
              <div className="flex items-center justify-between gap-3">
                <span>File type</span>
                <span className="tabular-nums text-zinc-300">{selectedFileTypeLabel}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Canvas</span>
                <span className="tabular-nums text-zinc-300">
                  {canvasWidth && canvasHeight ? `${canvasWidth} x ${canvasHeight} px` : "No render"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Export scale</span>
                <span className="tabular-nums text-zinc-300">{outputScale}x</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Output</span>
                <span className="tabular-nums text-zinc-300">
                  {outputWidth && outputHeight ? `${outputWidth} x ${outputHeight} px` : "No render"}
                </span>
              </div>
              <div className="border-t border-white/[0.05] pt-1 text-zinc-500">
                Output size = Canvas size x Export scale
              </div>
            </div>
          )}

          <div className="space-y-3 rounded-2xl border border-white/[0.06] bg-black/20 px-3 py-2.5">
            <Toggle label="Font smoothing" checked={font.smoothing} onChange={(smoothing) => updateFont({ smoothing })} />
            <Toggle label="Anti alias" checked={font.antiAlias} onChange={(antiAlias) => updateFont({ antiAlias })} />
          </div>

          {showAnimatedControls && (
            <div className="space-y-3">
              <Select
                label={selectedAnimatedScaleLabel}
                value={String(exportScale)}
                options={videoScaleOptions}
                onChange={(value) => updateExportScale(Number(value))}
              />
              <Select
                label={selectedAnimatedQualityLabel}
                value={exportOptions.animatedExportQuality}
                options={animatedExportQualityOptions}
                onChange={(value) => updateExportOptions({ animatedExportQuality: value as AnimatedExportQuality })}
              />
              <div className="rounded-2xl border border-white/[0.06] bg-black/20 px-3 py-2 text-[11px] leading-5 text-zinc-500">
                <div className="flex items-center justify-between gap-3">
                  <span>File type</span>
                  <span className="tabular-nums text-zinc-300">{selectedFileTypeLabel}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Canvas</span>
                  <span className="tabular-nums text-zinc-300">
                    {canvasWidth && canvasHeight ? `${canvasWidth} x ${canvasHeight} px` : "No render"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>{selectedAnimatedScaleSummaryLabel}</span>
                  <span className="tabular-nums text-zinc-300">{exportScale}x</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Output</span>
                  <span className="tabular-nums text-zinc-300">
                    {outputWidth && outputHeight ? `${outputWidth} x ${outputHeight} px` : "No render"}
                  </span>
                </div>
                <div className="border-t border-white/[0.05] pt-1 text-zinc-500">
                  Output size = Canvas size x Export scale
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>FPS</span>
                  <span className="tabular-nums text-zinc-300">{effectiveAnimatedFps} fps</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Duration</span>
                  <span className="tabular-nums text-zinc-300">
                    {Number.isFinite(animatedDuration) && animatedDuration > 0 ? `${animatedDuration.toFixed(2)}s` : "0s"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Frames</span>
                  <span className="tabular-nums text-zinc-300">{animatedEstimate?.frames ?? 0}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Quality</span>
                  <span className="tabular-nums text-zinc-300">{selectedQualityProfile.label}</span>
                </div>
                {selectedAnimatedVideoExport && animatedEstimate && (
                  <div className="flex items-center justify-between gap-3">
                    <span>Bitrate target</span>
                    <span className="tabular-nums text-zinc-300">{formatBitrate(animatedEstimate.bitrate)}</span>
                  </div>
                )}
                {fileType === "mp4" && animatedEstimate && (
                  <div className="flex items-center justify-between gap-3">
                    <span>H.264</span>
                    <span className="tabular-nums text-zinc-300">
                      CRF {animatedEstimate.crf}, {animatedEstimate.preset}
                    </span>
                  </div>
                )}
                {selectedEstimate !== null && (
                  <div className="mt-1 flex items-center justify-between gap-3 border-t border-white/[0.05] pt-1">
                    <span>Estimated {fileType.toUpperCase()}</span>
                    <span className="tabular-nums text-zinc-300">{formatBytes(selectedEstimate)}</span>
                  </div>
                )}
              </div>
              {mp4HighResolutionWarning && (
                <div className="flex gap-2 rounded-2xl border border-amber-300/15 bg-amber-300/[0.06] px-3 py-2 text-[11px] leading-5 text-amber-100/80">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span>
                    High-quality MP4 export can be slow in the browser. Keep the tab open and avoid switching apps.
                    WebM is faster.
                  </span>
                </div>
              )}
            </div>
          )}

          {showPngControls && (
            <>
              <Select
                label="PNG scale"
                value={String(exportScale)}
                options={videoScaleOptions}
                onChange={(value) => updateExportScale(Number(value))}
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
