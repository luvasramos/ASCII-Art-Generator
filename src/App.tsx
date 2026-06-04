import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { normalizeCharacterSet } from "./ascii/charset";
import { downloadBlob } from "./export/download";
import { exportAsciiGif } from "./export/exportGif";
import { createCanvasPngBlob, createPngBlob, exportPng } from "./export/exportPng";
import { renderAsciiAnimationFrames } from "./export/renderAnimationFrames";
import { exportSvg } from "./export/exportSvg";
import { exportAsciiFrameSequence, exportAsciiVideo, type VideoExportExtension } from "./export/exportVideo";
import { hydrateUploadedFonts, registerUploadedFont, waitForFonts } from "./fonts/fontRegistry";
import { analyzeGlyphSet } from "./glyphs/glyphAnalysis";
import { createAnimatedImageRenderer, type AnimatedImageRenderer } from "./processing/animateImage";
import { loadFileAsImage, loadImageElement, imageToPreviewData, isSupportedImage } from "./processing/imageInput";
import { isSupportedVideo, loadFileAsVideo, seekVideo, videoFrameToImageData } from "./processing/videoInput";
import { useAsciiProcessor } from "./renderer/useAsciiProcessor";
import type { LoadedVideoSource, MediaKind, StillImageMode, ToneRangePreview } from "./renderer/types";
import { useStudioStore } from "./state/useStudioStore";
import { RightSidebar } from "./ui/RightSidebar";
import { StudioCanvas } from "./ui/StudioCanvas";
import { TopLeftActions } from "./ui/TopLeftActions";

const persistedImageLimit = 3_200_000;

const exportFileName = (sourceName: string, extension: "png" | "svg") => {
  const base = sourceName.replace(/\.[a-z0-9]+$/i, "").replace(/[^a-z0-9-_]+/gi, "-").toLowerCase();
  return `${base || "ascii-render"}-layered.${extension}`;
};

const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "0:00";
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
};

const isAbortError = (error: unknown) =>
  error instanceof Error && (error.name === "AbortError" || error.message.toLowerCase().includes("canceled"));

const mp4FailureStatus = (error: unknown) => {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("local server")) {
    return "MP4 export requires running the app from a local server.";
  }
  return "MP4 conversion failed. Export WebM instead.";
};

const isSupportedMediaFile = (file: File) => isSupportedImage(file) || isSupportedVideo(file);

