/** Canvas preprocessing for AKS labels (streaked thermal prints, digit bands). */

export function cropCanvas(source, sx, sy, sw, sh) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(sw));
  canvas.height = Math.max(1, Math.floor(sh));
  const ctx = canvas.getContext("2d");
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function upscaleCanvas(source, scale = 2) {
  const w = Math.max(1, Math.floor(source.width * scale));
  const h = Math.max(1, Math.floor(source.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, 0, 0, w, h);
  return canvas;
}

/** Boost contrast for faded / streaked printer digits and barcodes. */
export function enhanceForScan(canvas) {
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  const image = ctx.getImageData(0, 0, width, height);
  const { data } = image;
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const boosted = gray < 95 ? 0 : gray > 175 ? 255 : (gray - 95) * (255 / 80);
    const v = Math.max(0, Math.min(255, boosted));
    data[i] = data[i + 1] = data[i + 2] = v;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/** Fill dead printhead columns (vertical white streak through barcode + digits). */
export function repairVerticalStreaks(canvas) {
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  if (width < 3 || height < 8) return canvas;
  const image = ctx.getImageData(0, 0, width, height);
  const { data } = image;

  for (let x = 1; x < width - 1; x += 1) {
    let dark = 0;
    for (let y = 0; y < height; y += 1) {
      const i = (y * width + x) * 4;
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (gray < 140) dark += 1;
    }
    if (dark / height > 0.04) continue;
    for (let y = 0; y < height; y += 1) {
      const li = (y * width + (x - 1)) * 4;
      const ri = (y * width + (x + 1)) * 4;
      const i = (y * width + x) * 4;
      data[i] = (data[li] + data[ri]) >> 1;
      data[i + 1] = (data[li + 1] + data[ri + 1]) >> 1;
      data[i + 2] = (data[li + 2] + data[ri + 2]) >> 1;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

export function invertCanvas(canvas) {
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  const image = ctx.getImageData(0, 0, width, height);
  const { data } = image;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255 - data[i];
    data[i + 1] = 255 - data[i + 1];
    data[i + 2] = 255 - data[i + 2];
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/** Regions tuned for AKS courier labels (barcode mid-frame, digits just below). */
export function scanRegionsForSize(width, height) {
  const w = width;
  const h = height;
  return {
    full: { x: 0, y: 0, w, h },
    frame: { x: w * 0.06, y: h * 0.28, w: w * 0.88, h: h * 0.48 },
    barcode: { x: w * 0.08, y: h * 0.34, w: w * 0.84, h: h * 0.22 },
    digits: { x: w * 0.06, y: h * 0.52, w: w * 0.88, h: h * 0.18 },
    digitsWide: { x: w * 0.04, y: h * 0.48, w: w * 0.92, h: h * 0.24 },
    lowerHalf: { x: 0, y: h * 0.4, w, h: h * 0.45 },
  };
}

export function canvasFromSource(source) {
  const width = source.videoWidth || source.naturalWidth || source.width;
  const height = source.videoHeight || source.naturalHeight || source.height;
  if (!width || !height) return null;
  return cropCanvas(source, 0, 0, width, height);
}

export function canvasFromVideo(video) {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;
  return canvasFromSource(video);
}

/** Build several preprocessed canvases for parallel barcode/OCR attempts. */
export function buildScanVariants(source) {
  const base = canvasFromSource(source);
  if (!base) return [];

  const streak = repairVerticalStreaks(cropCanvas(base, 0, 0, base.width, base.height));
  const enhanced = enhanceForScan(cropCanvas(base, 0, 0, base.width, base.height));
  const enhancedStreak = enhanceForScan(repairVerticalStreaks(cropCanvas(base, 0, 0, base.width, base.height)));
  const inverted = invertCanvas(enhanceForScan(cropCanvas(base, 0, 0, base.width, base.height)));

  return [base, streak, enhanced, enhancedStreak, inverted];
}

export function cropRegion(source, region) {
  return cropCanvas(source, region.x, region.y, region.w, region.h);
}
