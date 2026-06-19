import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Camera, X } from "lucide-react";
import { useI18n } from "../context/I18nContext";
import { decodeOrderIdFromFile } from "../utils/orderIdDecode";
import { preloadOcrWorker } from "../utils/orderIdOcr";
import {
  cameraErrorMessage,
  openCameraStream,
  startLiveScannerOnVideo,
} from "../utils/liveScanner";

export { extractOrderId, AKS_ORDER_ID_RE } from "../utils/orderIdScan";

const CAMERA_START_TIMEOUT_MS = 25000;

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
  const videoRef = useRef(null);
  const scannerRef = useRef(null);
  const handled = useRef(false);
  const startTokenRef = useRef(0);
  const [error, setError] = useState("");
  const [mode, setMode] = useState("starting");
  const [fallbackHint, setFallbackHint] = useState("");
  const [candidates, setCandidates] = useState([]);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [scanStatus, setScanStatus] = useState("");

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
      return false;
    }
    return false;
  }, [finishScan]);

  const stopScanner = useCallback(async () => {
    const scanner = scannerRef.current;
    scannerRef.current = null;
    if (!scanner) return;
    try { await scanner.stop(); } catch { /* ignore */ }
  }, []);

  const captureNow = useCallback(async () => {
    const scanner = scannerRef.current;
    if (!scanner?.captureNow || handled.current) return;
    setOcrBusy(true);
    setError("");
    try {
      const ok = await scanner.captureNow();
      if (!ok && candidates.length === 0) {
        setError(t("batch.scanNoBarcode"));
      }
    } finally {
      setOcrBusy(false);
    }
  }, [candidates.length, t]);

  const handlePhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError("");
    setCandidates([]);
    setOcrBusy(true);
    try {
      const result = await decodeOrderIdFromFile(file);
      if (!applyResolved(result) && !(result.candidates?.length > 1)) {
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
    setScanStatus("");
    setMode("starting");

    if (!window.isSecureContext) {
      setFallbackHint(t("batch.scanNeedHttps"));
      setMode("fallback");
      return;
    }

    await stopScanner();

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

      const video = videoRef.current;
      if (!video) throw new Error("Video element missing");

      const controller = startLiveScannerOnVideo(video, applyResolved, (status) => {
        if (token !== startTokenRef.current) return;
        if (status === "ocr") setScanStatus(t("batch.scanReadingDigits"));
        else if (status === "scanning") setScanStatus(t("batch.scanAutoDetecting"));
        else setScanStatus("");
      });

      const stream = await openCameraStream();
      if (token !== startTokenRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      await controller.attachStream(stream);
      if (token !== startTokenRef.current) {
        await controller.stop();
        return;
      }

      controller.startDecoders();
      window.clearTimeout(timeoutId);
      scannerRef.current = controller;
      setMode("live");
    } catch (err) {
      if (token !== startTokenRef.current) return;
      window.clearTimeout(timeoutId);
      await stopScanner();
      const kind = cameraErrorMessage(err);
      if (kind === "permission") setFallbackHint(t("batch.scanPermissionDenied"));
      else if (kind === "not_found") setFallbackHint(t("batch.scanNoCamera"));
      else if (kind === "busy") setFallbackHint(t("batch.scanCameraBusy"));
      else setFallbackHint(t("batch.scanCameraError"));
      setMode("fallback");
    }
  }, [applyResolved, stopScanner, t]);

  useEffect(() => {
    if (!open) return undefined;
    document.body.style.overflow = "hidden";
    handled.current = false;
    preloadOcrWorker();
    startCamera();
    return () => {
      document.body.style.overflow = "";
      startTokenRef.current += 1;
      stopScanner();
    };
  }, [open, startCamera, stopScanner]);

  if (!open) return null;

  const showPreview = mode === "live" || mode === "starting";

  return createPortal(
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
        {showPreview && (
          <video
            ref={videoRef}
            className="scanner-native-video"
            playsInline
            muted
            autoPlay
          />
        )}

        {mode === "live" && (
          <>
            <div className="scanner-frame-wrap" aria-hidden="true">
              <div className="scanner-frame-box scanner-frame-box--barcode">
                <span className="scanner-corner scanner-corner-tl" />
                <span className="scanner-corner scanner-corner-tr" />
                <span className="scanner-corner scanner-corner-bl" />
                <span className="scanner-corner scanner-corner-br" />
                <span className="scanner-scan-line" />
              </div>
            </div>
            <div className="scanner-live-actions">
              <button type="button" onClick={captureNow} disabled={ocrBusy} className="scanner-photo-btn !text-sm">
                {ocrBusy ? t("batch.scanReadingDigits") : t("batch.scanCaptureNow")}
              </button>
              <button type="button" onClick={() => fileRef.current?.click()} className="scanner-photo-btn !bg-white/10 !bg-none border border-white/20 !text-sm">
                {t("batch.scanSnapPhoto")}
              </button>
            </div>
          </>
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
            <div className="mt-4 flex flex-col gap-2">
              <button type="button" onClick={startCamera} className="scanner-photo-btn !w-auto !px-6 !bg-white/10 !bg-none border border-white/20">
                {t("batch.scanRetryCamera")}
              </button>
              <button type="button" onClick={() => fileRef.current?.click()} className="scanner-photo-btn !w-auto !px-6">
                {t("batch.scanSnapPhoto")}
              </button>
            </div>
          </div>
        )}
      </div>

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
      {scanStatus && mode === "live" && !error && (
        <p className="scanner-ocr-status">{scanStatus}</p>
      )}
      {error && <p className="scanner-error">{error}</p>}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handlePhoto}
      />
    </div>,
    document.body,
  );
}
