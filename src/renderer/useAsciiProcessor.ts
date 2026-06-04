import { useEffect, useRef, useState } from "react";
import type {
  AsciiSettings,
  BreakupSettings,
  ColorSettings,
  FontSettings,
  FrameSettings,
  GlyphMetric,
  ImageSettings,
  RenderGrid,
  WorkerRequest,
  WorkerResponse
} from "./types";
import { applyRenderResolutionToGeometry, getRenderResolutionScale, measureCellGeometry } from "./geometry";
import { generateRenderGrid } from "../processing/renderGrid";
import { getTargetAspectRatio } from "../presets/aspectRatios";

declare global {
  interface Window {
    __ASCII_STANDALONE__?: boolean;
  }

  const __ASCII_STANDALONE__: boolean | undefined;
}

const isStandaloneBuild = () =>
  typeof __ASCII_STANDALONE__ !== "undefined" && __ASCII_STANDALONE__ === true;

interface ProcessorArgs {
  imageData: ImageData | null;
  font: FontSettings;
  ascii: AsciiSettings;
  image: ImageSettings;
  frame: FrameSettings;
  breakup: BreakupSettings;
  color: ColorSettings;
  glyphMetrics: GlyphMetric[];
}

export const useAsciiProcessor = ({ imageData, font, ascii, image, frame, breakup, color, glyphMetrics }: ProcessorArgs) => {
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const [grid, setGrid] = useState<RenderGrid | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [rendererWarning, setRendererWarning] = useState<string | null>(null);

  useEffect(() => {
    if (isStandaloneBuild() || window.__ASCII_STANDALONE__ || window.location.protocol === "file:") {
      workerRef.current = null;
      setRendererWarning("Standalone mode: using the main-thread renderer.");
      return undefined;
    }

    if (typeof Worker === "undefined") {
      setRendererWarning("Web Workers are unavailable; using the main-thread renderer.");
      return undefined;
    }

    try {
      workerRef.current = new Worker(new URL("../workers/asciiWorker.ts", import.meta.url), {
        type: "module"
      });
    } catch (error) {
      workerRef.current = null;
      setRendererWarning(
        error instanceof Error
          ? `Worker startup failed; using the main-thread renderer. ${error.message}`
          : "Worker startup failed; using the main-thread renderer."
      );
    }

    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!imageData || !glyphMetrics.length) {
      return;
    }

    const id = requestIdRef.current + 1;
    requestIdRef.current = id;
    setIsProcessing(true);
    let cancelled = false;

    const geometry = applyRenderResolutionToGeometry(
      measureCellGeometry(
        imageData.width,
        imageData.height,
        getTargetAspectRatio(
          frame.aspectRatio,
          imageData.width,
          imageData.height,
          frame.customCanvasWidth,
          frame.customCanvasHeight
        ),
        font,
        ascii.characterDensity,
        ascii.spacingX,
        ascii.spacingY,
        ascii.cellSpacing,
        frame.aspectRatio !== "free"
          ? { width: frame.customCanvasWidth, height: frame.customCanvasHeight }
          : null,
        ascii.glyphMode
      ),
      ascii.renderResolution
    );

    const request: WorkerRequest = {
      id,
      imageData,
      options: {
        columns: geometry.columns,
        rows: geometry.rows,
        cellWidth: geometry.cellWidth,
        cellHeight: geometry.cellHeight,
        gapX: geometry.gapX,
        gapY: geometry.gapY,
        image,
        frame,
        breakup,
        ascii,
        color,
        glyphMetrics
      }
    };

    const renderOnMainThread = () => {
      window.setTimeout(() => {
        if (cancelled || id !== requestIdRef.current) {
          return;
        }
        try {
          setGrid(generateRenderGrid(imageData, request.options));
        } catch (error) {
          setRendererWarning(error instanceof Error ? error.message : "Renderer failed.");
        } finally {
          setIsProcessing(false);
        }
      }, 0);
    };

    const worker = workerRef.current;
    if (!worker) {
      renderOnMainThread();
      return () => {
        cancelled = true;
      };
    }

    let didFallback = false;
    const disableWorker = () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };

    const fallbackToMainThread = (message: string) => {
      if (didFallback || cancelled || id !== requestIdRef.current) {
        return;
      }
      didFallback = true;
      setRendererWarning(message);
      disableWorker();
      renderOnMainThread();
    };

    const timeout = window.setTimeout(() => {
      try {
        worker.postMessage(request);
      } catch (error) {
        fallbackToMainThread(
          error instanceof Error
            ? `Worker message failed; using the main-thread renderer. ${error.message}`
            : "Worker message failed; using the main-thread renderer."
        );
      }
    }, 55);

    const resolutionScale = getRenderResolutionScale(ascii.renderResolution);
    const responseTimeout = window.setTimeout(() => {
      fallbackToMainThread("Worker response timed out; using the main-thread renderer.");
    }, Math.max(450, Math.min(12000, Math.round(2500 * resolutionScale * resolutionScale))));

    const handleMessage = (event: MessageEvent<WorkerResponse>) => {
      if (didFallback || event.data.id !== requestIdRef.current) {
        return;
      }
      window.clearTimeout(responseTimeout);
      setGrid(event.data.grid);
      setIsProcessing(false);
    };

    const handleWorkerFailure = (event: ErrorEvent | MessageEvent) => {
      window.clearTimeout(responseTimeout);
      fallbackToMainThread(
        "message" in event && typeof event.message === "string"
          ? `Worker failed; using the main-thread renderer. ${event.message}`
          : "Worker failed; using the main-thread renderer."
      );
    };

    worker.addEventListener("message", handleMessage);
    worker.addEventListener("error", handleWorkerFailure);
    worker.addEventListener("messageerror", handleWorkerFailure);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      window.clearTimeout(responseTimeout);
      worker.removeEventListener("message", handleMessage);
      worker.removeEventListener("error", handleWorkerFailure);
      worker.removeEventListener("messageerror", handleWorkerFailure);
    };
  }, [ascii, breakup, color, font, frame, glyphMetrics, image, imageData]);

  return {
    grid,
    isProcessing,
    rendererWarning
  };
};
