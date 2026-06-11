const supportedTypes = ["video/mp4", "video/webm", "video/quicktime", "video/x-m4v"];
const supportedExtensions = /\.(mp4|webm|mov|m4v)$/i;

export const isSupportedVideo = (file: File) =>
  supportedTypes.includes(file.type) || supportedExtensions.test(file.name);

const waitForVideoEvent = (video: HTMLVideoElement, eventName: keyof HTMLMediaElementEventMap) =>
  new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener(eventName, handleEvent);
      video.removeEventListener("error", handleError);
    };
    const handleEvent = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error("This browser could not decode this video. Try MP4/H.264 or WebM."));
    };
    video.addEventListener(eventName, handleEvent, { once: true });
    video.addEventListener("error", handleError, { once: true });
  });

export const createVideoElement = (source: string) => {
  const video = document.createElement("video");
  video.src = source;
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = "anonymous";
  return video;
};

export const loadFileAsVideo = async (file: File) => {
  if (!isSupportedVideo(file)) {
    throw new Error("Use MP4, WebM, or MOV video files supported by this browser.");
  }

  const url = URL.createObjectURL(file);
  const video = createVideoElement(url);

  try {
    await waitForVideoEvent(video, "loadedmetadata");
    if (!video.videoWidth || !video.videoHeight) {
      await waitForVideoEvent(video, "loadeddata");
    }
    return {
      name: file.name,
      url,
      element: video,
      width: video.videoWidth,
      height: video.videoHeight,
      duration: Number.isFinite(video.duration) ? video.duration : 0
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
};

export const seekVideo = (video: HTMLVideoElement, time: number) =>
  new Promise<void>((resolve, reject) => {
    const target = Math.min(Math.max(0, time), Number.isFinite(video.duration) ? video.duration : time);
    if (Math.abs(video.currentTime - target) < 0.001 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      resolve();
      return;
    }

    const cleanup = () => {
      video.removeEventListener("seeked", handleSeeked);
      video.removeEventListener("error", handleError);
    };
    const handleSeeked = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error("Could not seek video frame."));
    };
    video.addEventListener("seeked", handleSeeked, { once: true });
    video.addEventListener("error", handleError, { once: true });
    video.currentTime = target;
  });

export const videoFrameToImageData = (video: HTMLVideoElement, maxDimension = 1800) => {
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  if (!sourceWidth || !sourceHeight || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    throw new Error("Video frame is not ready yet.");
  }

  const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("Canvas2D is unavailable");
  }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(video, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
};
