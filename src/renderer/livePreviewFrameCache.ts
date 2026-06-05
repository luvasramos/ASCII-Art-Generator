export type LivePreviewFrameSource = ImageBitmap | HTMLCanvasElement;

export interface LivePreviewFrameCacheProfile {
  fps: number;
  frameCount: number;
  width: number;
  height: number;
  previewScale: number;
  sourceScale: number;
  stripSize: number;
  cacheKey: string;
}

export interface LivePreviewFrameCacheMetadata extends LivePreviewFrameCacheProfile {
  generatedAt: number;
  approximateBytes: number;
  cachedFrames: number;
  complete: boolean;
  enabled: boolean;
}

export interface LivePreviewCachedFrame {
  frameIndex: number;
  background: LivePreviewFrameSource;
  glyph: LivePreviewFrameSource;
  width: number;
  height: number;
  approximateBytes: number;
  generatedAt: number;
}

export const LIVE_PREVIEW_FRAME_CACHE_MAX_BYTES = 128 * 1024 * 1024;

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
};

const hashString = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

export const createLivePreviewFrameCacheKey = (input: unknown) =>
  `live-preview:${hashString(stableStringify(input))}`;

const normalizeFrameIndex = (frameIndex: number, frameCount: number) => {
  const total = Math.max(1, Math.round(frameCount));
  const index = Math.round(Number.isFinite(frameIndex) ? frameIndex : 0);
  return ((index % total) + total) % total;
};

const estimateFrameBytes = (width: number, height: number) =>
  Math.max(1, Math.round(width)) * Math.max(1, Math.round(height)) * 4 * 2;

const copyCanvas = (canvas: HTMLCanvasElement) => {
  const copy = document.createElement("canvas");
  copy.width = canvas.width;
  copy.height = canvas.height;
  const context = copy.getContext("2d", { alpha: true });
  if (!context) {
    throw new Error("Canvas2D is unavailable for live preview frame caching.");
  }
  context.clearRect(0, 0, copy.width, copy.height);
  context.drawImage(canvas, 0, 0);
  return copy;
};

const createFrameSource = async (canvas: HTMLCanvasElement): Promise<LivePreviewFrameSource> => {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(canvas);
    } catch {
      return copyCanvas(canvas);
    }
  }
  return copyCanvas(canvas);
};

export const disposeLivePreviewFrameSource = (frame: LivePreviewFrameSource) => {
  if ("close" in frame && typeof frame.close === "function") {
    frame.close();
  }
};

const disposeCachedFrame = (frame: LivePreviewCachedFrame) => {
  disposeLivePreviewFrameSource(frame.background);
  disposeLivePreviewFrameSource(frame.glyph);
};

export class LivePreviewFrameCache {
  private profile: LivePreviewFrameCacheMetadata | null = null;
  private frames = new Map<number, LivePreviewCachedFrame>();
  private pendingFrames = new Set<number>();
  private currentBytes = 0;
  private generation = 0;

  setProfile(profile: LivePreviewFrameCacheProfile) {
    const frameCount = Math.max(1, Math.round(profile.frameCount));
    const width = Math.max(1, Math.round(profile.width));
    const height = Math.max(1, Math.round(profile.height));
    const perFrameBytes = estimateFrameBytes(width, height);
    const approximateBytes = perFrameBytes * frameCount;
    const enabled = approximateBytes <= LIVE_PREVIEW_FRAME_CACHE_MAX_BYTES;

    if (this.profile?.cacheKey !== profile.cacheKey) {
      this.clear();
    }

    this.profile = {
      ...profile,
      frameCount,
      width,
      height,
      generatedAt: this.profile?.cacheKey === profile.cacheKey ? this.profile.generatedAt : Date.now(),
      approximateBytes,
      cachedFrames: this.frames.size,
      complete: this.frames.size >= frameCount,
      enabled
    };

    if (!enabled) {
      this.clearFramesOnly();
    }

    return this.getMetadata();
  }

  getFrame(frameIndex: number) {
    if (!this.profile?.enabled) {
      return null;
    }
    return this.frames.get(normalizeFrameIndex(frameIndex, this.profile.frameCount)) ?? null;
  }

  storeFrame(frameIndex: number, backgroundCanvas: HTMLCanvasElement, glyphCanvas: HTMLCanvasElement) {
    const profile = this.profile;
    if (!profile?.enabled) {
      return;
    }

    const normalizedFrameIndex = normalizeFrameIndex(frameIndex, profile.frameCount);
    if (this.frames.has(normalizedFrameIndex) || this.pendingFrames.has(normalizedFrameIndex)) {
      return;
    }

    const approximateBytes = estimateFrameBytes(profile.width, profile.height);
    if (approximateBytes > LIVE_PREVIEW_FRAME_CACHE_MAX_BYTES) {
      this.clearFramesOnly();
      return;
    }

    const cacheKey = profile.cacheKey;
    const generation = this.generation;
    this.pendingFrames.add(normalizedFrameIndex);

    void Promise.all([createFrameSource(backgroundCanvas), createFrameSource(glyphCanvas)])
      .then(([background, glyph]) => {
        this.pendingFrames.delete(normalizedFrameIndex);
        if (this.generation !== generation || this.profile?.cacheKey !== cacheKey || !this.profile.enabled) {
          disposeLivePreviewFrameSource(background);
          disposeLivePreviewFrameSource(glyph);
          return;
        }
        if (this.frames.has(normalizedFrameIndex)) {
          disposeLivePreviewFrameSource(background);
          disposeLivePreviewFrameSource(glyph);
          return;
        }
        if (!this.evictUntilFits(approximateBytes)) {
          disposeLivePreviewFrameSource(background);
          disposeLivePreviewFrameSource(glyph);
          return;
        }
        const frame: LivePreviewCachedFrame = {
          frameIndex: normalizedFrameIndex,
          background,
          glyph,
          width: this.profile.width,
          height: this.profile.height,
          approximateBytes,
          generatedAt: Date.now()
        };
        this.frames.set(normalizedFrameIndex, frame);
        this.currentBytes += approximateBytes;
        this.refreshMetadata();
      })
      .catch(() => {
        this.pendingFrames.delete(normalizedFrameIndex);
      });
  }

  getMetadata(): LivePreviewFrameCacheMetadata | null {
    this.refreshMetadata();
    return this.profile;
  }

  clear() {
    this.generation += 1;
    this.clearFramesOnly();
    this.profile = null;
  }

  private clearFramesOnly() {
    this.frames.forEach(disposeCachedFrame);
    this.frames.clear();
    this.pendingFrames.clear();
    this.currentBytes = 0;
    this.refreshMetadata();
  }

  private evictUntilFits(bytesNeeded: number) {
    while (
      this.currentBytes + bytesNeeded > LIVE_PREVIEW_FRAME_CACHE_MAX_BYTES &&
      this.frames.size > 0
    ) {
      const oldestKey = this.frames.keys().next().value as number | undefined;
      if (oldestKey === undefined) {
        break;
      }
      const oldestFrame = this.frames.get(oldestKey);
      if (oldestFrame) {
        disposeCachedFrame(oldestFrame);
        this.currentBytes -= oldestFrame.approximateBytes;
      }
      this.frames.delete(oldestKey);
    }
    return this.currentBytes + bytesNeeded <= LIVE_PREVIEW_FRAME_CACHE_MAX_BYTES;
  }

  private refreshMetadata() {
    if (!this.profile) {
      return;
    }
    this.profile = {
      ...this.profile,
      cachedFrames: this.frames.size,
      complete: this.profile.enabled && this.frames.size >= this.profile.frameCount
    };
  }
}
