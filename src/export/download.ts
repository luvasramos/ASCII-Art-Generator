const isLikelySafari = () =>
  typeof navigator !== "undefined" &&
  /^((?!chrome|android|crios|fxios|edg|opr|brave).)*safari/i.test(navigator.userAgent);

const openBlobFallback = (url: string) => {
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) {
    window.location.href = url;
  }
};

export const downloadBlob = (blob: Blob, fileName: string) => {
  const legacyNavigator = navigator as Navigator & {
    msSaveOrOpenBlob?: (blob: Blob, defaultName?: string) => boolean;
  };

  if (typeof legacyNavigator.msSaveOrOpenBlob === "function") {
    legacyNavigator.msSaveOrOpenBlob(blob, fileName);
    return;
  }

  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    throw new Error("This browser cannot create export download URLs.");
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.rel = "noopener";
  anchor.target = "_blank";

  try {
    if ("download" in anchor) {
      anchor.download = fileName;
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } else {
      openBlobFallback(url);
    }
  } catch (error) {
    openBlobFallback(url);
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), isLikelySafari() ? 60_000 : 5_000);
  }
};
