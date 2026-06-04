import type { AspectRatioId } from "../renderer/types";

export interface AspectRatioPreset {
  id: AspectRatioId;
  label: string;
  width: number | null;
  height: number | null;
}

export const aspectRatioPresets: AspectRatioPreset[] = [
  { id: "free", label: "Free", width: null, height: null },
  { id: "square", label: "1:1", width: 1, height: 1 },
  { id: "landscape-4-3", label: "4:3", width: 4, height: 3 },
  { id: "portrait-3-4", label: "3:4", width: 3, height: 4 },
  { id: "landscape-16-9", label: "16:9", width: 16, height: 9 },
  { id: "portrait-9-16", label: "9:16", width: 9, height: 16 },
  { id: "landscape-5-4", label: "5:4", width: 5, height: 4 },
  { id: "portrait-4-5", label: "4:5", width: 4, height: 5 },
  { id: "a3", label: "A3", width: 297, height: 420 },
  { id: "a3-landscape", label: "A3", width: 420, height: 297 }
];

export const getAspectRatioPreset = (id: AspectRatioId) =>
  aspectRatioPresets.find((preset) => preset.id === id) ?? aspectRatioPresets[0];

export const getTargetAspectRatio = (
  id: AspectRatioId,
  sourceWidth: number,
  sourceHeight: number,
  customWidth?: number,
  customHeight?: number
) => {
  if (id === "custom" && customWidth && customHeight) {
    return customWidth / Math.max(1, customHeight);
  }
  const preset = getAspectRatioPreset(id);
  if (!preset.width || !preset.height) {
    return sourceWidth / Math.max(1, sourceHeight);
  }
  return preset.width / preset.height;
};
