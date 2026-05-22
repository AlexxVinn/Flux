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
  badge,
  collapsed,
  onToggle,
  children,
  style,
  className = "",
  bodyClassName = "",
}: PanelRegionProps) {
  return (
    <section
      className={`flex min-h-0 flex-col overflow-hidden ${className}`}
      style={style}
      data-collapsed={collapsed}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flux-npanel-region-header"
        aria-expanded={!collapsed}
      >
        <span
          className={`inspector-chevron ${collapsed ? "" : "inspector-chevron--open"}`}
          aria-hidden
        >
          ▸
        </span>
        <span className="flux-npanel-region-title">{title}</span>
        {badge !== undefined && badge !== "" && (
          <span className="flux-npanel-region-badge">{badge}</span>
        )}
      </button>
      {!collapsed && (
        <div
          className={`flux-npanel-region-body flux-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden ${bodyClassName}`}
        >
          {children}
        </div>
      )}
    </section>
  );
}
