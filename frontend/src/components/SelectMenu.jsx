import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { useTheme } from "../context/ThemeContext";

export default function SelectMenu({
  value,
  options,
  onChange,
  label,
  icon: Icon,
  className = "",
  disabled = false,
  fullWidth = false,
  compact = false,
}) {
  const { isDark } = useTheme();
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState(null);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);

  const selected = options.find((o) => o.value === value) || options[0];

  const updateMenuPosition = () => {
    const btn = buttonRef.current;
    if (!btn) return;

    const rect = btn.getBoundingClientRect();
    const gap = 8;
    const menuHeight = menuRef.current?.offsetHeight ?? options.length * (compact ? 36 : 52) + 12;
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < menuHeight + gap && rect.top > menuHeight + gap;

    setMenuStyle({
      position: "fixed",
      left: rect.left,
      width: Math.max(rect.width, compact ? 120 : 220),
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
      className={`animate-fade-in overflow-hidden rounded-2xl border py-1.5 shadow-2xl backdrop-blur-2xl ring-1 ${
        isDark
          ? "border-indigo-500/20 bg-[#0f1424]/98 shadow-black/60 ring-white/10"
          : "border-slate-200 bg-white shadow-slate-300/40 ring-slate-200/80"
      }`}
    >
      {options.map((option) => {
        const isSelected = option.value === value;
        const OptionIcon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => {
              onChange(option.value);
              setOpen(false);
            }}
            className={`mx-1.5 flex w-[calc(100%-12px)] items-center gap-2 rounded-xl text-left transition ${
              compact ? "px-2.5 py-2 text-xs" : "gap-3 px-3 py-2.5 text-sm"
            } ${
              isSelected
                ? "bg-indigo-500/15 text-themed"
                : "text-themed-muted hover:bg-themed-hover hover:text-themed"
            }`}
          >
            {OptionIcon && !compact && (
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5 text-slate-400">
                <OptionIcon className="h-4 w-4" />
              </span>
            )}
            <span className="flex-1 min-w-0">
              <span className="block font-medium">{option.label}</span>
              {option.hint && (
                <span className="mt-0.5 block text-xs text-slate-500">{option.hint}</span>
              )}
            </span>
            {isSelected && <Check className={`shrink-0 text-indigo-400 ${compact ? "h-3.5 w-3.5" : "h-4 w-4"}`} />}
          </button>
        );
      })}
    </div>,
    document.body,
  );

  return (
    <div ref={rootRef} className={`${fullWidth ? "w-full" : ""} ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center justify-between gap-1.5 rounded-xl border font-medium transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-40 ${
          fullWidth ? "w-full" : "w-auto"
        } ${
          compact
            ? "min-h-[30px] px-2 py-1 text-xs"
            : "min-h-[48px] gap-2 px-3.5 py-2.5 text-sm"
        } ${
          open
            ? "border-indigo-500/50 bg-indigo-500/10 text-themed ring-2 ring-indigo-500/25"
            : "border-themed bg-themed-hover text-themed hover:border-indigo-500/30"
        }`}
      >
        <span className="flex items-center gap-1.5 truncate">
          {Icon && !compact && <Icon className="h-4 w-4 shrink-0 text-indigo-300" />}
          <span className="truncate">{label || selected?.label}</span>
        </span>
        <ChevronDown className={`shrink-0 text-slate-400 transition-transform ${compact ? "h-3.5 w-3.5" : "h-4 w-4"} ${open ? "rotate-180 text-indigo-400" : ""}`} />
      </button>
      {menu}
    </div>
  );
}
