const supportedTypes = ["image/jpeg", "image/png", "image/webp"];
const supportedExtensions = /\.(jpe?g|png|webp)$/i;

export const isSupportedImage = (file: File) =>
  supportedTypes.includes(file.type) || supportedExtensions.test(file.name);

export const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

export const loadImageElement = (source: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not decode image"));
    image.src = source;
  });

export const imageToPreviewData = (image: HTMLImageElement, maxDimension = 1800) => {
  const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("Canvas2D is unavailable");
  }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
};

export const loadFileAsImage = async (file: File) => {
  if (!isSupportedImage(file)) {
    throw new Error("Unsupported image format");
  }
  const dataUrl = await readFileAsDataUrl(file);
  const image = await loadImageElement(dataUrl);
  return {
    dataUrl,
    image
  };
};
