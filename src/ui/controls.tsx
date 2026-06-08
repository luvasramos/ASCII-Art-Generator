import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, RotateCcw } from "lucide-react";
import { evaluateNumberExpression } from "../utils/numberExpression";

interface VisualEditingPreviewControls {
  start?: (reason: string) => void;
  end?: () => void;
  pulse?: (reason: string) => void;
}

const VisualEditingPreviewContext = createContext<VisualEditingPreviewControls>({});

export const VisualEditingPreviewProvider = ({
  value,
  children
}: {
  value: VisualEditingPreviewControls;
  children: ReactNode;
}) => (
  <VisualEditingPreviewContext.Provider value={value}>{children}</VisualEditingPreviewContext.Provider>
);

const useVisualEditingPreview = () => useContext(VisualEditingPreviewContext);

interface SectionProps {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  summary?: string;
  simple?: boolean;
  order?: number;
}

export const Section = ({ title, icon, children, defaultOpen = false, summary, simple = false, order }: SectionProps) => {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section
      style={typeof order === "number" ? { order } : undefined}
      className="relative rounded-2xl border border-white/[0.06] bg-panel2"
    >
      <button
        type="button"
        className="group flex w-full items-center justify-between gap-4 px-5 py-3.5 text-left"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="flex min-w-0 items-center gap-3">
          {icon && (
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-white/[0.04] text-zinc-400 transition-colors duration-150 group-hover:bg-white/[0.07] group-hover:text-zinc-200">
              {icon}
            </span>
          )}
          <span className="min-w-0">
            <span className="block text-sm font-semibold tracking-tight text-zinc-100">{title}</span>
            {!open && summary && <span className="mt-0.5 block truncate text-xs text-zinc-500">{summary}</span>}
          </span>
        </span>
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.14, ease: "easeOut" }}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-zinc-500 transition-colors duration-150 group-hover:bg-white/[0.045] group-hover:text-zinc-200"
        >
          <ChevronDown size={16} />
        </motion.span>
      </button>
      {simple ? (
        open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.12, ease: "easeOut" }}
            className="space-y-4 px-5 pb-5"
          >
            {children}
          </motion.div>
        )
      ) : (
        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.16, ease: "easeOut" }}
              className="overflow-hidden"
            >
              <div className="space-y-4 px-5 pb-5">{children}</div>
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </section>
  );
};

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
  resetValue?: number;
  resetTitle?: string;
}

