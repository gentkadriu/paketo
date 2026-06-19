import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Camera, X } from "lucide-react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { useI18n } from "../context/I18nContext";
import { decodeOrderIdFromFile, decodeOrderIdFromVideoFrame } from "../utils/orderIdDecode";
import { resolveOrderId } from "../utils/orderIdScan";

export { extractOrderId, AKS_ORDER_ID_RE } from "../utils/orderIdScan";

const SCAN_FORMATS = [Html5QrcodeSupportedFormats.CODE_128];
const SCANNER_REGION_ID = "paketo-barcode-scanner";
const CAMERA_START_TIMEOUT_MS = 20000;
const OCR_INTERVAL_MS = 1800;

const HTML5_SCAN_CONFIG = {
  fps: 20,
  disableFlip: true,
};

async function warmUpCameraAccess() {
  const tries = [
    { video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } },
    { video: { facingMode: "user" } },
    { video: true },
  ];
  for (const constraints of tries) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      stream.getTracks().forEach((track) => track.stop());
      await new Promise((resolve) => setTimeout(resolve, 200));
      return;
    } catch {
      // try next
    }
  }
  throw new Error("Camera permission denied");
}

function sortCameras(cameras) {
  return [...cameras].sort((a, b) => {
    const score = (label) => {
      const text = (label || "").toLowerCase();
      if (/back|rear|environment/.test(text)) return 0;
      if (/front|user|facetime|integrated/.test(text)) return 1;
      return 2;
    };
    return score(a.label) - score(b.label);
  });
}

function supportsNativeBarcode() {
  return typeof window !== "undefined" && "BarcodeDetector" in window;
}

async function startNativeBarcodeScanner(regionId, onRawCode) {
  const host = document.getElementById(regionId);
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

  // eslint-disable-next-line no-undef
  const detector = new BarcodeDetector({ formats: ["code_128"] });
  let active = true;

  const tick = async () => {
    if (!active) return;
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      try {
        const codes = await detector.detect(video);
        for (const code of codes) {
          if (onRawCode(code.rawValue || "")) {
            active = false;
            stream.getTracks().forEach((track) => track.stop());
            return;
          }
        }
      } catch {
        // skip frame
      }
    }
    if (active) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  return {
    kind: "native",
    video,
    stop: async () => {
      active = false;
      stream.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
    },
  };
}

async function startHtml5Scanner(onRawCode) {
  await warmUpCameraAccess();

  const host = document.getElementById(SCANNER_REGION_ID);
  if (!host) throw new Error("Scanner element missing");
  host.innerHTML = "";

  const cameras = await Html5Qrcode.getCameras();
  if (!cameras.length) throw new Error("No cameras found");

  let lastError = null;
  for (const camera of sortCameras(cameras)) {
    const scanner = new Html5Qrcode(SCANNER_REGION_ID, {
      formatsToSupport: SCAN_FORMATS,
      verbose: false,
    });
    try {
      await scanner.start(camera.id, HTML5_SCAN_CONFIG, onRawCode, () => {});
      return {
        kind: "html5",
        video: null,
        stop: async () => {
          try { await scanner.stop(); } catch { /* ignore */ }
          try { await scanner.clear(); } catch { /* ignore */ }
        },
      };
    } catch (err) {
      lastError = err;
      try { await scanner.clear(); } catch { /* ignore */ }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError ?? new Error("Camera unavailable");
}

async function startLiveScanner(onRawCode) {
  if (supportsNativeBarcode()) {
    try {
      return await startNativeBarcodeScanner(SCANNER_REGION_ID, onRawCode);
    } catch {
      // fall through
    }
  }
  return startHtml5Scanner(onRawCode);
}

export function OrderIdScanButton({ onOpen, disabled = false, className = "" }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onOpen();
      }}
      className={`icon-btn !h-9 !w-9 shrink-0 text-themed-muted hover:text-indigo-500 ${className}`}
      title={t("batch.scanBarcode")}
      aria-label={t("batch.scanBarcode")}
    >
      <Camera className="h-4 w-4" />
    </button>
  );
}

