import { createContext, useCallback, useContext, useState } from "react";

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);

  const show = useCallback((message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 animate-slide-up rounded-xl border px-5 py-3 text-sm font-medium shadow-2xl ${
            toast.type === "error"
              ? "border-rose-500/40 bg-rose-950/90 text-rose-200"
              : "border-emerald-500/30 bg-slate-900/95 text-emerald-100"
          }`}
        >
          {toast.message}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