export const Slider = ({
  label,
  value,
  min,
  max,
  step = 0.01,
  unit = "",
  disabled = false,
  onChange,
  onInteractionStart,
  onInteractionEnd,
  resetValue,
  resetTitle
}: SliderProps) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [resetPulse, setResetPulse] = useState(0);
  const interactingRef = useRef(false);
  const visualEditingPreview = useVisualEditingPreview();
  const fill = ((value - min) / Math.max(0.0001, max - min)) * 100;
  const style = { "--slider-fill": `${Math.min(100, Math.max(0, fill))}%` } as CSSProperties;
  const displayValue = Number.isInteger(step) ? String(Math.round(value)) : value.toFixed(2);
  const canReset = !disabled && typeof resetValue === "number" && Math.abs(value - resetValue) > 0.0001;

  useEffect(() => {
    if (!editing) {
      setDraft(`${displayValue}${unit}`);
    }
  }, [displayValue, editing, unit]);

  const applyDraft = () => {
    const nextValue = evaluateNumberExpression(draft);
    if (typeof nextValue === "number") {
      visualEditingPreview.pulse?.(`Slider: ${label}`);
      onChange(Math.min(max, Math.max(min, nextValue)));
    }
    setEditing(false);
  };

  const handleValueKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.currentTarget.blur();
    }
    if (event.key === "Escape") {
      setDraft(`${displayValue}${unit}`);
      setEditing(false);
    }
  };

  const beginInteraction = () => {
    if (disabled || interactingRef.current) {
      return;
    }
    interactingRef.current = true;
    visualEditingPreview.start?.(`Slider: ${label}`);
    onInteractionStart?.();
  };

  const endInteraction = () => {
    if (!interactingRef.current) {
      return;
    }
    interactingRef.current = false;
    onInteractionEnd?.();
    visualEditingPreview.end?.();
  };

  return (
    <label className={`block ${disabled ? "opacity-55" : ""}`}>
      <div className="mb-2 flex items-center justify-between gap-3 text-xs">
        <span className="font-medium text-zinc-300">{label}</span>
        <span className="flex items-center gap-1.5">
          {editing ? (
            <input
              autoFocus
              className="h-7 w-20 rounded-lg border border-signal/40 bg-black/30 px-3 text-right text-xs tabular-nums text-zinc-100 outline-none focus:shadow-focus"
              value={draft}
              onBlur={applyDraft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleValueKeyDown}
            />
          ) : (
            <button
              type="button"
              className="rounded-lg px-2 py-1 text-right text-xs tabular-nums text-zinc-500 transition-colors duration-150 hover:bg-white/[0.055] hover:text-zinc-100"
              onClick={() => {
                if (!disabled) {
                  setDraft(`${displayValue}${unit}`);
                  setEditing(true);
                }
              }}
            >
              {displayValue}
              {unit}
            </button>
          )}
          <motion.button
            type="button"
            className="grid h-7 w-7 place-items-center rounded-lg text-zinc-600 transition-colors duration-150 hover:bg-white/[0.055] hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-30"
            title={resetTitle ?? `Reset ${label}`}
            disabled={!canReset}
            animate={{ rotate: resetPulse * -90 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            onClick={() => {
              if (typeof resetValue === "number") {
                setResetPulse((pulse) => pulse + 1);
                visualEditingPreview.pulse?.(`Reset slider: ${label}`);
                onChange(resetValue);
              }
            }}
          >
            <RotateCcw size={13} />
          </motion.button>
        </span>
      </div>
      <input
        className="h-5 w-full cursor-pointer"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={style}
        disabled={disabled}
        onPointerDown={beginInteraction}
        onPointerUp={endInteraction}
        onPointerCancel={endInteraction}
        onBlur={endInteraction}
        onKeyDown={beginInteraction}
        onKeyUp={endInteraction}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
};

interface SelectProps {
  label: string;
  value: string;
  options: { label: string; value: string }[];
  disabled?: boolean;
  onChange: (value: string) => void;
}

export const Select = ({ label, value, options, disabled, onChange }: SelectProps) => (
  <CustomSelect label={label} value={value} options={options} disabled={disabled} onChange={onChange} />
);

const CustomSelect = ({ label, value, options, disabled = false, onChange }: SelectProps) => {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(Math.max(0, options.findIndex((option) => option.value === value)));
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const visualEditingPreview = useVisualEditingPreview();
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    setActiveIndex(Math.max(0, options.findIndex((option) => option.value === value)));
  }, [options, value]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const updateMenuStyle = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }
      const menuHeight = Math.min(224, options.length * 40 + 8);
      const shouldFlip = rect.bottom + 8 + menuHeight > window.innerHeight && rect.top > menuHeight + 8;
      setMenuStyle({
        position: "fixed",
        zIndex: 9999,
        left: rect.left,
        top: shouldFlip ? rect.top - menuHeight - 8 : rect.bottom + 8,
        width: rect.width,
        maxHeight: menuHeight
      });
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        rootRef.current &&
        !rootRef.current.contains(target) &&
        listRef.current &&
        !listRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    updateMenuStyle();
    window.addEventListener("resize", updateMenuStyle);
    window.addEventListener("scroll", updateMenuStyle, true);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("resize", updateMenuStyle);
      window.removeEventListener("scroll", updateMenuStyle, true);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [open, options.length]);

  const choose = (nextValue: string) => {
    if (nextValue !== value) {
      visualEditingPreview.pulse?.(`Select: ${label}`);
    }
    onChange(nextValue);
    setOpen(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => {
        const direction = event.key === "ArrowDown" ? 1 : -1;
        return (index + direction + options.length) % Math.max(1, options.length);
      });
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open && options[activeIndex]) {
        choose(options[activeIndex].value);
      } else {
        setOpen(true);
      }
    }
    if (event.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <span className="mb-2 block text-xs font-medium text-zinc-400">{label}</span>
      <button
        type="button"
        className="flex h-10 w-full items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-black/25 px-3 text-left text-sm text-zinc-100 outline-none transition hover:border-white/[0.1] focus:border-signal/50 focus:shadow-focus disabled:cursor-not-allowed disabled:opacity-45"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={handleKeyDown}
      >
        <span className="min-w-0 truncate">{selected?.label ?? "Select"}</span>
        <ChevronDown
          size={16}
          className={`shrink-0 text-zinc-500 transition ${open ? "rotate-180 text-signal" : ""}`}
        />
      </button>
      {open && menuStyle && createPortal(
        <div
          ref={listRef}
          className="overflow-y-auto rounded-xl border border-white/[0.08] bg-[#111114] p-1 shadow-focus"
          role="listbox"
          style={menuStyle}
        >
          {options.map((option, index) => {
            const selectedOption = option.value === value;
            const active = index === activeIndex;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selectedOption}
                className={`flex min-h-9 w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${
                  selectedOption
                    ? "bg-signal/15 text-signal"
                    : active
                    ? "bg-white/[0.065] text-zinc-100"
                    : "text-zinc-400 hover:bg-white/[0.055] hover:text-zinc-100"
                }`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(option.value)}
              >
                <span className="min-w-0 truncate">{option.label}</span>
                {selectedOption && <Check size={14} className="shrink-0" />}
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
};

interface ToggleProps {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}

export const Toggle = ({ label, checked, disabled, onChange }: ToggleProps) => {
  const visualEditingPreview = useVisualEditingPreview();
  return (
    <label className={`flex items-center justify-between gap-3 text-sm text-zinc-300 ${disabled ? "opacity-45" : ""}`}>
      <span>{label}</span>
      <button
        className={`relative h-7 w-12 shrink-0 rounded-full border transition ${
          checked ? "border-signal/50 bg-signal/20" : "border-white/[0.08] bg-black/25"
        }`}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => {
          if (!disabled) {
            visualEditingPreview.pulse?.(`Toggle: ${label}`);
            onChange(!checked);
          }
        }}
      >
        <motion.span
          className="absolute inset-y-0 left-0 flex items-center"
          animate={{ x: checked ? 22 : 4 }}
          transition={{ duration: 0.14, ease: "easeOut" }}
        >
          <span className="block h-5 w-5 rounded-full bg-zinc-100" />
        </motion.span>
      </button>
    </label>
  );
};

interface ColorInputProps {
  label: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}

const clampChannel = (value: number) => Math.min(255, Math.max(0, Math.round(value)));
const clampUnit = (value: number) => Math.min(1, Math.max(0, value));

const normalizeHex = (value: string) => {
  const clean = value.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(clean)) {
    return `#${clean.split("").map((part) => part + part).join("")}`.toUpperCase();
  }
  if (/^[0-9a-f]{6}$/i.test(clean)) {
    return `#${clean}`.toUpperCase();
  }
  return null;
};

const hexToRgb = (value: string) => {
  const hex = normalizeHex(value) ?? "#000000";
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16)
  };
};

const rgbToHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((channel) => clampChannel(channel).toString(16).padStart(2, "0")).join("")}`.toUpperCase();

const rgbToHsv = ({ r, g, b }: { r: number; g: number; b: number }) => {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let h = 0;
  if (delta) {
    if (max === red) {
      h = 60 * (((green - blue) / delta) % 6);
    } else if (max === green) {
      h = 60 * ((blue - red) / delta + 2);
    } else {
      h = 60 * ((red - green) / delta + 4);
    }
  }
  return {
    h: h < 0 ? h + 360 : h,
    s: max === 0 ? 0 : delta / max,
    v: max
  };
};

const hsvToRgb = (h: number, s: number, v: number) => {
  const chroma = v * s;
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - chroma;
  let red = 0;
  let green = 0;
  let blue = 0;
  if (h < 60) {
    red = chroma;
    green = x;
  } else if (h < 120) {
    red = x;
    green = chroma;
  } else if (h < 180) {
    green = chroma;
    blue = x;
  } else if (h < 240) {
    green = x;
    blue = chroma;
  } else if (h < 300) {
    red = x;
    blue = chroma;
  } else {
    red = chroma;
    blue = x;
  }
  return {
    r: clampChannel((red + m) * 255),
    g: clampChannel((green + m) * 255),
    b: clampChannel((blue + m) * 255)
  };
};

export const ColorInput = ({ label, value, disabled, onChange }: ColorInputProps) => {
  const [open, setOpen] = useState(false);
  const [draftHex, setDraftHex] = useState(value);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({});
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const svBoxRef = useRef<HTMLDivElement | null>(null);
  const colorInteractingRef = useRef(false);
  const visualEditingPreview = useVisualEditingPreview();
  const normalized = normalizeHex(value) ?? "#000000";
  const rgb = hexToRgb(normalized);
  const hsv = rgbToHsv(rgb);
  const hueRgb = hsvToRgb(hsv.h, 1, 1);
  const hueColor = rgbToHex(hueRgb.r, hueRgb.g, hueRgb.b);

  useEffect(() => {
    setDraftHex(normalized);
  }, [normalized]);

  useEffect(() => {
    if (!open) {
      if (colorInteractingRef.current) {
        colorInteractingRef.current = false;
        visualEditingPreview.end?.();
      }
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        rootRef.current &&
        !rootRef.current.contains(target) &&
        popoverRef.current &&
        !popoverRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open, visualEditingPreview]);

  const beginColorInteraction = () => {
    if (disabled || colorInteractingRef.current) {
      return;
    }
    colorInteractingRef.current = true;
    visualEditingPreview.start?.(`Color: ${label}`);
  };

  const endColorInteraction = () => {
    if (!colorInteractingRef.current) {
      return;
    }
    colorInteractingRef.current = false;
    visualEditingPreview.end?.();
  };

  useEffect(() => {
    if (!open) {
      return;
    }
    const updatePosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }
      const width = 288;
      const estimatedHeight = 294;
      const gap = 8;
      const margin = 12;
      const left = Math.min(window.innerWidth - width - margin, Math.max(margin, rect.right - width));
      const hasRoomBelow = rect.bottom + gap + estimatedHeight <= window.innerHeight - margin;
      const top = hasRoomBelow
        ? rect.bottom + gap
        : Math.max(margin, Math.min(window.innerHeight - estimatedHeight - margin, rect.top - estimatedHeight - gap));
      setPopoverStyle({ left, top, width });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  const commitHex = (nextValue: string) => {
    const next = normalizeHex(nextValue);
    if (next) {
      onChange(next);
      setDraftHex(next);
    } else {
      setDraftHex(normalized);
    }
  };

  const updateHue = (nextHue: number) => {
    const next = hsvToRgb(
      nextHue,
      hsv.s <= 0.02 ? 0.82 : clampUnit(hsv.s),
      hsv.v <= 0.08 ? 0.72 : clampUnit(hsv.v)
    );
    onChange(rgbToHex(next.r, next.g, next.b));
  };

  const updateSaturationValue = (clientX: number, clientY: number) => {
    const rect = svBoxRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    const nextSaturation = clampUnit((clientX - rect.left) / rect.width);
    const nextValue = clampUnit(1 - (clientY - rect.top) / rect.height);
    const next = hsvToRgb(hsv.h, nextSaturation, nextValue);
    onChange(rgbToHex(next.r, next.g, next.b));
  };

  const handleSaturationValuePointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    beginColorInteraction();
    updateSaturationValue(event.clientX, event.clientY);
  };

  return (
    <div ref={rootRef} className={`relative ${disabled ? "opacity-45" : ""}`}>
      <div className="flex items-center justify-between gap-3 text-sm text-zinc-300">
        <span className="min-w-0 truncate">{label}</span>
        <button
          ref={buttonRef}
          type="button"
          disabled={disabled}
          className="flex h-10 min-w-[96px] items-center justify-between gap-2 rounded-xl border border-white/[0.08] bg-black/25 px-2.5 text-xs tabular-nums text-zinc-300 transition hover:border-white/[0.14] hover:bg-white/[0.055] focus:border-signal/50 focus:outline-none focus:shadow-focus disabled:cursor-not-allowed"
          onClick={() => setOpen((visible) => !visible)}
        >
          <span className="h-6 w-6 rounded-lg border border-white/[0.12]" style={{ backgroundColor: normalized }} />
          <span>{normalized}</span>
        </button>
      </div>
      {open && !disabled && createPortal(
        <div
          ref={popoverRef}
          className="fixed z-[1000] rounded-2xl border border-white/[0.08] bg-[#131316] p-3 shadow-focus"
          style={popoverStyle}
        >
          <div
            ref={svBoxRef}
            className="relative h-40 w-full touch-none cursor-crosshair overflow-hidden rounded-xl border border-white/[0.08]"
            style={{ backgroundColor: hueColor }}
            onPointerDown={handleSaturationValuePointer}
            onPointerUp={endColorInteraction}
            onPointerCancel={endColorInteraction}
            onPointerMove={(event) => {
              if (event.buttons === 1) {
                updateSaturationValue(event.clientX, event.clientY);
              }
            }}
          >
            <div
              className="pointer-events-none absolute inset-0"
              style={{ background: "linear-gradient(90deg, #ffffff, rgba(255,255,255,0))" }}
            />
            <div
              className="pointer-events-none absolute inset-0"
              style={{ background: "linear-gradient(0deg, #000000, rgba(0,0,0,0))" }}
            />
            <div
              className="pointer-events-none absolute h-4 w-4 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.65),0_4px_12px_rgba(0,0,0,0.35)]"
              style={{
                left: `${hsv.s * 100}%`,
                top: `${(1 - hsv.v) * 100}%`,
                transform: "translate(-50%, -50%)",
                backgroundColor: normalized
              }}
            />
          </div>
          <label className="mt-4 block">
            <span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-zinc-500">Hue</span>
            <input
              className="color-hue-slider h-5 w-full cursor-pointer"
              type="range"
              min={0}
              max={359}
              step={1}
              value={Math.round(hsv.h)}
              onPointerDown={beginColorInteraction}
              onPointerUp={endColorInteraction}
              onPointerCancel={endColorInteraction}
              onBlur={endColorInteraction}
              onKeyDown={beginColorInteraction}
              onKeyUp={endColorInteraction}
              onChange={(event) => updateHue(Number(event.target.value))}
            />
          </label>
          <label className="mt-4 block">
            <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-zinc-500">Hex</span>
            <div className="flex items-center gap-2 rounded-xl border border-white/[0.07] bg-black/30 px-2.5 transition focus-within:border-signal/45 focus-within:shadow-focus">
              <span className="h-5 w-5 shrink-0 rounded-md border border-white/[0.12]" style={{ backgroundColor: normalized }} />
              <input
                className="h-10 min-w-0 flex-1 bg-transparent text-sm font-medium uppercase text-zinc-100 outline-none"
                value={draftHex}
                spellCheck={false}
                onFocus={beginColorInteraction}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setDraftHex(nextValue);
                  const next = normalizeHex(nextValue);
                  if (next) {
                    onChange(next);
                  }
                }}
                onBlur={() => {
                  commitHex(draftHex);
                  endColorInteraction();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.currentTarget.blur();
                  }
                  if (event.key === "Escape") {
                    setDraftHex(normalized);
                    setOpen(false);
                  }
                }}
              />
            </div>
          </label>
        </div>,
        document.body
      )}
    </div>
  );
};

interface IconButtonProps {
  title: string;
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  type?: "button" | "submit";
}

export const IconButton = ({ title, children, onClick, active, disabled, type = "button" }: IconButtonProps) => {
  const visualEditingPreview = useVisualEditingPreview();
  return (
    <button
      className={`group relative grid h-10 w-10 place-items-center overflow-visible rounded-2xl border text-zinc-200 transition-colors duration-150 ${
        active
          ? "border-signal/50 bg-signal/15 text-signal"
          : "border-white/[0.06] bg-white/[0.045] hover:border-white/[0.12] hover:bg-white/[0.075]"
      } disabled:cursor-not-allowed disabled:opacity-40`}
      aria-label={title}
      type={type}
      disabled={disabled}
      onClick={() => {
        if (!disabled) {
          visualEditingPreview.pulse?.(`Button: ${title}`);
        }
        onClick?.();
      }}
    >
      {children}
      <span className="pointer-events-none absolute left-1/2 top-full z-50 mt-2 -translate-x-1/2 whitespace-nowrap rounded-lg border border-white/[0.06] bg-panel px-2.5 py-1.5 text-[11px] font-medium text-zinc-300 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
        {title}
      </span>
    </button>
  );
};

interface CommandButtonProps {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  variant?: "primary" | "secondary" | "ghost";
}

export const CommandButton = ({
  children,
  onClick,
  disabled,
  title,
  variant = "primary"
}: CommandButtonProps) => {
  const classes =
    variant === "primary"
      ? "bg-signal text-white hover:bg-[#8e2ee8]"
      : variant === "ghost"
      ? "border-white/[0.06] bg-transparent text-zinc-300 hover:bg-white/[0.055] hover:text-zinc-100"
      : "border-white/[0.065] bg-white/[0.055] text-zinc-200 hover:bg-white/[0.085] hover:text-zinc-50";
  const visualEditingPreview = useVisualEditingPreview();

  return (
    <button
      className={`flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-transparent px-4 text-sm font-semibold transition-colors duration-150 ${classes} disabled:cursor-not-allowed disabled:opacity-40`}
      type="button"
      title={title}
      disabled={disabled}
      onClick={() => {
        if (!disabled) {
          visualEditingPreview.pulse?.(`Button: ${title ?? "command"}`);
        }
        onClick?.();
      }}
    >
      {children}
    </button>
  );
};
