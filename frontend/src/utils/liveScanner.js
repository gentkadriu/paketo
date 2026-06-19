import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { decodeOrderIdFromSource } from "./orderIdDecode";
import { canvasFromVideo, preloadOcrWorker } from "./orderIdOcr";
import { resolveOrderId } from "./orderIdScan";

const SCAN_FORMATS = [Html5QrcodeSupportedFormats.CODE_128];

let ocrBusy = false;

async function runOcrPass(video, applyResolved) {
  if (ocrBusy) return false;
  const canvas = canvasFromVideo(video);
  if (!canvas) return false;
  ocrBusy = true;
  try {
    return applyResolved(await decodeOrderIdFromSource(canvas));
  } catch {
    return false;
  } finally {
    ocrBusy = false;
  }
}

function findScannerVideo(containerId) {
  const host = document.getElementById(containerId);
  return host?.querySelector("video") || null;
}

/**
 * Html5Qrcode live Code 128 + parallel OCR on high-res frames.
 * Optimized for AKS thermal labels (barcode + 917… digits below).
 */
export async function startLiveVideoScanner(containerId, applyResolved, onStatus) {
  preloadOcrWorker();
  onStatus?.("camera");

  const host = document.getElementById(containerId);
  if (!host) throw new Error("Scanner element missing");
  host.innerHTML = "";

  const html5 = new Html5Qrcode(containerId, {
    formatsToSupport: SCAN_FORMATS,
    verbose: false,
  });

  let active = true;
  let ocrTimer = null;
  let fastOcrTimer = null;

  const stop = async () => {
    active = false;
    if (ocrTimer) clearInterval(ocrTimer);
    if (fastOcrTimer) clearInterval(fastOcrTimer);
    try {
      if (html5.isScanning()) await html5.stop();
    } catch { /* ignore */ }
    try { html5.clear(); } catch { /* ignore */ }
  };

  const onDecoded = (raw) => {
    if (!active) return;
    if (applyResolved(resolveOrderId(raw))) {
      stop().catch(() => {});
    }
  };

  const qrbox = (viewfinderWidth, viewfinderHeight) => ({
    width: Math.floor(viewfinderWidth * 0.9),
    height: Math.floor(Math.min(viewfinderHeight * 0.28, 160)),
  });

  await html5.start(
    {
      facingMode: { ideal: "environment" },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
    {
      fps: 14,
      qrbox,
      disableFlip: false,
      aspectRatio: 1.7777778,
    },
    onDecoded,
    () => {},
  );

  onStatus?.("scanning");

  const video = findScannerVideo(containerId);
  if (video) {
    fastOcrTimer = window.setInterval(async () => {
      if (!active) return;
      const v = findScannerVideo(containerId);
      if (!v) return;
      if (await runOcrPass(v, applyResolved)) await stop();
    }, 900);

    ocrTimer = window.setInterval(async () => {
      if (!active) return;
      onStatus?.("ocr");
      const v = findScannerVideo(containerId);
      if (!v) return;
      if (await runOcrPass(v, applyResolved)) await stop();
      else onStatus?.("scanning");
    }, 2800);
  }

  const captureNow = async () => {
    if (!active) return false;
    onStatus?.("ocr");
    const v = findScannerVideo(containerId);
    if (!v) return false;
    const ok = await runOcrPass(v, applyResolved);
    if (!ok) onStatus?.("scanning");
    return ok;
  };

  return { video: findScannerVideo(containerId), stop, captureNow };
}
