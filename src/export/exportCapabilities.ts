export type VideoExportExtension = "mp4" | "webm";

export interface VideoExportFormat {
  mimeType: string;
  extension: VideoExportExtension;
  label: string;
}

export const mp4FileProtocolMessage =
  "MP4 export requires running the app from a local server or hosted site. Use npm run dev, npm run preview, or GitHub Pages.";

export const mp4EnvironmentFallback =
  "MP4 export needs a browser with Worker, WebAssembly, and reachable ffmpeg assets. Export WebM instead, or try npm run preview / GitHub Pages.";

export const ffmpegAssetPaths = {
  coreURL: "ffmpeg/ffmpeg-core.js",
  wasmURL: "ffmpeg/ffmpeg-core.wasm",
  classWorkerURL: "ffmpeg/ffmpeg-worker.js"
};

export const videoExportFormats: VideoExportFormat[] = [
  { mimeType: "video/mp4;codecs=avc1.42E01E", extension: "mp4", label: "MP4 H.264" },
  { mimeType: "video/mp4;codecs=h264", extension: "mp4", label: "MP4 H.264" },
  { mimeType: "video/mp4", extension: "mp4", label: "MP4" },
  { mimeType: "video/webm;codecs=vp9", extension: "webm", label: "WebM VP9" },
  { mimeType: "video/webm;codecs=vp8", extension: "webm", label: "WebM VP8" },
  { mimeType: "video/webm", extension: "webm", label: "WebM" }
];

export const videoMimeTypesToTest = videoExportFormats.map((format) => format.mimeType);

export const isVideoMimeTypeSupported = (mimeType: string) =>
  typeof MediaRecorder !== "undefined" &&
  typeof MediaRecorder.isTypeSupported === "function" &&
  MediaRecorder.isTypeSupported(mimeType);

export const resolveBundledAssetUrl = (assetUrl: string) => {
  if (typeof window === "undefined") {
    return assetUrl;
  }
  return new URL(assetUrl, document.baseURI || window.location.href).href;
};

export const resolveFfmpegAssetUrls = () => ({
  coreURL: resolveBundledAssetUrl(ffmpegAssetPaths.coreURL),
  wasmURL: resolveBundledAssetUrl(ffmpegAssetPaths.wasmURL),
  classWorkerURL: resolveBundledAssetUrl(ffmpegAssetPaths.classWorkerURL)
});

const getLocation = () => (typeof window === "undefined" ? null : window.location);

export const getExportEnvironment = () => {
  const location = getLocation();
  const hostname = location?.hostname ?? "";
  const protocol = location?.protocol ?? "(no window)";
  const isLocalhost =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1";

  return {
    href: location?.href ?? "(no window)",
    protocol,
    hostname,
    isFile: protocol === "file:",
    isLocalhost,
    isHostedHttps: protocol === "https:" && !isLocalhost
  };
};

export const getSupportedVideoFormat = (
  preferredExtension: VideoExportExtension = "webm",
  allowFormatFallback = true
) => {
  if (typeof MediaRecorder === "undefined") {
    return null;
  }
  const preferred = videoExportFormats.filter((format) => format.extension === preferredExtension);
  if (!allowFormatFallback) {
    return preferred.find((format) => isVideoMimeTypeSupported(format.mimeType)) ?? null;
  }
  const fallback = videoExportFormats.filter((format) => format.extension !== preferredExtension);
  return [...preferred, ...fallback].find((format) => isVideoMimeTypeSupported(format.mimeType)) ?? null;
};

export const collectVideoExportCapabilities = () => {
  const environment = getExportEnvironment();
  const mediaRecorderAvailable = typeof MediaRecorder !== "undefined";
  const mimeTypes = videoMimeTypesToTest.map((mimeType) => ({
    mimeType,
    supported: isVideoMimeTypeSupported(mimeType)
  }));
  const supportedWebMFormat = getSupportedVideoFormat("webm", false);

  return {
    environment,
    workerAvailable: typeof Worker !== "undefined",
    webAssemblyAvailable: typeof WebAssembly !== "undefined",
    mediaRecorderAvailable,
    webmSupported: Boolean(supportedWebMFormat),
    supportedWebMFormat,
    mimeTypes,
    ffmpegAssetUrls: resolveFfmpegAssetUrls(),
    crossOriginIsolated:
      typeof window !== "undefined" && "crossOriginIsolated" in window ? window.crossOriginIsolated : false
  };
};

export const getMp4UnavailableReason = () => {
  const capabilities = collectVideoExportCapabilities();
  if (capabilities.environment.isFile) {
    return mp4FileProtocolMessage;
  }
  if (!capabilities.workerAvailable) {
    return `MP4 export requires Web Worker support. ${mp4EnvironmentFallback}`;
  }
  if (!capabilities.webAssemblyAvailable) {
    return `MP4 export requires WebAssembly support. ${mp4EnvironmentFallback}`;
  }
  return null;
};
