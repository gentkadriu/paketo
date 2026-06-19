import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Camera, X } from "lucide-react";
import { useI18n } from "../context/I18nContext";
import { decodeOrderIdFromFile, decodeOrderIdFromVideoFrame } from "../utils/orderIdDecode";
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
  const pickShown = useRef(false);
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

  const collectIds = useCallback((result) => {
    if (!result) return [];
    const ids = [];
    const add = (id) => {
      if (id && !ids.includes(id)) ids.push(id);
    };
    add(result.exact);
    for (const id of result.candidates || []) add(id);
    return ids;
  }, []);

  /** Show picker — never auto-save. Returns false so the camera keeps running. */
  const applyResolved = useCallback((result) => {
    if (!result || pickShown.current || handled.current) return false;
    const ids = collectIds(result);
    if (ids.length === 0) return false;

    pickShown.current = true;
    setCandidates(ids);
    setError("");
    setScanStatus(t("batch.scanConfirmPick"));
    if (navigator.vibrate) navigator.vibrate(30);
    return false;
  }, [collectIds, t]);

  const stopScanner = useCallback(async () => {
    const scanner = scannerRef.current;
    scannerRef.current = null;
    if (!scanner) return;
    try { await scanner.stop(); } catch { /* ignore */ }
  }, []);

  const confirmPick = useCallback((orderId) => {
    handled.current = true;
    pickShown.current = false;
    setCandidates([]);
    finishScan(orderId);
    stopScanner();
  }, [finishScan, stopScanner]);

  const resumeScanning = useCallback(() => {
    pickShown.current = false;
    setCandidates([]);
    setError("");
    setScanStatus(t("batch.scanAutoDetecting"));
  }, [t]);

  const captureNow = useCallback(async () => {
    const scanner = scannerRef.current;
    if (!scanner?.captureNow || handled.current || pickShown.current) return;
    setOcrBusy(true);
    setError("");
    try {
      const video = videoRef.current;
      if (!video) return;
      const result = await decodeOrderIdFromVideoFrame(video);
      const ids = collectIds(result);
      if (ids.length === 0) {
        setError(t("batch.scanNoBarcode"));
      } else {
        pickShown.current = true;
        setCandidates(ids);
        setScanStatus(t("batch.scanConfirmPick"));
        if (navigator.vibrate) navigator.vibrate(30);
      }
    } finally {
      setOcrBusy(false);
    }
  }, [collectIds, t]);

  const handlePhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError("");
    setCandidates([]);
    setOcrBusy(true);
    try {
      const result = await decodeOrderIdFromFile(file);
      const ids = collectIds(result);
      if (ids.length === 0) {
        setError(t("batch.scanNoBarcode"));
      } else {
        pickShown.current = true;
        setCandidates(ids);
        setScanStatus(t("batch.scanConfirmPick"));
        if (navigator.vibrate) navigator.vibrate(30);
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
    pickShown.current = false;
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
    pickShown.current = false;
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
        <div className="scanner-pick-sheet" role="dialog" aria-label={t("batch.scanConfirmPick")}>
          <div className="scanner-pick-sheet-inner">
            <p className="text-sm font-semibold text-white mb-1">{t("batch.scanConfirmPick")}</p>
            <p className="text-xs text-white/65 mb-3">{t("batch.scanConfirmHint")}</p>
            <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto">
              {candidates.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => confirmPick(id)}
                  className="scanner-candidate-btn"
                >
                  {id}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={resumeScanning}
              className="mt-3 w-full rounded-lg border border-white/20 px-3 py-2.5 text-sm text-white/80 hover:bg-white/10"
            >
              {t("batch.scanRescan")}
            </button>
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
