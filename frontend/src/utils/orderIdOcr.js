import { mergeResolveResults, resolveOrderId } from "./orderIdScan";

let workerPromise = null;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("eng", 1, {
        logger: () => {},
        workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js",
        corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core-simd-lstm.wasm.js",
      });
      await worker.setParameters({
        tessedit_char_whitelist: "0123456789",
        tessedit_pageseg_mode: "7",
      });
      return worker;
    })();
  }
  return workerPromise;
}

async function ocrCanvas(canvas) {
  const worker = await getWorker();
  const enhanced = enhanceForOcr(canvas);
  const recognize = worker.recognize(enhanced);
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error("ocr timeout")), 12000);
  });
  const { data: { text } } = await Promise.race([recognize, timeout]);
  return text;
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
    { x: 0, y: height * 0.3, w: width, h: height * 0.55 },
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
  const canvas = cropCanvas(source, 0, 0, width, height);
  return enhanceForOcr(canvas);
}
