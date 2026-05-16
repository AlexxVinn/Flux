"use client";

export function NumField({
  label,
  value,
  unit,
  step = 0.1,
  min,
  max,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  unit?: string;
  step?: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  const commit = (raw: string) => {
    let v = parseFloat(raw);
    if (!Number.isFinite(v)) v = 0;
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    onChange(v);
  };

  return (
    <label className="grid grid-cols-[1fr_auto] items-end gap-1">
      <span className="text-[9px] uppercase tracking-wide text-flux-muted">
        {label}
        {unit ? ` (${unit})` : ""}
      </span>
      <input
        type="number"
        step={step}
        disabled={disabled}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => commit(e.target.value)}
        className="w-full rounded border border-flux-border bg-flux-bg px-1.5 py-0.5 font-mono text-[11px] text-flux-text focus:border-flux-focus focus:outline-none disabled:opacity-40"
      />
    </label>
  );
}
