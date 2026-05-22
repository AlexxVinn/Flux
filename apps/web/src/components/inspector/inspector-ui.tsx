"use client";

import {
  createContext,
  useContext,
  useId,
  useState,
  type ReactNode,
} from "react";

const LockedCtx = createContext(false);

export function InspectorRoot({
  children,
  locked,
  className = "",
}: {
  children: ReactNode;
  locked?: boolean;
  className?: string;
}) {
  return (
    <LockedCtx.Provider value={!!locked}>
      <div
        className={`inspector-root flex min-h-0 flex-1 flex-col text-[11px] leading-snug ${locked ? "inspector-root--locked" : ""} ${className}`}
      >
        {children}
      </div>
    </LockedCtx.Provider>
  );
}

export function InspectorHeader({
  title,
  subtitle,
  badge,
  children,
}: {
  title: string;
  subtitle?: string;
  badge?: string;
  children?: ReactNode;
}) {
  return (
    <header className="inspector-header shrink-0 px-3 py-3">
      <div className="flex items-baseline gap-2">
        <h2 className="min-w-0 flex-1 truncate font-mono text-[12px] font-medium text-white/82">
          {title}
        </h2>
        {badge && (
          <span className="shrink-0 font-mono text-[9px] text-white/32">{badge}</span>
        )}
      </div>
      {subtitle && (
        <p className="mt-1 text-[10px] capitalize text-white/36">{subtitle}</p>
      )}
      {children && <div className="mt-3 flex flex-col gap-2">{children}</div>}
    </header>
  );
}

export function InspectorSegmented({
  items,
  value,
  onChange,
  liveId,
  ariaLabel,
}: {
  items: { id: string; label: string; live?: boolean }[];
  value: string;
  onChange: (id: string) => void;
  liveId?: string;
  ariaLabel: string;
}) {
  return (
    <div
      className="inspector-segmented shrink-0"
      role="tablist"
      aria-label={ariaLabel}
    >
      {items.map((item) => {
        const active = value === item.id;
        const live = liveId === item.id && item.live;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.id)}
            className={`inspector-segmented-btn ${active ? "inspector-segmented-btn--active" : ""} ${live ? "inspector-segmented-btn--live" : ""}`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export function InspectorSection({
  title,
  defaultOpen = true,
  open: controlledOpen,
  onOpenChange,
  children,
  disabled,
}: {
  title: string;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const locked = useContext(LockedCtx);
  const sectionId = useId();

  return (
    <section
      className={`inspector-section ${disabled || locked ? "pointer-events-none opacity-[0.52]" : ""}`}
      aria-disabled={disabled || locked || undefined}
    >
      <button
        type="button"
        className="inspector-section-header"
        aria-expanded={open}
        aria-controls={sectionId}
        onClick={() => setOpen(!open)}
      >
        <span className={`inspector-chevron ${open ? "inspector-chevron--open" : ""}`} aria-hidden>
          ▸
        </span>
        <span className="inspector-section-title">{title}</span>
      </button>
      {open && (
        <div id={sectionId} className="inspector-section-body">
          {children}
        </div>
      )}
    </section>
  );
}

export function InspectorRow({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div className="inspector-row">
      <span className="inspector-label-static" title={label}>
        {label}
      </span>
      <div className="inspector-field min-w-0">{children}</div>
      {hint && <p className="inspector-hint col-span-2">{hint}</p>}
    </div>
  );
}

export function InspectorToggle({
  label,
  checked,
  onChange,
  locked: lockedProp,
  description,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
  locked?: boolean;
  description?: string;
}) {
  const lockedCtx = useContext(LockedCtx);
  const locked = lockedProp ?? lockedCtx;

  return (
    <label
      className={`inspector-toggle ${locked ? "inspector-toggle--locked" : ""}`}
    >
      <input
        type="checkbox"
        className="inspector-toggle-input"
        checked={checked}
        disabled={locked}
        onChange={() => !locked && onChange()}
      />
      <span className="inspector-toggle-box" aria-hidden />
      <span className="inspector-toggle-label">{label}</span>
      {description && (
        <span className="inspector-hint col-span-2 -mt-0.5 pl-[1.35rem]">{description}</span>
      )}
    </label>
  );
}

export function InspectorCheckbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="inspector-toggle">
      <input
        type="checkbox"
        className="inspector-toggle-input"
        checked={checked}
        onChange={onChange}
      />
      <span className="inspector-toggle-box" aria-hidden />
      <span className="inspector-toggle-label">{label}</span>
    </label>
  );
}

export function InspectorAlert({
  variant = "info",
  children,
}: {
  variant?: "info" | "warn" | "success" | "muted";
  children: ReactNode;
}) {
  return (
    <p className={`inspector-alert inspector-alert--${variant}`}>{children}</p>
  );
}

export function InspectorHint({ children }: { children: ReactNode }) {
  return <p className="inspector-hint px-2 py-0.5">{children}</p>;
}

export function InspectorButton({
  children,
  onClick,
  disabled,
  variant = "default",
  className = "",
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "default" | "primary" | "ghost" | "danger";
  className?: string;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`inspector-btn inspector-btn--${variant} ${className}`}
    >
      {children}
    </button>
  );
}

export function InspectorButtonRow({ children }: { children: ReactNode }) {
  return <div className="inspector-btn-row">{children}</div>;
}

export function InspectorStatBlock({ children }: { children: ReactNode }) {
  return <div className="inspector-stat-block">{children}</div>;
}

export function InspectorEmpty({
  icon = "◇",
  title,
  description,
}: {
  icon?: string;
  title: string;
  description: string;
}) {
  return (
    <div className="inspector-empty">
      <div className="inspector-empty-icon" aria-hidden>
        {icon}
      </div>
      <p className="inspector-empty-title">{title}</p>
      <p className="inspector-empty-desc">{description}</p>
    </div>
  );
}

export function InspectorScroll({ children }: { children: ReactNode }) {
  return (
    <div className="inspector-scroll flux-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
      {children}
    </div>
  );
}

export function InspectorPanelBody({ children }: { children: ReactNode }) {
  return <div className="inspector-panel-body">{children}</div>;
}

export function InspectorLinkList({
  items,
}: {
  items: { label: string; value: string }[];
}) {
  return (
    <div className="inspector-link-list">
      {items.map((item) => (
        <p key={item.label}>
          <span className="text-white/38">{item.label}</span>{" "}
          <span className="text-white/62">{item.value}</span>
        </p>
      ))}
    </div>
  );
}

export function InspectorForceList({
  rows,
}: {
  rows: {
    key: string;
    tag: string;
    headline: string;
    detailLine: string;
    fill: string;
    stroke: string;
  }[];
}) {
  return (
    <ul className="inspector-force-list">
      {rows.map((row) => (
        <li key={row.key} className="inspector-force-row">
          <span
            className="inspector-force-swatch"
            style={{
              backgroundColor: row.fill,
              boxShadow: `inset 0 0 0 1px ${row.stroke}`,
            }}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <p className="inspector-force-headline">
              <span className="font-mono text-white/40">{row.tag}</span> {row.headline}
            </p>
            <p className="inspector-force-detail">{row.detailLine}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
