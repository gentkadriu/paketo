import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

export default function Select({
  value,
  onChange,
  options,
  className = "",
  placeholder = "Select…",
  fullWidth = false,
  compact = false,
}) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState(null);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);

  const selected = options.find((o) => o.value === value);
  const SelectedIcon = selected?.icon;

  const updateMenuPosition = () => {
    const btn = buttonRef.current;
    if (!btn) return;

    const rect = btn.getBoundingClientRect();
    const gap = 8;
    const menuHeight = menuRef.current?.offsetHeight ?? options.length * 44 + 12;
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < menuHeight + gap && rect.top > menuHeight + gap;

    setMenuStyle({
      position: "fixed",
      left: rect.left,
      width: Math.max(rect.width, 200),
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
  }, [open, options.length]);

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
      {options.map((opt) => {
        const Icon = opt.icon;
        const isSelected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => {
              onChange(opt.value);
              setOpen(false);
            }}
            className={`mx-1.5 flex w-[calc(100%-12px)] items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${
              isSelected
                ? "bg-gradient-to-r from-indigo-600/25 to-violet-600/15 text-white"
                : "text-slate-300 hover:bg-white/[0.06] hover:text-white"
            }`}
          >
            {Icon && (
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                isSelected ? "bg-indigo-500/20 text-indigo-300" : "bg-white/5 text-slate-400"
              }`}>
                <Icon className="h-4 w-4" />
              </span>
            )}
            <span className="flex-1">
              <span className="block font-medium">{opt.label}</span>
              {opt.hint && (
                <span className="mt-0.5 block text-xs text-slate-500">{opt.hint}</span>
              )}
            </span>
            {isSelected && <Check className="h-4 w-4 shrink-0 text-indigo-400" />}
          </button>
        );
      })}
    </div>,
    document.body,
  );

  const openStyles = compact
    ? "border-indigo-500/55 bg-indigo-500/10"
    : "border-indigo-500/50 bg-indigo-500/10 shadow-lg shadow-indigo-950/30 ring-2 ring-indigo-500/25";

  return (
    <div ref={rootRef} className={`${fullWidth ? "w-full min-w-0" : ""} ${open ? "relative z-10" : ""} ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`box-border flex w-full items-center justify-between gap-2 rounded-xl border text-left transition-all duration-200 ${
          compact ? "min-w-0 px-3 py-2 min-h-[40px] text-sm" : "min-w-[190px] px-3.5 py-2.5 text-sm"
        } ${
          open ? openStyles : "border-themed bg-themed-hover/50 hover:bg-themed-hover"
        }`}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          {SelectedIcon && !compact && (
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-500/15 text-indigo-300">
              <SelectedIcon className="h-3.5 w-3.5" />
            </span>
          )}
          <span className={`truncate font-medium ${selected ? "text-themed" : "text-themed-muted"}`}>
            {selected?.label ?? placeholder}
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-themed-muted transition-transform duration-200 ${open ? "rotate-180 text-indigo-400" : ""}`}
        />
      </button>
      {menu}
    </div>
  );
}
