import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
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
import { resolveOrderIdFromImageSource } from "./orderIdOcr";

function enhancedCanvasFromSource(source) {
  const canvas = canvasFromSource(source);
  if (!canvas) return null;
  return enhanceForScan(upscaleCanvas(canvas));
}

const SCAN_FORMATS = [Html5QrcodeSupportedFormats.CODE_128];
const ZXING_HINTS = new Map([
  [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128]],
  [DecodeHintType.TRY_HARDER, true],
]);

let zxingReader = null;
function getZxingReader() {
  if (!zxingReader) zxingReader = new BrowserMultiFormatReader(ZXING_HINTS, 250);
  return zxingReader;
}

function supportsNativeBarcode() {
  return typeof window !== "undefined" && "BarcodeDetector" in window;
}

async function detectBarcodeOnCanvas(canvas) {
  if (!supportsNativeBarcode() || !canvas) return null;
  try {
    // eslint-disable-next-line no-undef
    const detector = new BarcodeDetector({ formats: ["code_128"] });
    const codes = await detector.detect(canvas);
    if (codes.length) return codes[0].rawValue || "";
  } catch {
    // ignore
  }
  return null;
}

function zxingDecodeCanvas(canvas) {
  try {
    const reader = getZxingReader();
    const result = reader.decodeFromCanvas(canvas);
    return result?.getText() || "";
  } catch {
    return "";
  }
}

async function html5DecodeCanvas(canvas) {
  const blob = await new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/jpeg", 0.9);
  });
  if (!blob) return { exact: null, candidates: [] };

  const tempId = "barcode-file-decode";
  let host = document.getElementById(tempId);
  if (!host) {
    host = document.createElement("div");
    host.id = tempId;
    host.style.display = "none";
    document.body.appendChild(host);
  }
  const scanner = new Html5Qrcode(tempId, { formatsToSupport: SCAN_FORMATS, verbose: false });
  try {
    const text = await scanner.scanFile(blob, false);
    return resolveOrderId(text);
  } catch {
    return { exact: null, candidates: [] };
  } finally {
    try { scanner.clear(); } catch { /* ignore */ }
  }
}

async function barcodePassOnCanvas(canvas) {
  const results = [];
  const native = await detectBarcodeOnCanvas(canvas);
  if (native) results.push(resolveOrderId(native));

  const zxing = zxingDecodeCanvas(canvas);
  if (zxing) results.push(resolveOrderId(zxing));

  results.push(await html5DecodeCanvas(canvas));
  return mergeResolveResults(...results);
}

async function quickBarcodePass(source) {
  const results = [];
  const enhanced = enhancedCanvasFromSource(source);
  if (enhanced) {
    results.push(await barcodePassOnCanvas(enhanced));
    const native = await detectBarcodeOnCanvas(enhanced);
    if (native) results.push(resolveOrderId(native));
  }
  const canvas = canvasFromSource(source);
  if (canvas) {
    const native = await detectBarcodeOnCanvas(canvas);
    if (native) results.push(resolveOrderId(native));
    const zxing = zxingDecodeCanvas(canvas);
    if (zxing) results.push(resolveOrderId(zxing));
  }
  return mergeResolveResults(...results);
}

async function fullDecodePass(source) {
  const results = [];
  const width = source.videoWidth || source.naturalWidth || source.width;
  const height = source.videoHeight || source.naturalHeight || source.height;
  if (width && height) {
    const regions = scanRegionsForSize(width, height);
    for (const key of ["digits", "digitsWide", "barcode"]) {
      try {
        const crop = cropRegion(source, regions[key]);
        const enhanced = enhancedCanvasFromSource(crop) || crop;
        results.push(await barcodePassOnCanvas(enhanced));
      } catch {
        // continue
      }
    }
  }

  for (const variant of buildScanVariants(source).slice(0, 3)) {
    results.push(await barcodePassOnCanvas(variant));
  }

  results.push(await resolveOrderIdFromImageSource(source, { quick: false }));
  return mergeResolveResults(...results);
}

export async function decodeOrderIdFromSource(source, { quick = false } = {}) {
  const barcode = await quickBarcodePass(source);
  if (barcode.exact) return barcode;

  if (quick) {
    const ocr = await resolveOrderIdFromImageSource(source, { quick: true });
    return mergeResolveResults(barcode, ocr);
  }

  return mergeResolveResults(barcode, await fullDecodePass(source));
}

export async function decodeOrderIdFromFile(file) {
  const bitmap = await createImageBitmap(file);
  try {
    return await decodeOrderIdFromSource(bitmap, { quick: false });
  } finally {
    bitmap.close();
  }
}

export async function decodeOrderIdFromVideoFrame(video) {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth) {
    return { exact: null, candidates: [] };
  }
  const canvas = canvasFromVideo(video);
  if (!canvas) return { exact: null, candidates: [] };
  return decodeOrderIdFromSource(canvas, { quick: false });
}
