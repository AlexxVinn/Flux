"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

export interface ScrubNumFieldProps {
  label: string;
  value: number;
  unit?: string;
  step?: number;
  min?: number;
  max?: number;
  /** Simulation running — show read-only, dimmed values. */
  locked?: boolean;
  disabled?: boolean;
  decimals?: number;
  /** Live preview while dragging / typing (no server commit). */
  onPreview?: (v: number) => void;
  /** Final value — call on pointer-up after scrub, blur, or Enter. */
  onCommit: (v: number) => void;
}

function clampValue(v: number, min?: number, max?: number): number {
  let n = v;
  if (!Number.isFinite(n)) n = 0;
  if (min !== undefined) n = Math.max(min, n);
  if (max !== undefined) n = Math.min(max, n);
  return n;
}

function formatDisplay(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return "0";
  if (decimals <= 0) return String(Math.round(value));
  return value.toFixed(decimals);
}

export function ScrubNumField({
  label,
  value,
  unit,
  step = 1,
  min,
  max,
  locked = false,
  disabled = false,
  decimals = step < 1 ? 3 : step < 0.1 ? 4 : 0,
  onPreview,
  onCommit,
}: ScrubNumFieldProps) {
  const inputId = useId();
  const scrubbing = useRef(false);
  const startX = useRef(0);
  const startValue = useRef(0);
  const latestValue = useRef(value);
  const [draft, setDraft] = useState<string | null>(null);
  const [isFocused, setIsFocused] = useState(false);

  const readOnly = locked || disabled;
  const display = draft ?? formatDisplay(value, decimals);

  useEffect(() => {
    if (!isFocused && !scrubbing.current) {
      latestValue.current = value;
      setDraft(null);
    }
  }, [value, isFocused]);

  const apply = useCallback(
    (raw: number, preview: boolean) => {
      const v = clampValue(raw, min, max);
      latestValue.current = v;
      if (preview) onPreview?.(v);
      else onCommit(v);
    },
    [min, max, onCommit, onPreview],
  );

  const onLabelPointerDown = (e: React.PointerEvent) => {
    if (readOnly) return;
    e.preventDefault();
    scrubbing.current = true;
    startX.current = e.clientX;
    startValue.current = value;
    latestValue.current = value;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    const sensitivity = step * 0.5;

    const onMove = (ev: PointerEvent) => {
      if (!scrubbing.current) return;
      const delta = (ev.clientX - startX.current) * sensitivity;
      const next = clampValue(startValue.current + delta, min, max);
      latestValue.current = next;
      setDraft(formatDisplay(next, decimals));
      onPreview?.(next);
    };

    const onUp = (ev: PointerEvent) => {
      if (!scrubbing.current) return;
      scrubbing.current = false;
      try {
        (e.target as HTMLElement).releasePointerCapture(ev.pointerId);
      } catch {
        /* already released */
      }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const final = latestValue.current;
      setDraft(null);
      onCommit(final);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const commitDraft = () => {
    const v = clampValue(parseFloat(draft ?? display), min, max);
    setDraft(null);
    setIsFocused(false);
    onCommit(v);
  };

  return (
    <div
      className={`group grid grid-cols-[auto_1fr] items-center gap-1.5 rounded-lg border px-1.5 py-1 transition-colors ${
        readOnly
          ? "border-transparent bg-black/25 text-flux-muted"
          : "border-[var(--flux-border)] bg-black hover:border-[var(--flux-border-hover)] focus-within:border-[var(--flux-border-active)] focus-within:bg-black"
      }`}
      data-locked={readOnly || undefined}
    >
      <button
        type="button"
        disabled={readOnly}
        onPointerDown={onLabelPointerDown}
        className={`min-w-[1.75rem] select-none rounded px-1 py-0.5 text-left font-mono text-[10px] font-semibold uppercase tracking-wide ${
          readOnly
            ? "cursor-default text-flux-muted/70"
            : "cursor-ew-resize text-white/70 hover:bg-white/5 active:bg-white/10"
        }`}
        title={readOnly ? undefined : `Drag to adjust ${label}`}
        aria-controls={inputId}
      >
        {label}
      </button>
      <div className="flex min-w-0 items-baseline gap-1">
        {readOnly ? (
          <span className="w-full truncate font-mono text-[11px] tabular-nums text-flux-muted/90">
            {formatDisplay(value, decimals)}
          </span>
        ) : (
          <input
            id={inputId}
            type="text"
            inputMode="decimal"
            disabled={disabled}
            value={display}
            onFocus={() => setIsFocused(true)}
            onChange={(e) => {
              setDraft(e.target.value);
              const parsed = parseFloat(e.target.value);
              if (Number.isFinite(parsed)) onPreview?.(clampValue(parsed, min, max));
            }}
            onBlur={commitDraft}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitDraft();
              }
              if (e.key === "Escape") {
                setDraft(null);
                setIsFocused(false);
                (e.target as HTMLInputElement).blur();
              }
            }}
            className="w-full min-w-0 bg-transparent font-mono text-[11px] tabular-nums text-flux-text outline-none"
          />
        )}
        {unit && (
          <span className="shrink-0 text-[9px] text-flux-muted/80">{unit}</span>
        )}
      </div>
    </div>
  );
}
