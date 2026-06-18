import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Camera, X } from "lucide-react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { useI18n } from "../context/I18nContext";

/** AKS receipt barcodes encode a 14-digit ID: 917 + 11 digits. */
const AKS_ORDER_ID_RE = /^917\d{11}$/;
const SCAN_FORMATS = [Html5QrcodeSupportedFormats.CODE_128];
const CAMERA_START_TIMEOUT_MS = 12000;

export function extractOrderId(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (AKS_ORDER_ID_RE.test(digits)) return digits;
  const embedded = digits.match(/917\d{11}/);
  return embedded ? embedded[0] : "";
}

async function decodeBarcodeFile(file) {
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
    return await scanner.scanFile(file, false);
  } finally {
    try { scanner.clear(); } catch { /* ignore */ }
  }
}

/** Camera icon — opens batch-level scanner modal via parent. */
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
  const regionId = useId().replace(/:/g, "");
  const fileRef = useRef(null);
  const scannerRef = useRef(null);
  const handled = useRef(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState("starting"); // starting | live | fallback
  const [fallbackHint, setFallbackHint] = useState("");

  const finishScan = useCallback((orderId) => {
    if (navigator.vibrate) navigator.vibrate(40);
    onScan(orderId);
  }, [onScan]);

  const tryDecode = useCallback((raw) => {
    const orderId = extractOrderId(raw);
    if (!AKS_ORDER_ID_RE.test(orderId)) return false;
    finishScan(orderId);
    return true;
  }, [finishScan]);

  const handlePhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError("");
    try {
      const text = await decodeBarcodeFile(file);
      if (!tryDecode(text)) setError(t("batch.scanNoBarcode"));
    } catch {
      setError(t("batch.scanNoBarcode"));
    }
  };

  useEffect(() => {
    if (!open) return undefined;
    document.body.style.overflow = "hidden";
    handled.current = false;
    setError("");
    setFallbackHint("");
    setMode("starting");
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return undefined;

    let active = true;
    let timeoutId = null;

    const stopScanner = async () => {
      const s = scannerRef.current;
      scannerRef.current = null;
      if (!s) return;
      try { await s.stop(); } catch { /* ignore */ }
      try { await s.clear(); } catch { /* ignore */ }
    };

    const goFallback = (hint) => {
      if (!active) return;
      stopScanner();
      setFallbackHint(hint);
      setMode("fallback");
    };

    const start = async () => {
      if (!window.isSecureContext) {
        goFallback(t("batch.scanNeedHttps"));
        return;
      }

      const host = document.getElementById(regionId);
      if (!host) {
        goFallback(t("batch.scanCameraError"));
        return;
      }

      timeoutId = window.setTimeout(() => {
        goFallback(t("batch.scanLiveFailed"));
      }, CAMERA_START_TIMEOUT_MS);

      const scanner = new Html5Qrcode(regionId, { formatsToSupport: SCAN_FORMATS, verbose: false });
      scannerRef.current = scanner;

      const onBarcode = (decodedText) => {
        if (handled.current) return;
        if (!tryDecode(decodedText)) return;
        handled.current = true;
        scanner.stop().catch(() => {});
      };

      try {
        await scanner.start(
          { facingMode: { ideal: "environment" } },
          {
            fps: 10,
            qrbox: (w, h) => ({
              width: Math.min(Math.floor(w * 0.88), 360),
              height: Math.max(88, Math.floor(Math.min(w, h) * 0.22)),
            }),
          },
          onBarcode,
          () => {},
        );
        window.clearTimeout(timeoutId);
        if (active) setMode("live");
      } catch {
        window.clearTimeout(timeoutId);
        goFallback(t("batch.scanCameraError"));
      }
    };

    start();

    return () => {
      active = false;
      if (timeoutId) window.clearTimeout(timeoutId);
      stopScanner();
    };
  }, [open, regionId, tryDecode, t]);

  if (!open) return null;

  const modal = (
    <div className="scanner-overlay" role="dialog" aria-modal="true">
      <div className="scanner-header">
        <div className="min-w-0 pr-2">
          <h2 className="font-display text-lg font-bold text-white">{t("batch.scanBarcode")}</h2>
          <p className="text-sm text-white/75 mt-1">{t("batch.scanFrameHint")}</p>
        </div>
        <button type="button" onClick={onClose} className="scanner-close" aria-label={t("common.cancel")}>
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="scanner-viewport">
        {/* Must exist in DOM before scanner.start() — was only rendered after "live" before. */}
        <div id={regionId} className="scanner-region" />

        <div className="scanner-frame-wrap" aria-hidden="true">
          <div className="scanner-frame-box">
            <span className="scanner-corner scanner-corner-tl" />
            <span className="scanner-corner scanner-corner-tr" />
            <span className="scanner-corner scanner-corner-bl" />
            <span className="scanner-corner scanner-corner-br" />
            <div className="scanner-scan-line" />
          </div>
        </div>

        {mode === "starting" && (
          <div className="scanner-loading">
            <p className="text-white">{t("batch.scanStarting")}</p>
            <p className="mt-2 text-xs text-white/60">{t("batch.scanAllowCamera")}</p>
          </div>
        )}

        {mode === "fallback" && (
          <div className="scanner-fallback-panel">
            <p className="text-white/90 text-sm text-center px-6 leading-relaxed">{fallbackHint}</p>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handlePhoto}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="scanner-photo-btn mt-4 !w-auto !px-6"
            >
              {t("batch.scanSnapPhoto")}
            </button>
          </div>
        )}
      </div>

      <p className="scanner-footer font-mono">917XXXXXXXXXXX</p>

      {error && <p className="scanner-error">{error}</p>}
    </div>
  );

  return createPortal(modal, document.body);
}
