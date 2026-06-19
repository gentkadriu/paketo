import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { mergeResolveResults, resolveOrderId } from "./orderIdScan";
import { enhancedCanvasFromSource, resolveOrderIdFromFile, resolveOrderIdFromImageSource } from "./orderIdOcr";

const SCAN_FORMATS = [Html5QrcodeSupportedFormats.CODE_128];

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

async function detectBarcodeOnCanvas(canvas) {
  const raw = await detectBarcodeOnSource(canvas);
  if (raw) return resolveOrderId(raw);
  return { exact: null, candidates: [] };
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

/** Full decode pipeline: native barcode → enhanced barcode → html5 → OCR + repair. */
export async function decodeOrderIdFromFile(file) {
  const bitmap = await createImageBitmap(file);
  const results = [];
  try {
    const native = await detectBarcodeOnSource(bitmap);
    if (native) results.push(resolveOrderId(native));

    const enhanced = enhancedCanvasFromSource(bitmap);
    results.push(await detectBarcodeOnCanvas(enhanced));

    const blob = await canvasToBlob(enhanced);
    if (blob) results.push(await html5DecodeBlob(blob));

    results.push(await resolveOrderIdFromImageSource(bitmap));
  } finally {
    bitmap.close();
  }
  return mergeResolveResults(...results);
}

export async function decodeOrderIdFromVideoFrame(video) {
  const results = [];
  const native = await detectBarcodeOnSource(video);
  if (native) results.push(resolveOrderId(native));

  const enhanced = enhancedCanvasFromSource(video);
  results.push(await detectBarcodeOnCanvas(enhanced));
  results.push(await resolveOrderIdFromImageSource(video));

  return mergeResolveResults(...results);
}

export { resolveOrderIdFromFile };
