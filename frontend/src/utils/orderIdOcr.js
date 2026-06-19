import { mergeResolveResults, resolveOrderId } from "./orderIdScan";
import {
  buildScanVariants,
  canvasFromSource,
  canvasFromVideo,
  cropRegion,
  enhanceForScan,
  scanRegionsForSize,
  upscaleCanvas,
} from "./orderIdVision";

import workerURL from "tesseract.js/dist/worker.min.js?url";
import coreURL from "tesseract.js-core/tesseract-core-simd-lstm.wasm.js?url";

let workerPromise = null;
let workerError = null;

async function getWorker() {
  if (workerError) throw workerError;
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker, PSM } = await import("tesseract.js");
      const worker = await createWorker("eng", 1, {
        logger: () => {},
        workerPath: workerURL,
        corePath: coreURL,
        workerBlobURL: true,
      });
      await worker.setParameters({
        tessedit_char_whitelist: "0123456789",
      });
      worker._psmModes = [PSM.SINGLE_LINE, PSM.SINGLE_BLOCK, PSM.SPARSE_TEXT];
      return worker;
    })().catch((err) => {
      workerError = err;
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

/** Warm up Tesseract while the camera starts (first run downloads language data). */
export function preloadOcrWorker() {
  return getWorker().catch(() => {});
}

export function isOcrReady() {
  return Boolean(workerPromise) && !workerError;
}

async function ocrCanvasWithPsm(canvas, psm) {
  const worker = await getWorker();
  await worker.setParameters({ tessedit_pageseg_mode: psm });
  const enhanced = enhanceForScan(upscaleCanvas(canvas, 2));
  const recognize = worker.recognize(enhanced);
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error("ocr timeout")), 18000);
  });
  const { data: { text } } = await Promise.race([recognize, timeout]);
  return text;
}

async function ocrCanvasAllModes(canvas) {
  const worker = await getWorker();
  const modes = worker._psmModes || ["7", "6", "11"];
  const results = [];
  for (const psm of modes) {
    try {
      const text = await ocrCanvasWithPsm(canvas, psm);
      results.push(resolveOrderId(text));
    } catch {
      // try next mode
    }
  }
  return mergeResolveResults(...results);
}

export async function resolveOrderIdFromImageSource(source) {
  const width = source.videoWidth || source.naturalWidth || source.width;
  const height = source.videoHeight || source.naturalHeight || source.height;
  if (!width || !height) return { exact: null, candidates: [] };

  const regions = scanRegionsForSize(width, height);
  const ocrTargets = [
    regions.digits,
    regions.digitsWide,
    regions.barcode,
    regions.frame,
    regions.lowerHalf,
    regions.full,
  ];

  const results = [];
  for (const region of ocrTargets) {
    try {
      const crop = cropRegion(source, region);
      results.push(await ocrCanvasAllModes(crop));
    } catch {
      // worker not ready or timeout
    }
  }

  for (const variant of buildScanVariants(source)) {
    const vRegions = scanRegionsForSize(variant.width, variant.height);
    for (const key of ["digits", "digitsWide", "frame"]) {
      try {
        const crop = cropRegion(variant, vRegions[key]);
        results.push(await ocrCanvasAllModes(crop));
      } catch {
        // continue
      }
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
  const canvas = canvasFromSource(source);
  if (!canvas) return null;
  return enhanceForScan(upscaleCanvas(canvas));
}

export { canvasFromVideo, canvasFromSource, buildScanVariants, cropRegion, scanRegionsForSize };