export function OrderIdScannerModal({ open, onClose, onScan }) {
  const { t } = useI18n();
  const fileRef = useRef(null);
  const scannerRef = useRef(null);
  const ocrTimerRef = useRef(null);
  const handled = useRef(false);
  const startTokenRef = useRef(0);
  const [error, setError] = useState("");
  const [mode, setMode] = useState("starting");
  const [fallbackHint, setFallbackHint] = useState("");
  const [candidates, setCandidates] = useState([]);
  const [ocrBusy, setOcrBusy] = useState(false);
  const ocrBusyRef = useRef(false);

  const finishScan = useCallback((orderId) => {
    if (navigator.vibrate) navigator.vibrate(40);
    onScan(orderId);
  }, [onScan]);

  const applyResolved = useCallback((result) => {
    if (!result) return false;
    if (result.exact) {
      handled.current = true;
      setCandidates([]);
      finishScan(result.exact);
      scannerRef.current?.stop().catch(() => {});
      return true;
    }
    if (result.candidates?.length === 1) {
      handled.current = true;
      setCandidates([]);
      finishScan(result.candidates[0]);
      scannerRef.current?.stop().catch(() => {});
      return true;
    }
    if (result.candidates?.length > 1) {
      setCandidates(result.candidates);
      setError("");
      return true;
    }
    return false;
  }, [finishScan]);

  const stopScanner = useCallback(async () => {
    if (ocrTimerRef.current) {
      clearInterval(ocrTimerRef.current);
      ocrTimerRef.current = null;
    }
    const scanner = scannerRef.current;
    scannerRef.current = null;
    if (!scanner) return;
    try { await scanner.stop(); } catch { /* ignore */ }
  }, []);

  const runOcrOnVideo = useCallback(async (video) => {
    if (!video || handled.current || ocrBusyRef.current) return;
    ocrBusyRef.current = true;
    setOcrBusy(true);
    try {
      const result = await decodeOrderIdFromVideoFrame(video);
      applyResolved(result);
    } finally {
      ocrBusyRef.current = false;
      setOcrBusy(false);
    }
  }, [applyResolved]);

  const handlePhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError("");
    setCandidates([]);
    setOcrBusy(true);
    try {
      const result = await decodeOrderIdFromFile(file);
      if (!applyResolved(result)) {
        setError(t("batch.scanNoBarcode"));
      }
    } catch {
      setError(t("batch.scanNoBarcode"));
    } finally {
      setOcrBusy(false);
    }
  };

  const startCamera = useCallback(async () => {
    const token = ++startTokenRef.current;
    setError("");
    setFallbackHint("");
    setCandidates([]);
    setMode("starting");

    if (!window.isSecureContext) {
      setFallbackHint(t("batch.scanNeedHttps"));
      setMode("fallback");
      return;
    }

    let timeoutId = null;
    try {
      timeoutId = window.setTimeout(() => {
        if (token !== startTokenRef.current) return;
        stopScanner();
        setFallbackHint(t("batch.scanLiveFailed"));
        setMode("fallback");
      }, CAMERA_START_TIMEOUT_MS);

      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (token !== startTokenRef.current) return;

      const onRawCode = (raw) => {
        if (handled.current) return false;
        return applyResolved(resolveOrderId(raw));
      };

      const scanner = await startLiveScanner(onRawCode);
      if (token !== startTokenRef.current) {
        try { await scanner.stop(); } catch { /* ignore */ }
        return;
      }

      window.clearTimeout(timeoutId);
      scannerRef.current = scanner;
      setMode("live");

      if (scanner.video) {
        ocrTimerRef.current = window.setInterval(() => {
          runOcrOnVideo(scanner.video);
        }, OCR_INTERVAL_MS);
      }
    } catch {
      if (token !== startTokenRef.current) return;
      window.clearTimeout(timeoutId);
      await stopScanner();
      setFallbackHint(t("batch.scanCameraError"));
      setMode("fallback");
    }
  }, [applyResolved, runOcrOnVideo, stopScanner, t]);

  useEffect(() => {
    if (!open) return undefined;
    document.body.style.overflow = "hidden";
    handled.current = false;
    startCamera();
    return () => {
      document.body.style.overflow = "";
      startTokenRef.current += 1;
      stopScanner();
    };
  }, [open, startCamera, stopScanner]);

  if (!open) return null;

  const modal = (
    <div className="scanner-overlay" role="dialog" aria-modal="true">
      <div className="scanner-header">
        <div className="min-w-0 pr-2">
          <h2 className="font-display text-lg font-bold text-white">{t("batch.scanBarcode")}</h2>
          <p className="text-sm text-white/75 mt-1">
            {mode === "live" ? t("batch.scanLiveHint") : t("batch.scanFrameHint")}
          </p>
        </div>
        <button type="button" onClick={onClose} className="scanner-close" aria-label={t("common.cancel")}>
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="scanner-viewport">
        <div id={SCANNER_REGION_ID} className="scanner-region" />

        {mode === "live" && (
          <div className="scanner-frame-wrap" aria-hidden="true">
            <div className="scanner-frame-box scanner-frame-box--barcode">
              <span className="scanner-corner scanner-corner-tl" />
              <span className="scanner-corner scanner-corner-tr" />
              <span className="scanner-corner scanner-corner-bl" />
              <span className="scanner-corner scanner-corner-br" />
            </div>
          </div>
        )}

        {mode === "starting" && (
          <div className="scanner-loading">
            <p className="text-white">{t("batch.scanStarting")}</p>
            <p className="mt-2 text-xs text-white/60">{t("batch.scanAllowCamera")}</p>
          </div>
        )}

        {mode === "fallback" && (
          <div className="scanner-fallback-panel">
            <p className="text-white/90 text-sm text-center px-6 leading-relaxed">{fallbackHint}</p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={startCamera}
                className="scanner-photo-btn !w-auto !px-6 !bg-white/10 !bg-none border border-white/20"
              >
                {t("batch.scanRetryCamera")}
              </button>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="scanner-photo-btn !w-auto !px-6"
              >
                {t("batch.scanSnapPhoto")}
              </button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handlePhoto}
            />
          </div>
        )}
      </div>

      {ocrBusy && mode === "live" && (
        <p className="scanner-ocr-status">{t("batch.scanReadingDigits")}</p>
      )}

      {candidates.length > 0 && (
        <div className="scanner-candidates">
          <p className="text-xs text-white/70 mb-2">{t("batch.scanPickId")}</p>
          <div className="flex flex-col gap-1.5">
            {candidates.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  handled.current = true;
                  finishScan(id);
                  stopScanner();
                }}
                className="scanner-candidate-btn"
              >
                {id}
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="scanner-footer font-mono">917XXXXXXXXXXX</p>

      {error && <p className="scanner-error">{error}</p>}
    </div>
  );

  return createPortal(modal, document.body);
}
