import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
import { decodeOrderIdFromSource } from "./orderIdDecode";
import { canvasFromVideo, preloadOcrWorker } from "./orderIdOcr";
import { resolveOrderId } from "./orderIdScan";

const ZXING_HINTS = new Map([
  [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128]],
  [DecodeHintType.TRY_HARDER, true],
]);

function supportsNativeBarcode() {
  return typeof window !== "undefined" && "BarcodeDetector" in window;
}

async function openCameraStream() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Camera not supported in this browser.");
  }
  const attempts = [
    { video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } },
    { video: { facingMode: "environment" } },
    { video: { facingMode: "user" } },
    { video: true },
  ];
  let lastError = null;
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("Could not open camera.");
}

let ocrBusy = false;

async function decodeFrame(video, applyResolved) {
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

/**
 * Native getUserMedia video + parallel decoders (BarcodeDetector, ZXing, OCR).
 * Html5Qrcode camera mode is avoided — it often fails on iOS without prompting.
 */
export async function startLiveVideoScanner(containerId, applyResolved, onStatus) {
  preloadOcrWorker();
  onStatus?.("camera");

  const host = document.getElementById(containerId);
  if (!host) throw new Error("Scanner element missing");
  host.innerHTML = "";

  const video = document.createElement("video");
  video.playsInline = true;
  video.setAttribute("playsinline", "true");
  video.setAttribute("webkit-playsinline", "true");
  video.muted = true;
  video.autoplay = true;
  video.className = "scanner-native-video";
  host.appendChild(video);

  const stream = await openCameraStream();
  video.srcObject = stream;
  try {
    await video.play();
  } catch {
    await new Promise((resolve) => {
      video.onloadedmetadata = () => resolve();
    });
    await video.play();
  }

  let active = true;
  const timers = [];

  const stop = async () => {
    active = false;
    timers.forEach((id) => clearInterval(id));
    stream.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
    host.innerHTML = "";
  };

  const tryRaw = (raw) => {
    if (!active) return true;
    return applyResolved(resolveOrderId(raw));
  };

  onStatus?.("scanning");

  if (supportsNativeBarcode()) {
    // eslint-disable-next-line no-undef
    const detector = new BarcodeDetector({ formats: ["code_128"] });
    const loop = async () => {
      if (!active) return;
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        try {
          const canvas = canvasFromVideo(video);
          const target = canvas || video;
          const codes = await detector.detect(target);
          for (const code of codes) {
            if (tryRaw(code.rawValue || "")) {
              await stop();
              return;
            }
          }
        } catch {
          // next frame
        }
      }
      if (active) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  const zxingReader = new BrowserMultiFormatReader(ZXING_HINTS, 250);
  timers.push(window.setInterval(async () => {
    if (!active || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    try {
      const canvas = canvasFromVideo(video);
      if (!canvas) return;
      const result = zxingReader.decodeFromCanvas(canvas);
      if (result?.getText && tryRaw(result.getText())) {
        await stop();
      }
    } catch {
      // no barcode in frame
    }
  }, 350));

  timers.push(window.setInterval(async () => {
    if (!active) return;
    if (await decodeFrame(video, applyResolved)) await stop();
  }, 1000));

  timers.push(window.setInterval(async () => {
    if (!active) return;
    onStatus?.("ocr");
    if (await decodeFrame(video, applyResolved)) await stop();
    else onStatus?.("scanning");
  }, 2800));

  const captureNow = async () => {
    if (!active) return false;
    onStatus?.("ocr");
    const ok = await decodeFrame(video, applyResolved);
    if (!ok) onStatus?.("scanning");
    return ok;
  };

  return { video, stop, captureNow };
}

export function cameraErrorMessage(err) {
  const name = err?.name || "";
  const msg = String(err?.message || err || "");
  if (name === "NotAllowedError" || /permission|denied|not allowed/i.test(msg)) {
    return "permission";
  }
  if (name === "NotFoundError" || /not found|no camera/i.test(msg)) {
    return "not_found";
  }
  if (name === "NotReadableError" || /in use|busy/i.test(msg)) {
    return "busy";
  }
  return "generic";
}