export default function App() {
  const store = useStudioStore();
  const [imageData, setImageData] = useState<ImageData | null>(null);
  const [staticImageData, setStaticImageData] = useState<ImageData | null>(null);
  const [imageAnimator, setImageAnimator] = useState<AnimatedImageRenderer | null>(null);
  const [status, setStatus] = useState("Ready");
  const [fontTick, setFontTick] = useState(0);
  const [mediaKind, setMediaKind] = useState<MediaKind>("image");
  const [stillImageMode, setStillImageMode] = useState<StillImageMode>("static");
  const [videoSource, setVideoSource] = useState<LoadedVideoSource | null>(null);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [isExportingVideo, setIsExportingVideo] = useState(false);
  const [videoExportProgress, setVideoExportProgress] = useState(0);
  const [mediaVersion, setMediaVersion] = useState(0);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [toneRangePreview, setToneRangePreview] = useState<ToneRangePreview | null>(null);
  const videoSourceRef = useRef<LoadedVideoSource | null>(null);
  const videoPreviewLastSampleRef = useRef(-1);
  const videoExportAbortRef = useRef<AbortController | null>(null);
  const syncedImageDataUrlRef = useRef<string | null>(null);

  const releaseVideoSource = useCallback(() => {
    const current = videoSourceRef.current;
    if (current) {
      current.element.pause();
      URL.revokeObjectURL(current.url);
      videoSourceRef.current = null;
    }
    setVideoSource(null);
    setIsVideoPlaying(false);
    setVideoCurrentTime(0);
    setVideoDuration(0);
    videoPreviewLastSampleRef.current = -1;
  }, []);

  const loadDataUrl = useCallback(
    async (name: string, dataUrl: string, persist: boolean) => {
      setStatus("Decoding image");
      releaseVideoSource();
      setMediaKind("image");
      const image = await loadImageElement(dataUrl);
      const nextImageData = imageToPreviewData(image);
      syncedImageDataUrlRef.current = dataUrl;
      setStaticImageData(nextImageData);
      setImageData(nextImageData);
      setMediaVersion((version) => version + 1);
      setStillImageMode("static");
      if (persist) {
        store.setImage(name, dataUrl.length <= persistedImageLimit ? dataUrl : null);
      }
      setStatus(`${nextImageData.width} x ${nextImageData.height} source`);
    },
    [releaseVideoSource, store]
  );

  const handleImageFile = useCallback(
    async (file: File) => {
      try {
        if (!isSupportedImage(file)) {
          setStatus("Use JPG, PNG, WEBP, MP4, WebM, or browser-supported MOV");
          return;
        }
        setStatus("Loading image");
        releaseVideoSource();
        setMediaKind("image");
        const { dataUrl, image } = await loadFileAsImage(file);
        const nextImageData = imageToPreviewData(image);
        syncedImageDataUrlRef.current = dataUrl;
        setStaticImageData(nextImageData);
        setImageData(nextImageData);
        setMediaVersion((version) => version + 1);
        setStillImageMode("static");
        store.setImage(file.name, dataUrl.length <= persistedImageLimit ? dataUrl : null);
        setStatus(`${nextImageData.width} x ${nextImageData.height} source`);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Image load failed");
      }
    },
    [releaseVideoSource, store]
  );

  const sampleCurrentVideoFrame = useCallback((source: LoadedVideoSource) => {
    const frameData = videoFrameToImageData(source.element);
    setImageData(frameData);
    setVideoCurrentTime(source.element.currentTime);
    videoPreviewLastSampleRef.current = source.element.currentTime;
  }, []);

  const handleVideoFile = useCallback(
    async (file: File) => {
      try {
        if (!isSupportedVideo(file)) {
          setStatus("Use MP4, WebM, or MOV video files supported by this browser");
          return;
        }
        setStatus("Loading video");
        const nextSource = await loadFileAsVideo(file);
        releaseVideoSource();
        videoSourceRef.current = nextSource;
        setVideoSource(nextSource);
        setMediaKind("video");
        setStaticImageData(null);
        setStillImageMode("static");
        setVideoDuration(nextSource.duration);
        setVideoCurrentTime(0);
        setMediaVersion((version) => version + 1);
        store.setImage(nextSource.name, null);
        await seekVideo(nextSource.element, 0);
        sampleCurrentVideoFrame(nextSource);
        setStatus(
          `${nextSource.width} x ${nextSource.height} video, ${formatTime(nextSource.duration)} duration`
        );
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Video load failed");
      }
    },
    [releaseVideoSource, sampleCurrentVideoFrame, store]
  );

  const handleMediaFile = useCallback(
    (file: File) => {
      if (isSupportedImage(file)) {
        void handleImageFile(file);
        return;
      }
      if (isSupportedVideo(file)) {
        void handleVideoFile(file);
        return;
      }
      setStatus("Use JPG, PNG, WEBP, MP4, WebM, or browser-supported MOV");
    },
    [handleImageFile, handleVideoFile]
  );

  const handleFontFile = useCallback(
    async (file: File) => {
      try {
        setStatus("Loading font");
        const record = await registerUploadedFont(file);
        store.addUploadedFont(record);
        await waitForFonts();
        setFontTick((value) => value + 1);
        setStatus(`Font loaded: ${record.displayName}`);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Font load failed");
      }
    },
    [store]
  );

  useEffect(
    () => () => {
      releaseVideoSource();
      videoExportAbortRef.current?.abort();
    },
    [releaseVideoSource]
  );

  useEffect(() => {
    if (!staticImageData) {
      setImageAnimator(null);
      return;
    }

    try {
      setImageAnimator(createAnimatedImageRenderer(staticImageData));
    } catch (error) {
      setImageAnimator(null);
      setStatus(error instanceof Error ? error.message : "Image animation unavailable");
    }
  }, [staticImageData]);

  useEffect(() => {
    console.info("App rendered");

    void hydrateUploadedFonts(store.uploadedFonts)
      .then(() => waitForFonts())
      .then(() => setFontTick((value) => value + 1))
      .catch(() => setStatus("Font restore skipped"));
    setStatus("Ready");
  }, []);

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? []);
      const file = files.find(isSupportedMediaFile) ?? files[0];
      if (file) {
        handleMediaFile(file);
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [handleMediaFile]);

  useEffect(() => {
    if (!videoSource) {
      return undefined;
    }

    const video = videoSource.element;
    const handleEnded = () => {
      setIsVideoPlaying(false);
      setVideoCurrentTime(Number.isFinite(video.duration) ? video.duration : video.currentTime);
      try {
        sampleCurrentVideoFrame(videoSource);
      } catch {
        // The UI should never crash because a final decoded frame was unavailable.
      }
    };
    const handleTimeUpdate = () => setVideoCurrentTime(video.currentTime);

    video.addEventListener("ended", handleEnded);
    video.addEventListener("timeupdate", handleTimeUpdate);
    return () => {
      video.removeEventListener("ended", handleEnded);
      video.removeEventListener("timeupdate", handleTimeUpdate);
    };
  }, [sampleCurrentVideoFrame, videoSource]);

  useEffect(() => {
    if (!videoSource || !isVideoPlaying) {
      return undefined;
    }

    let animationFrame = 0;
    let cancelled = false;
    const video = videoSource.element;
    const sample = () => {
      if (cancelled) {
        return;
      }
      if (video.paused || video.ended) {
        setIsVideoPlaying(false);
        return;
      }
      setVideoCurrentTime(video.currentTime);
      if (Math.abs(video.currentTime - videoPreviewLastSampleRef.current) >= 1 / 15) {
        try {
          sampleCurrentVideoFrame(videoSource);
        } catch {
          // Some browsers briefly report a playable video before the current frame is readable.
        }
      }
      animationFrame = window.requestAnimationFrame(sample);
    };

    animationFrame = window.requestAnimationFrame(sample);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(animationFrame);
    };
  }, [isVideoPlaying, sampleCurrentVideoFrame, videoSource]);

  const isStillImageAnimationActive =
    mediaKind === "image" && stillImageMode === "animate" && store.animation.enabled && Boolean(imageAnimator);

  useEffect(() => {
    if (mediaKind !== "image" || !staticImageData) {
      return;
    }
    if (!isStillImageAnimationActive) {
      setImageData(staticImageData);
    }
  }, [isStillImageAnimationActive, mediaKind, staticImageData]);

  useEffect(() => {
    if (isStillImageAnimationActive) {
      setStatus("Animating still image");
    }
  }, [isStillImageAnimationActive]);

  useEffect(() => {
    if (!store.imageDataUrl || store.imageDataUrl === syncedImageDataUrlRef.current) {
      return;
    }
    // Undo/redo can restore persisted image uploads; video files still require user re-selection by browser design.
    void loadDataUrl(store.imageName, store.imageDataUrl, false);
  }, [loadDataUrl, store.imageDataUrl, store.imageName]);

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) {
        return false;
      }
      const tag = target.tagName.toLowerCase();
      return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const modifier = event.ctrlKey || event.metaKey;

      if (!modifier && !event.altKey && key === "h" && !isEditableTarget(event.target)) {
        event.preventDefault();
        setSidebarVisible((visible) => !visible);
        return;
      }

      if (isEditableTarget(event.target) || !modifier || key !== "z") {
        return;
      }
      event.preventDefault();
      if (event.shiftKey) {
        store.redo();
      } else {
        store.undo();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [store]);

  const glyphMetrics = useMemo(
    () => analyzeGlyphSet(normalizeCharacterSet(store.ascii.charset), store.font),
    [store.ascii.charset, store.font, fontTick]
  );

  const { grid, isProcessing, rendererWarning } = useAsciiProcessor({
    imageData,
    font: store.font,
    ascii: store.ascii,
    image: store.image,
    frame: store.frame,
    breakup: store.breakup,
    color: store.color,
    glyphMetrics
  });

  const createAnimatedPngSnapshot = useCallback(async () => {
    if (!isStillImageAnimationActive || !imageAnimator) {
      return null;
    }

    const animationSettings = {
      ...store.animation,
      enabled: true
    };
    const fps = Math.max(1, Math.min(60, Math.round(animationSettings.fps)));
    const echoStride = 1 + Math.round(Math.min(1, Math.max(0, animationSettings.echoSpacing / 100)) * 7);
    const echoWarmupFrames =
      animationSettings.echoEnabled && animationSettings.echoCount > 0 && animationSettings.echoOpacity > 0
        ? Math.max(1, Math.round(animationSettings.echoCount) * echoStride + 1)
        : 1;
    const duration = echoWarmupFrames / fps;
    let snapshotCanvas: HTMLCanvasElement | null = null;

    for await (const renderedFrame of renderAsciiAnimationFrames({
      duration,
      fps,
      font: store.font,
      ascii: store.ascii,
      image: store.image,
      frame: store.frame,
      breakup: store.breakup,
      color: store.color,
      exportOptions: store.exportOptions,
      exportScale: store.exportScale,
      glyphMetrics,
      animation: animationSettings,
      getFrame: (time) => imageAnimator.render(animationSettings, time)
    })) {
      snapshotCanvas = renderedFrame.canvas;
    }

    return snapshotCanvas ? createCanvasPngBlob(snapshotCanvas, store.frame.dpi) : null;
  }, [
    glyphMetrics,
    imageAnimator,
    isStillImageAnimationActive,
    store.animation,
    store.ascii,
    store.breakup,
    store.color,
    store.exportOptions,
    store.exportScale,
    store.font,
    store.frame,
    store.image
  ]);

  const handleExport = useCallback(async () => {
    if (!grid) {
      return;
    }
    try {
      setStatus("Exporting PNG");
      const animatedSnapshot = await createAnimatedPngSnapshot();
      if (animatedSnapshot) {
        downloadBlob(animatedSnapshot, exportFileName(store.imageName, "png"));
        setStatus("Exported PNG");
        return;
      }
      await exportPng({
        grid,
        font: store.font,
        ascii: store.ascii,
        color: store.color,
        exportOptions: store.exportOptions,
        scale: store.exportScale,
        dpi: store.frame.dpi,
        fileName: exportFileName(store.imageName, "png")
      });
      setStatus("Exported PNG");
    } catch (error) {
      setStatus("Export failed");
    }
  }, [
    createAnimatedPngSnapshot,
    grid,
    store.ascii,
    store.color,
    store.exportOptions,
    store.exportScale,
    store.font,
    store.frame.dpi,
    store.imageName
  ]);

  const handleCopyPng = useCallback(async () => {
    if (!grid) {
      return;
    }
    try {
      if (!navigator.clipboard || typeof ClipboardItem === "undefined") {
        setStatus("PNG clipboard copy is not supported in this browser");
        return;
      }
      setStatus("Copying PNG");
      const blob =
        (await createAnimatedPngSnapshot()) ??
        (await createPngBlob({
          grid,
          font: store.font,
          ascii: store.ascii,
          color: store.color,
          exportOptions: store.exportOptions,
          scale: store.exportScale,
          dpi: store.frame.dpi
        }));
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setStatus("Copied PNG");
    } catch (error) {
      setStatus("Export failed");
    }
  }, [createAnimatedPngSnapshot, grid, store.ascii, store.color, store.exportOptions, store.exportScale, store.font, store.frame.dpi]);

  const handleExportSvg = useCallback(() => {
    if (!grid) {
      return;
    }
    try {
      setStatus("Exporting SVG");
      exportSvg({
        grid,
        font: store.font,
        ascii: store.ascii,
        color: store.color,
        exportOptions: store.exportOptions,
        fileName: exportFileName(store.imageName, "svg")
      });
      setStatus("Exported SVG");
    } catch (error) {
      setStatus("Export failed");
    }
  }, [grid, store.ascii, store.color, store.exportOptions, store.font, store.imageName]);

  const handleToggleVideoPlayback = useCallback(async () => {
    const source = videoSourceRef.current;
    if (!source) {
      return;
    }
    const video = source.element;
    if (!video.paused && !video.ended) {
      video.pause();
      setIsVideoPlaying(false);
      try {
        sampleCurrentVideoFrame(source);
      } catch {
        // Ignore transient decode gaps when pausing.
      }
      return;
    }

    try {
      if (video.ended || (Number.isFinite(video.duration) && video.currentTime >= video.duration)) {
        await seekVideo(video, 0);
        sampleCurrentVideoFrame(source);
      }
      await video.play();
      setIsVideoPlaying(true);
      setStatus("Playing video preview");
    } catch (error) {
      setIsVideoPlaying(false);
      setStatus(error instanceof Error ? error.message : "Video playback failed");
    }
  }, [sampleCurrentVideoFrame]);

  const handleVideoSeek = useCallback(
    async (time: number) => {
      const source = videoSourceRef.current;
      if (!source) {
        return;
      }
      const video = source.element;
      const wasPlaying = !video.paused && !video.ended;
      try {
        video.pause();
        setIsVideoPlaying(false);
        await seekVideo(video, time);
        sampleCurrentVideoFrame(source);
        setStatus(`Video frame ${formatTime(video.currentTime)} / ${formatTime(source.duration)}`);
        if (wasPlaying) {
          await video.play();
          setIsVideoPlaying(true);
        }
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Video seek failed");
      }
    },
    [sampleCurrentVideoFrame]
  );

  const handleExportVideoFormat = useCallback(async (preferredExtension: VideoExportExtension) => {
    const source = videoSourceRef.current;
    if (!source || isExportingVideo) {
      return;
    }

    const controller = new AbortController();
    videoExportAbortRef.current = controller;
    setIsExportingVideo(true);
    setVideoExportProgress(0);
    source.element.pause();
    setIsVideoPlaying(false);
    setStatus(preferredExtension === "mp4" ? "Exporting MP4" : "Exporting WebM");

    try {
      const result = await exportAsciiVideo({
        video: source.element,
        sourceName: source.name,
        font: store.font,
        ascii: store.ascii,
        image: store.image,
        frame: store.frame,
        breakup: store.breakup,
        color: store.color,
        exportOptions: store.exportOptions,
        exportScale: 1,
        glyphMetrics,
        fps: store.animation.fps,
        quality: store.exportOptions.animatedExportQuality,
        preferredExtension,
        allowFormatFallback: true,
        signal: controller.signal,
        onProgress: setVideoExportProgress,
        onStatus: setStatus
      });
      setStatus(
        result.usedFallback && preferredExtension === "mp4"
          ? "MP4 is not supported in this browser. Exported WebM instead."
          : `Exported ${result.extension.toUpperCase()}`
      );
    } catch (error) {
      if (preferredExtension === "mp4") {
        console.error("[ASCII Studio MP4] Video export failed", error);
      }
      setStatus(isAbortError(error) ? "Video export canceled" : preferredExtension === "mp4" ? mp4FailureStatus(error) : "Export failed");
    } finally {
      videoExportAbortRef.current = null;
      setIsExportingVideo(false);
      setVideoExportProgress(0);
    }
  }, [
    glyphMetrics,
    isExportingVideo,
    store.ascii,
    store.animation.fps,
    store.breakup,
    store.color,
    store.exportOptions,
    store.font,
    store.frame,
    store.image
  ]);

  const handleExportVideo = useCallback(() => {
    void handleExportVideoFormat("webm");
  }, [handleExportVideoFormat]);

  const handleExportVideoMp4 = useCallback(() => {
    void handleExportVideoFormat("mp4");
  }, [handleExportVideoFormat]);

  const handleExportAnimationFormat = useCallback(async (preferredExtension: VideoExportExtension) => {
    if (!staticImageData || !imageAnimator || isExportingVideo) {
      return;
    }

    const controller = new AbortController();
    videoExportAbortRef.current = controller;
    setIsExportingVideo(true);
    setVideoExportProgress(0);
    setStatus(preferredExtension === "mp4" ? "Exporting MP4 animation" : "Exporting WebM animation");

    try {
      const animationSettings = {
        ...store.animation,
        enabled: true
      };
      const result = await exportAsciiFrameSequence({
        sourceName: store.imageName,
        fileSuffix: "ascii-animation",
        frameLabel: "animation",
        prerenderFrames: true,
        duration: animationSettings.loopDuration,
        font: store.font,
        ascii: store.ascii,
        image: store.image,
        frame: store.frame,
        breakup: store.breakup,
        color: store.color,
        exportOptions: store.exportOptions,
        exportScale: 1,
        glyphMetrics,
        animation: animationSettings,
        fps: animationSettings.fps,
        quality: store.exportOptions.animatedExportQuality,
        preferredExtension,
        allowFormatFallback: true,
        signal: controller.signal,
        onProgress: setVideoExportProgress,
        onStatus: setStatus,
        getFrame: (time) => imageAnimator.render(animationSettings, time)
      });
      setStatus(
        result.usedFallback && preferredExtension === "mp4"
          ? "MP4 is not supported in this browser. Exported WebM instead."
          : `Exported ${result.extension.toUpperCase()}`
      );
    } catch (error) {
      if (preferredExtension === "mp4") {
        console.error("[ASCII Studio MP4] Animation export failed", error);
      }
      setStatus(isAbortError(error) ? "Animation export canceled" : preferredExtension === "mp4" ? mp4FailureStatus(error) : "Export failed");
    } finally {
      videoExportAbortRef.current = null;
      setIsExportingVideo(false);
      setVideoExportProgress(0);
    }
  }, [
    glyphMetrics,
    imageAnimator,
    isExportingVideo,
    staticImageData,
    store.animation,
    store.ascii,
    store.breakup,
    store.color,
    store.exportOptions,
    store.font,
    store.frame,
    store.image,
    store.imageName
  ]);

  const handleExportAnimation = useCallback(() => {
    void handleExportAnimationFormat("webm");
  }, [handleExportAnimationFormat]);

  const handleExportAnimationMp4 = useCallback(() => {
    void handleExportAnimationFormat("mp4");
  }, [handleExportAnimationFormat]);

  const handleExportAnimationGif = useCallback(async () => {
    if (!staticImageData || !imageAnimator || isExportingVideo) {
      return;
    }

    const controller = new AbortController();
    videoExportAbortRef.current = controller;
    setIsExportingVideo(true);
    setVideoExportProgress(0);

    try {
      const animationSettings = {
        ...store.animation,
        enabled: true
      };
      await exportAsciiGif({
        sourceName: store.imageName,
        duration: animationSettings.loopDuration,
        font: store.font,
        ascii: store.ascii,
        image: store.image,
        frame: store.frame,
        breakup: store.breakup,
        color: store.color,
        exportOptions: store.exportOptions,
        exportScale: 1,
        glyphMetrics,
        animation: animationSettings,
        fps: animationSettings.fps,
        quality: store.exportOptions.animatedExportQuality,
        signal: controller.signal,
        onProgress: setVideoExportProgress,
        onStatus: setStatus,
        getFrame: (time) => imageAnimator.render(animationSettings, time)
      });
      setStatus("Exported GIF");
    } catch (error) {
      setStatus(isAbortError(error) ? "GIF export canceled" : "Export failed");
    } finally {
      videoExportAbortRef.current = null;
      setIsExportingVideo(false);
      setVideoExportProgress(0);
    }
  }, [
    glyphMetrics,
    imageAnimator,
    isExportingVideo,
    staticImageData,
    store.animation,
    store.ascii,
    store.breakup,
    store.color,
    store.exportOptions,
    store.font,
    store.frame,
    store.image,
    store.imageName
  ]);

  const handleStillImageModeChange = useCallback(
    (mode: StillImageMode) => {
      if (mediaKind !== "image") {
        return;
      }
      setStillImageMode(mode);
      if (mode === "animate") {
        store.updateAnimation({ enabled: true });
      } else if (staticImageData) {
        setImageData(staticImageData);
      }
    },
    [mediaKind, staticImageData, store]
  );

  const handleCancelVideoExport = useCallback(() => {
    videoExportAbortRef.current?.abort();
    setStatus("Canceling video export");
  }, []);

  const showAnimationExports = mediaKind === "image" && stillImageMode === "animate" && store.animation.enabled && Boolean(staticImageData);

  return (
    <div className="relative flex h-dvh min-h-[680px] overflow-hidden bg-ink font-sans text-zinc-100">
      <div className="relative h-full min-w-0 flex-1">
        <StudioCanvas
          grid={grid}
          mediaKey={`${mediaKind}:${mediaVersion}`}
          font={store.font}
          ascii={store.ascii}
          color={store.color}
          image={store.image}
          frame={store.frame}
          frameFitKey={`${store.frame.aspectRatio}:${store.frame.customCanvasWidth}:${store.frame.customCanvasHeight}`}
          breakup={store.breakup}
          animation={store.animation}
          glyphMetrics={glyphMetrics}
          isProcessing={isProcessing}
          rendererWarning={rendererWarning}
          status={rendererWarning || status}
          onMediaFile={handleMediaFile}
          videoPlayback={{
            isVideo: mediaKind === "video" && Boolean(videoSource),
            isPlaying: isVideoPlaying,
            currentTime: videoCurrentTime,
            duration: videoDuration
          }}
          onToggleVideoPlayback={handleToggleVideoPlayback}
          onVideoSeek={handleVideoSeek}
          animatedImageRenderer={imageAnimator}
          animateStillImageActive={isStillImageAnimationActive}
          onAnimationPerformanceWarning={setStatus}
          toneRangePreview={toneRangePreview}
        />
        <TopLeftActions
          grid={grid}
          imageName={store.imageName}
          onMediaFile={handleMediaFile}
          onExport={handleExport}
          onCopyPng={handleCopyPng}
          onExportSvg={handleExportSvg}
          onExportVideo={handleExportVideo}
          onExportVideoMp4={handleExportVideoMp4}
          onExportAnimation={handleExportAnimation}
          onExportAnimationMp4={handleExportAnimationMp4}
          onExportAnimationGif={handleExportAnimationGif}
          onCancelVideoExport={handleCancelVideoExport}
          isVideoLoaded={mediaKind === "video" && Boolean(videoSource)}
          showAnimationExports={showAnimationExports}
          isProcessing={isProcessing}
          isExportingVideo={isExportingVideo}
          videoExportProgress={videoExportProgress}
          animationFps={store.animation.fps}
          animationDuration={store.animation.loopDuration}
          animationType={store.animation.type}
          videoDuration={videoDuration}
          status={status}
        />
      </div>
      <div className="pointer-events-none relative z-30 flex h-full w-12 shrink-0 justify-center pt-6">
        <button
          type="button"
          aria-label={sidebarVisible ? "Hide controls" : "Show controls"}
          title={sidebarVisible ? "Hide controls (H)" : "Show controls (H)"}
          className="group pointer-events-auto relative grid h-10 w-10 place-items-center rounded-2xl border border-white/[0.06] bg-panel text-zinc-400 transition-colors duration-150 hover:border-white/[0.12] hover:bg-white/[0.055] hover:text-zinc-100"
          onClick={() => setSidebarVisible((visible) => !visible)}
        >
          {sidebarVisible ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}
          <span className="pointer-events-none absolute right-12 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-xl border border-white/[0.06] bg-panel px-3 py-2 text-xs text-zinc-300 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
            {sidebarVisible ? "Hide controls" : "Show controls"}
          </span>
        </button>
      </div>
      <div
        className={`h-full shrink-0 overflow-hidden transition-[width,opacity] duration-200 ease-out ${
          sidebarVisible ? "w-[380px] max-w-[42vw] opacity-100" : "w-0 opacity-0 pointer-events-none"
        }`}
        aria-hidden={!sidebarVisible}
      >
        <RightSidebar
          grid={grid}
          onFontFile={handleFontFile}
          canAnimateImage={mediaKind === "image" && Boolean(staticImageData)}
          stillImageMode={stillImageMode}
          onStillImageModeChange={handleStillImageModeChange}
          onToneRangePreviewChange={setToneRangePreview}
        />
      </div>
    </div>
  );
}
