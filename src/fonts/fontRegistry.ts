import type { BuiltInFont, UploadedFontRecord } from "../renderer/types";

export const builtInFonts: BuiltInFont[] = ["Chivo Mono", "Funnel Sans"];

export const waitForFonts = async (timeoutMs = 1200) => {
  if (!("fonts" in document)) {
    return;
  }

  try {
    await Promise.race([
      document.fonts.ready,
      new Promise<void>((resolve) => {
        window.setTimeout(resolve, timeoutMs);
      })
    ]);
  } catch {
    // Font readiness is advisory. The app shell and renderer should never block on it.
  }
};

const fontFormatFromFile = (file: File): UploadedFontRecord["format"] => {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".otf")) {
    return "opentype";
  }
  if (lower.endsWith(".woff")) {
    return "woff";
  }
  return "truetype";
};

const familyFromFileName = (file: File) =>
  file.name
    .replace(/\.(ttf|otf|woff)$/i, "")
    .replace(/[^a-zA-Z0-9 _-]/g, "")
    .trim()
    .replace(/\s+/g, " ");

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

const readAsArrayBuffer = (file: File) =>
  new Promise<ArrayBuffer>((resolve, reject) => {
    if (typeof file.arrayBuffer === "function") {
      file.arrayBuffer().then(resolve, reject);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });

const dataUrlToArrayBuffer = (dataUrl: string) => {
  const payload = dataUrl.split(",")[1];
  if (!payload) {
    return null;
  }

  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
};

const addLoadedFace = (face: FontFace) => {
  document.fonts.add(face);
  return face;
};

export const loadFontRecord = async (record: UploadedFontRecord, sourceBuffer?: ArrayBuffer) => {
  if (typeof FontFace === "undefined" || !("fonts" in document)) {
    return null;
  }

  const attempts: Array<() => FontFace> = [];
  const buffer = sourceBuffer ?? dataUrlToArrayBuffer(record.source);

  if (buffer) {
    attempts.push(() => new FontFace(record.family, buffer.slice(0)));
  }

  attempts.push(
    () => new FontFace(record.family, `url(${record.source}) format("${record.format}")`),
    () => new FontFace(record.family, `url(${record.source})`)
  );

  let lastError: unknown = null;
  for (const createFace of attempts) {
    try {
      const face = createFace();
      await face.load();
      return addLoadedFace(face);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Custom font could not be loaded");
};

export const registerUploadedFont = async (file: File): Promise<UploadedFontRecord> => {
  const [source, sourceBuffer] = await Promise.all([readAsDataUrl(file), readAsArrayBuffer(file)]);
  const baseFamily = familyFromFileName(file) || "Custom Mono";
  const family = `${baseFamily} ${Date.now()}`;
  const record: UploadedFontRecord = {
    id: `font-${Date.now()}`,
    family,
    displayName: baseFamily,
    source,
    format: fontFormatFromFile(file)
  };
  await loadFontRecord(record, sourceBuffer);
  return record;
};

export const hydrateUploadedFonts = async (records: UploadedFontRecord[]) => {
  await Promise.allSettled(records.map((record) => loadFontRecord(record)));
};
