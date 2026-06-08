import turionImageGlyphPresetFile from "./turionImageGlyphPreset.json";
import type { SettingsPreset, StudioSettingsSnapshot } from "../renderer/types";
import { settingsPresetFileKind, settingsPresetFileVersion } from "./settingsPresets";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readSettingsPreset = (
  file: unknown,
  id: string,
  displayName: string
): SettingsPreset => {
  if (
    !isRecord(file) ||
    file.kind !== settingsPresetFileKind ||
    file.version !== settingsPresetFileVersion ||
    !isRecord(file.settings)
  ) {
    console.warn(`Built-in settings preset "${displayName}" is invalid and will use default settings.`);
    return {
      id,
      name: displayName,
      createdAt: 0,
      builtIn: true,
      settings: {} as StudioSettingsSnapshot
    };
  }

  return {
    id,
    name: displayName,
    createdAt: 0,
    builtIn: true,
    settings: file.settings as unknown as StudioSettingsSnapshot
  };
};

export const turionImageGlyphPresetId = "builtin-turion-image-glyph";

export const builtInSettingsPresets: SettingsPreset[] = [
  readSettingsPreset(turionImageGlyphPresetFile, turionImageGlyphPresetId, "Turion Image Glyph")
];
