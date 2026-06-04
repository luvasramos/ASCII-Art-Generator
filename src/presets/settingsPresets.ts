import type { SettingsPreset, StudioSettingsSnapshot } from "../renderer/types";

export const settingsPresetFileKind = "ascii-rendering-studio-preset";
export const settingsPresetFileVersion = 1;

interface SettingsPresetFile {
  kind: typeof settingsPresetFileKind;
  version: typeof settingsPresetFileVersion;
  name: string;
  settings: Partial<StudioSettingsSnapshot>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requireRecord = (value: Record<string, unknown>, key: keyof StudioSettingsSnapshot) => {
  if (!isRecord(value[key])) {
    throw new Error(`Preset is missing valid ${String(key)} settings.`);
  }
};

export const createSettingsPresetFile = (
  name: string,
  settings: StudioSettingsSnapshot
): SettingsPresetFile => ({
  kind: settingsPresetFileKind,
  version: settingsPresetFileVersion,
  name,
  settings
});

export const parseSettingsPresetFile = (text: string): SettingsPresetFile => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Preset file is not valid JSON.");
  }

  if (!isRecord(parsed)) {
    throw new Error("Preset file must contain an object.");
  }
  if (parsed.kind !== settingsPresetFileKind) {
    throw new Error("Preset file is not compatible with ASCII Rendering Studio.");
  }
  if (parsed.version !== settingsPresetFileVersion) {
    throw new Error("Preset file version is not supported.");
  }
  if (typeof parsed.name !== "string" || !parsed.name.trim()) {
    throw new Error("Preset file is missing a name.");
  }
  if (!isRecord(parsed.settings)) {
    throw new Error("Preset file is missing settings.");
  }

  requireRecord(parsed.settings, "font");
  requireRecord(parsed.settings, "ascii");
  requireRecord(parsed.settings, "image");
  requireRecord(parsed.settings, "frame");
  requireRecord(parsed.settings, "breakup");
  requireRecord(parsed.settings, "color");
  requireRecord(parsed.settings, "exportOptions");
  if (typeof parsed.settings.exportScale !== "number") {
    throw new Error("Preset is missing a valid export scale.");
  }

  return parsed as unknown as SettingsPresetFile;
};

export const presetFileName = (name: string) => {
  const normalized = name
    .trim()
    .replace(/[^a-z0-9-_]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `${normalized || "ascii-render-preset"}.json`;
};

export const settingsPresetToFile = (preset: SettingsPreset) =>
  createSettingsPresetFile(preset.name, preset.settings);
