import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";

export default function ActionMenu({
  label,
  icon: Icon,
  items,
  className = "",
  disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState(null);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);

  const updateMenuPosition = () => {
    const btn = buttonRef.current;
    if (!btn) return;

    const rect = btn.getBoundingClientRect();
    const gap = 8;
    const menuHeight = menuRef.current?.offsetHeight ?? items.length * 44 + 12;
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < menuHeight + gap && rect.top > menuHeight + gap;

    setMenuStyle({
      position: "fixed",
      left: rect.left,
      width: Math.max(rect.width, 220),
      top: openUp ? rect.top - menuHeight - gap : rect.bottom + gap,
      zIndex: 9999,
    });
  };

  useLayoutEffect(() => {
    if (!open) {
      setMenuStyle(null);
      return;
    }
    updateMenuPosition();
  }, [open, items.length]);

  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(updateMenuPosition);
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e) => {
      if (
        !rootRef.current?.contains(e.target)
        && !menuRef.current?.contains(e.target)
      ) {
        setOpen(false);
      }
    };
    const onReposition = () => setOpen(false);

    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("scroll", onReposition, true);
    window.addEventListener("resize", onReposition);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("scroll", onReposition, true);
      window.removeEventListener("resize", onReposition);
    };
  }, [open]);

  const menu = open && menuStyle && createPortal(
    <div
      ref={menuRef}
      style={menuStyle}
      className="animate-fade-in overflow-hidden rounded-2xl border border-indigo-500/20 bg-[#0f1424]/98 py-1.5 shadow-2xl shadow-black/60 backdrop-blur-2xl ring-1 ring-white/10"
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          disabled={item.disabled}
          onClick={() => {
            item.onClick();
            setOpen(false);
          }}
          className="mx-1.5 flex w-[calc(100%-12px)] items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-slate-200 transition hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {item.icon && (
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5 text-slate-400">
              <item.icon className="h-4 w-4" />
            </span>
          )}
          <span className="flex-1">
            <span className="block font-medium">{item.label}</span>
            {item.hint && (
              <span className="mt-0.5 block text-xs text-slate-500">{item.hint}</span>
            )}
          </span>
        </button>
      ))}
    </div>,
    document.body,
  );

  return (
    <div ref={rootRef} className={className}>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm font-medium transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-40 ${
          open
            ? "border-indigo-500/50 bg-indigo-500/10 text-white ring-2 ring-indigo-500/25"
            : "border-white/10 bg-gradient-to-b from-white/[0.08] to-white/[0.03] text-slate-200 hover:border-white/20 hover:from-white/[0.1] hover:to-white/[0.05]"
        }`}
      >
        {Icon && <Icon className="h-4 w-4 text-indigo-300" />}
        {label}
        <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${open ? "rotate-180 text-indigo-400" : ""}`} />
      </button>
      {menu}
    </div>
  );
}
