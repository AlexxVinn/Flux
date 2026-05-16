"use client";

import type { ReactNode } from "react";

interface PanelRegionProps {
  title: string;
  icon?: string;
  badge?: string | number;
  collapsed: boolean;
  onToggle: () => void;
  accent?: boolean;
  active?: boolean;
  children: ReactNode;
  style?: React.CSSProperties;
  className?: string;
  bodyClassName?: string;
}

export function PanelRegion({
  title,
  icon,
  badge,
  collapsed,
  onToggle,
  accent,
  active,
  children,
  style,
  className = "",
  bodyClassName = "",
}: PanelRegionProps) {
  const emphasized = active || accent;

  return (
    <section
      className={`flex min-h-0 flex-col overflow-hidden ${className}`}
      style={style}
      data-collapsed={collapsed}
    >
      <button
        type="button"
        onClick={onToggle}
        className={`flux-panel-header group flex shrink-0 items-center gap-2 px-2.5 py-2 text-left transition hover:bg-white/[0.02] ${
          emphasized ? "text-white" : "text-white/50"
        }`}
        aria-expanded={!collapsed}
      >
        {icon && (
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-[11px] ${
              emphasized
                ? "border-[var(--flux-border-active)] bg-[var(--flux-surface-raised)] text-white"
                : "border-[var(--flux-border)] bg-black text-white/40"
            }`}
          >
            {icon}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium tracking-wide group-hover:text-white/85">
          {title}
        </span>
        {badge !== undefined && badge !== "" && (
          <span className="shrink-0 rounded-md border border-[var(--flux-border)] px-2 py-0.5 font-mono text-[9px] text-white/40">
            {badge}
          </span>
        )}
        <span
          className={`text-[10px] text-white/30 transition ${collapsed ? "" : "rotate-90"}`}
          aria-hidden
        >
          ›
        </span>
      </button>
      {!collapsed && (
        <div
          className={`flux-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-black ${bodyClassName}`}
        >
          {children}
        </div>
      )}
    </section>
  );
}
