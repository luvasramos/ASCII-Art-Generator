export interface LivePreviewSourceProxy {
  imageData: ImageData;
  sourceScale: number;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
}

interface SourceProxyCacheEntry {
  sourceCanvas: HTMLCanvasElement;
  proxies: Map<string, LivePreviewSourceProxy>;
}

let sourceProxyCache = new WeakMap<ImageData, SourceProxyCacheEntry>();

const clampSourceScale = (value: number) => Math.min(1, Math.max(0.25, value));

const createCanvas = (width: number, height: number) => {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
};

const getSourceCacheEntry = (source: ImageData) => {
  const cached = sourceProxyCache.get(source);
  if (cached) {
    return cached;
  }

  const sourceCanvas = createCanvas(source.width, source.height);
  const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
  if (!sourceContext) {
    throw new Error("Canvas2D is unavailable for live preview source scaling.");
  }
  sourceContext.putImageData(source, 0, 0);
  const entry = {
    sourceCanvas,
    proxies: new Map<string, LivePreviewSourceProxy>()
  };
  sourceProxyCache.set(source, entry);
  return entry;
};

export const resolveLivePreviewSourceProxy = (
  source: ImageData,
  sourceScale: number
): LivePreviewSourceProxy => {
  const scale = clampSourceScale(sourceScale);
  if (scale >= 0.999) {
    return {
      imageData: source,
      sourceScale: 1,
      width: source.width,
      height: source.height,
      originalWidth: source.width,
      originalHeight: source.height
    };
  }

  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const cacheKey = `${width}x${height}:${scale.toFixed(3)}`;
  const entry = getSourceCacheEntry(source);
  const cached = entry.proxies.get(cacheKey);
  if (cached) {
    return cached;
  }

  const proxyCanvas = createCanvas(width, height);
  const proxyContext = proxyCanvas.getContext("2d", { willReadFrequently: true });
  if (!proxyContext) {
    throw new Error("Canvas2D is unavailable for live preview source scaling.");
  }
  proxyContext.imageSmoothingEnabled = true;
  proxyContext.imageSmoothingQuality = "high";
  proxyContext.clearRect(0, 0, width, height);
  proxyContext.drawImage(entry.sourceCanvas, 0, 0, width, height);

  const proxy: LivePreviewSourceProxy = {
    imageData: proxyContext.getImageData(0, 0, width, height),
    sourceScale: scale,
    width,
    height,
    originalWidth: source.width,
    originalHeight: source.height
  };
  if (entry.proxies.size >= 5) {
    const oldestKey = entry.proxies.keys().next().value as string | undefined;
    if (oldestKey) {
      entry.proxies.delete(oldestKey);
    }
  }
  entry.proxies.set(cacheKey, proxy);
  return proxy;
};

export const clearLivePreviewSourceProxyCache = (source?: ImageData | null) => {
  if (source) {
    sourceProxyCache.delete(source);
    return;
  }
  sourceProxyCache = new WeakMap<ImageData, SourceProxyCacheEntry>();
};
