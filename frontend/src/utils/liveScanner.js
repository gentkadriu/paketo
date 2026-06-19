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

let decodeBusy = false;

async function decodeFrame(video, applyResolved) {
  if (decodeBusy) return false;
  const canvas = canvasFromVideo(video);
  if (!canvas) return false;
  decodeBusy = true;
  try {
    return applyResolved(await decodeOrderIdFromSource(canvas));
  } catch {
    return false;
  } finally {
    decodeBusy = false;
  }
}

/**
 * One video stream + every decoder we have (BarcodeDetector, ZXing, OCR).
 * Works on iOS Safari where html5-qrcode alone often misses Code 128.
 */
export async function startLiveVideoScanner(containerId, applyResolved) {
  preloadOcrWorker();

  const host = document.getElementById(containerId);
  if (!host) throw new Error("Scanner element missing");

  host.innerHTML = "";
  const video = document.createElement("video");
  video.playsInline = true;
  video.muted = true;
  video.autoplay = true;
  video.className = "scanner-native-video";
  host.appendChild(video);

  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
  });
  video.srcObject = stream;
  await video.play();

  let active = true;
  const timers = [];

  const stop = async () => {
    active = false;
    timers.forEach((id) => clearInterval(id));
    stream.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
  };

  const tryRaw = (raw) => {
    if (!active) return true;
    return applyResolved(resolveOrderId(raw));
  };

  if (supportsNativeBarcode()) {
    // eslint-disable-next-line no-undef
    const detector = new BarcodeDetector({ formats: ["code_128"] });
    const loop = async () => {
      if (!active) return;
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
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
      const result = await zxingReader.decodeFromCanvas(canvas);
      if (result?.getText && tryRaw(result.getText())) {
        await stop();
      }
    } catch {
      // no barcode in frame
    }
  }, 400));

  timers.push(window.setInterval(async () => {
    if (!active) return;
    if (await decodeFrame(video, applyResolved)) await stop();
  }, 1500));

  const captureNow = async () => {
    if (!active) return false;
    return decodeFrame(video, applyResolved);
  };

  return { video, stop, captureNow };
}
