"use client";

import { useCallback, useRef, useState } from "react";
import type { RightPanelRegionId, RightPanelLayoutMode } from "@/store/rightPanelStore";

const TABS: { id: RightPanelRegionId; label: string; icon: string }[] = [
  { id: "scene", label: "Scene", icon: "▣" },
  { id: "properties", label: "Inspect", icon: "◇" },
  { id: "members", label: "Members", icon: "◎" },
  { id: "activity", label: "Activity", icon: "◷" },
  { id: "discussion", label: "Chat", icon: "◉" },
];

type TooltipTarget = RightPanelRegionId | "layout";

interface PanelTabBarProps {
  layoutMode: RightPanelLayoutMode;
  focusedRegion: RightPanelRegionId;
  onSelectTab: (id: RightPanelRegionId) => void;
  onToggleLayout: () => void;
  badgeFor?: (id: RightPanelRegionId) => string | number | undefined;
}

export function PanelTabBar({
  layoutMode,
  focusedRegion,
  onSelectTab,
  onToggleLayout,
  badgeFor,
}: PanelTabBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{ target: TooltipTarget; x: number } | null>(null);

  const layoutLabel = layoutMode === "stack" ? "Focus one panel" : "Split resizable panels";
  const layoutIcon = layoutMode === "stack" ? "▢" : "▦";

  const showTooltip = useCallback((el: HTMLElement, target: TooltipTarget) => {
    const bar = barRef.current;
    if (!bar) return;
    const rect = el.getBoundingClientRect();
    const barRect = bar.getBoundingClientRect();
    setTooltip({
      target,
      x: rect.left + rect.width / 2 - barRect.left,
    });
  }, []);

  const hideTooltip = useCallback(() => setTooltip(null), []);

  const tooltipText =
    tooltip?.target === "layout"
      ? layoutLabel
      : tooltip
        ? (TABS.find((t) => t.id === tooltip.target)?.label ?? "")
        : "";

  return (
    <div
      ref={barRef}
      className="relative flex shrink-0 items-center justify-between gap-2 border-b border-[var(--flux-inspector-border)] px-2.5 py-2"
      onMouseLeave={hideTooltip}
    >
      {tooltip && (
        <div
          role="tooltip"
          className="pointer-events-none absolute bottom-full z-[100] mb-1.5 -translate-x-1/2 whitespace-nowrap rounded px-2 py-1 font-mono text-[10px] text-white/70 shadow-md"
          style={{ left: tooltip.x, background: "#18181c" }}
        >
          {tooltipText}
        </div>
      )}

      <div className="flex items-center gap-1">
        {TABS.map((tab) => {
          const isActive = layoutMode === "single" && focusedRegion === tab.id;
          const badge = badgeFor?.(tab.id);
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSelectTab(tab.id)}
              onMouseEnter={(e) => showTooltip(e.currentTarget, tab.id)}
              onFocus={(e) => showTooltip(e.currentTarget, tab.id)}
              aria-label={tab.label}
              aria-current={isActive ? "true" : undefined}
              className={`flux-npanel-tab ${isActive ? "flux-npanel-tab--active" : ""}`}
            >
              <span aria-hidden>{tab.icon}</span>
              {badge !== undefined && badge !== "" && (
                <span className="absolute -right-0.5 -top-0.5 min-w-[14px] rounded-sm bg-white/20 px-1 text-center font-mono text-[8px] leading-[14px] text-white/80">
                  {typeof badge === "number" && badge > 9 ? "9+" : badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onToggleLayout}
        onMouseEnter={(e) => showTooltip(e.currentTarget, "layout")}
        onFocus={(e) => showTooltip(e.currentTarget, "layout")}
        aria-label={layoutLabel}
        className={`flux-npanel-tab ${layoutMode === "stack" ? "" : "flux-npanel-tab--active"}`}
      >
        <span aria-hidden>{layoutIcon}</span>
      </button>
    </div>
  );
}
