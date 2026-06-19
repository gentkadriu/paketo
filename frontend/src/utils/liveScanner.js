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

export async function openCameraStream() {
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

export function waitForVideoReady(video, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const ready = () => video.videoWidth > 0 && video.videoHeight > 0
      && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;

    if (ready()) {
      resolve();
      return;
    }

    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("Camera preview did not start."));
    }, timeoutMs);

    const onReady = () => {
      if (!ready()) return;
      cleanup();
      resolve();
    };

    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeEventListener("loadedmetadata", onReady);
      video.removeEventListener("loadeddata", onReady);
      video.removeEventListener("playing", onReady);
    };

    video.addEventListener("loadedmetadata", onReady);
    video.addEventListener("loadeddata", onReady);
    video.addEventListener("playing", onReady);
  });
}

let ocrBusy = false;

async function decodeFrame(video, applyResolved, quick) {
  if (ocrBusy) return false;
  const canvas = canvasFromVideo(video);
  if (!canvas) return false;
  ocrBusy = true;
  try {
    return applyResolved(await decodeOrderIdFromSource(canvas, { quick }));
  } catch {
    return false;
  } finally {
    ocrBusy = false;
  }
}

/**
 * Attach decoders to a React-managed <video> element (must stay in the DOM).
 */
export function startLiveScannerOnVideo(video, applyResolved, onStatus) {
  preloadOcrWorker();
  onStatus?.("camera");

  let active = true;
  let stream = null;
  const timers = [];
  let rafId = null;

  const stop = async () => {
    active = false;
    timers.forEach((id) => clearInterval(id));
    if (rafId) cancelAnimationFrame(rafId);
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }
    if (video) {
      video.srcObject = null;
    }
  };

  const tryRaw = (raw) => {
    if (!active) return true;
    return applyResolved(resolveOrderId(raw));
  };

  const attachStream = async (mediaStream) => {
    stream = mediaStream;
    video.srcObject = stream;
    video.muted = true;
    try {
      await video.play();
    } catch {
      // iOS may require a second attempt after metadata
    }
    await waitForVideoReady(video);
    onStatus?.("scanning");
  };

  const startDecoders = () => {
    if (supportsNativeBarcode()) {
      // eslint-disable-next-line no-undef
      const detector = new BarcodeDetector({ formats: ["code_128"] });
      const loop = async () => {
        if (!active) return;
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
          try {
            const canvas = canvasFromVideo(video);
            const codes = canvas ? await detector.detect(canvas) : await detector.detect(video);
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
        if (active) rafId = requestAnimationFrame(loop);
      };
      rafId = requestAnimationFrame(loop);
    }

    const zxingReader = new BrowserMultiFormatReader(ZXING_HINTS, 250);
    timers.push(window.setInterval(() => {
      if (!active || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth) return;
      try {
        const canvas = canvasFromVideo(video);
        if (!canvas) return;
        const result = zxingReader.decodeFromCanvas(canvas);
        if (result?.getText && tryRaw(result.getText())) {
          stop().catch(() => {});
        }
      } catch {
        // no barcode in frame
      }
    }, 300));

    timers.push(window.setInterval(async () => {
      if (!active) return;
      if (await decodeFrame(video, applyResolved, true)) await stop();
    }, 700));

    timers.push(window.setInterval(async () => {
      if (!active) return;
      onStatus?.("ocr");
      if (await decodeFrame(video, applyResolved, false)) await stop();
      else onStatus?.("scanning");
    }, 2500));
  };

  const captureNow = async () => {
    if (!active) return false;
    onStatus?.("ocr");
    const ok = await decodeFrame(video, applyResolved, false);
    if (!ok) onStatus?.("scanning");
    return ok;
  };

  return {
    attachStream,
    startDecoders,
    stop,
    captureNow,
  };
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
