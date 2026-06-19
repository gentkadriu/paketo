import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { mergeResolveResults, resolveOrderId } from "./orderIdScan";
import {
  canvasFromVideo,
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
  if (!zxingReader) zxingReader = new BrowserMultiFormatReader(ZXING_HINTS, 500);
  return zxingReader;
}

function supportsNativeBarcode() {
  return typeof window !== "undefined" && "BarcodeDetector" in window;
}

async function detectBarcodeOnSource(source) {
  if (!supportsNativeBarcode()) return null;
  try {
    // eslint-disable-next-line no-undef
    const detector = new BarcodeDetector({ formats: ["code_128"] });
    const codes = await detector.detect(source);
    if (codes.length) return codes[0].rawValue || "";
  } catch {
    // ignore
  }
  return null;
}

async function zxingDecodeSource(source) {
  try {
    const canvas = enhancedCanvasFromSource(source);
    if (!canvas) return "";
    const reader = getZxingReader();
    const result = await reader.decodeFromCanvas(canvas);
    return result?.getText() || "";
  } catch {
    return "";
  }
}

async function html5DecodeBlob(blob) {
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

function canvasToBlob(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.92);
  });
}

export async function decodeOrderIdFromSource(source) {
  const results = [];

  const native = await detectBarcodeOnSource(source);
  if (native) results.push(resolveOrderId(native));

  const zxing = await zxingDecodeSource(source);
  if (zxing) results.push(resolveOrderId(zxing));

  const enhanced = enhancedCanvasFromSource(source);
  if (enhanced) {
    const enhancedNative = await detectBarcodeOnSource(enhanced);
    if (enhancedNative) results.push(resolveOrderId(enhancedNative));

    const blob = await canvasToBlob(enhanced);
    if (blob) results.push(await html5DecodeBlob(blob));
  }

  results.push(await resolveOrderIdFromImageSource(source));
  return mergeResolveResults(...results);
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
