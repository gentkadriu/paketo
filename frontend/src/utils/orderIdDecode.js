import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { mergeResolveResults, resolveOrderId } from "./orderIdScan";
import {
  buildScanVariants,
  canvasFromVideo,
  cropRegion,
  scanRegionsForSize,
} from "./orderIdVision";
import {
  enhancedCanvasFromSource,
  resolveOrderIdFromImageSource,
} from "./orderIdOcr";

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
    canvas.toBlob((b) => resolve(b), "image/jpeg", 0.92);
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

async function barcodePassOnSource(source) {
  const results = [];
  const variants = buildScanVariants(source);
  const width = source.videoWidth || source.naturalWidth || source.width;
  const height = source.videoHeight || source.naturalHeight || source.height;
  const regions = width && height ? scanRegionsForSize(width, height) : null;

  for (const variant of variants) {
    results.push(await barcodePassOnCanvas(variant));
    if (regions) {
      for (const key of ["barcode", "frame", "full"]) {
        const region = scanRegionsForSize(variant.width, variant.height)[key];
        results.push(await barcodePassOnCanvas(cropRegion(variant, region)));
      }
    }
  }

  const enhanced = enhancedCanvasFromSource(source);
  if (enhanced) {
    results.push(await barcodePassOnCanvas(enhanced));
  }

  return mergeResolveResults(...results);
}

export async function decodeOrderIdFromSource(source) {
  const [barcodeResult, ocrResult] = await Promise.all([
    barcodePassOnSource(source),
    resolveOrderIdFromImageSource(source),
  ]);
  return mergeResolveResults(barcodeResult, ocrResult);
}

export async function decodeOrderIdFromFile(file) {
  const bitmap = await createImageBitmap(file);
  try {
    return await decodeOrderIdFromSource(bitmap);
  } finally {
    bitmap.close();
  }
}

export async function decodeOrderIdFromVideoFrame(video) {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    return { exact: null, candidates: [] };
  }
  const canvas = canvasFromVideo(video);
  if (!canvas) return { exact: null, candidates: [] };
  return decodeOrderIdFromSource(canvas);
}
