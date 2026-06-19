import { mergeResolveResults, resolveOrderId } from "./orderIdScan";

let workerPromise = null;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker, PSM } = await import("tesseract.js");
      const worker = await createWorker("eng", 1, {
        logger: () => {},
      });
      await worker.setParameters({
        tessedit_char_whitelist: "0123456789 ",
        tessedit_pageseg_mode: PSM.SINGLE_LINE,
      });
      return worker;
    })();
  }
  return workerPromise;
}

/** Warm up Tesseract while the camera starts (first run downloads ~2 MB). */
export function preloadOcrWorker() {
  return getWorker().catch(() => {});
}

async function ocrCanvas(canvas) {
  const worker = await getWorker();
  const enhanced = enhanceForOcr(upscaleCanvas(canvas));
  const recognize = worker.recognize(enhanced);
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error("ocr timeout")), 15000);
  });
  const { data: { text } } = await Promise.race([recognize, timeout]);
  return text;
}

function upscaleCanvas(source, scale = 2) {
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

function cropCanvas(source, sx, sy, sw, sh) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(sw));
  canvas.height = Math.max(1, Math.floor(sh));
  const ctx = canvas.getContext("2d");
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Boost contrast so faded / streaked printer digits are easier to read. */
function enhanceForOcr(canvas) {
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

function ocrRegionsForSource(width, height) {
  return [
    { x: width * 0.05, y: height * 0.38, w: width * 0.9, h: height * 0.32 },
    { x: 0, y: height * 0.52, w: width, h: height * 0.38 },
    { x: width * 0.05, y: height * 0.62, w: width * 0.9, h: height * 0.22 },
    { x: 0, y: height * 0.28, w: width, h: height * 0.58 },
  ];
}

export async function resolveOrderIdFromImageSource(source) {
  const width = source.videoWidth || source.naturalWidth || source.width;
  const height = source.videoHeight || source.naturalHeight || source.height;
  if (!width || !height) return { exact: null, candidates: [] };

  const results = [];
  for (const region of ocrRegionsForSource(width, height)) {
    try {
      const crop = cropCanvas(source, region.x, region.y, region.w, region.h);
      const text = await ocrCanvas(crop);
      results.push(resolveOrderId(text));
    } catch {
      // try next region
    }
  }
  return mergeResolveResults(...results);
}

export async function resolveOrderIdFromFile(file) {
  const bitmap = await createImageBitmap(file);
  try {
    return await resolveOrderIdFromImageSource(bitmap);
  } finally {
    bitmap.close();
  }
}

export async function resolveOrderIdFromVideoFrame(video) {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    return { exact: null, candidates: [] };
  }
  return resolveOrderIdFromImageSource(video);
}

/** Contrast-boosted copy for barcode re-tries on damaged prints. */
export function enhancedCanvasFromSource(source) {
  const width = source.videoWidth || source.naturalWidth || source.width;
  const height = source.videoHeight || source.naturalHeight || source.height;
  if (!width || !height) return null;
  const canvas = cropCanvas(source, 0, 0, width, height);
  return enhanceForOcr(upscaleCanvas(canvas));
}

export function canvasFromVideo(video) {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(video, 0, 0, width, height);
  return canvas;
}
