import { NOTEBOOK_SITE_FAVICON_MAX_LENGTH } from "@ponder/shared";

/**
 * Turns an uploaded image into a small square PNG data URL for a notebook
 * site's favicon. Larger sizes are tried first; the first one under the stored
 * size cap wins. Returns null when the image can't be decoded or never fits.
 */
export const resizeFaviconFile = async (file: File): Promise<string | null> => {
  if (!file.type.startsWith("image/")) return null;
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    const width = image.naturalWidth || 64;
    const height = image.naturalHeight || 64;
    for (const size of [64, 48, 32]) {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d");
      if (!context) return null;
      // Fit the whole image into the square, centred, keeping transparency.
      const scale = Math.min(size / width, size / height);
      const drawWidth = width * scale;
      const drawHeight = height * scale;
      context.imageSmoothingQuality = "high";
      context.drawImage(image, (size - drawWidth) / 2, (size - drawHeight) / 2, drawWidth, drawHeight);
      const dataUrl = canvas.toDataURL("image/png");
      if (dataUrl.startsWith("data:image/png;base64,") && dataUrl.length <= NOTEBOOK_SITE_FAVICON_MAX_LENGTH) return dataUrl;
    }
    return null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
};
