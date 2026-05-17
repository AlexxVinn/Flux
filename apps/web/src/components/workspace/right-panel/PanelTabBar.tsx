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
        ? TABS.find((t) => t.id === tooltip.target)?.label ?? ""
        : "";

  return (
    <div
      ref={barRef}
      className="flux-panel-header relative flex shrink-0 items-center justify-between gap-2 overflow-visible border-b border-white/[0.06] px-2 py-1.5"
      onMouseLeave={hideTooltip}
    >
      {tooltip && (
        <div
          role="tooltip"
          className="pointer-events-none absolute bottom-full z-[100] mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md border border-white/12 bg-[#121214] px-2 py-1 text-[10px] font-medium text-white/90 shadow-lg"
          style={{ left: tooltip.x }}
        >
          {tooltipText}
          <span
            className="absolute left-1/2 top-full h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-white/12 border-t-0 border-l-0 bg-[#121214]"
            aria-hidden
          />
        </div>
      )}

      <div className="flex items-center gap-0.5">
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
              className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[15px] leading-none transition ${
                isActive
                  ? "flux-btn-active bg-white/[0.1] text-white"
                  : "text-white/45 hover:bg-white/[0.05] hover:text-white/80"
              }`}
            >
              <span aria-hidden>{tab.icon}</span>
              {badge !== undefined && badge !== "" && (
                <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-white/90 px-0.5 text-[8px] font-bold leading-none text-black">
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
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-sm transition ${
          layoutMode === "stack"
            ? "text-white/45 hover:bg-white/[0.05] hover:text-white/75"
            : "flux-btn-active bg-white/[0.1] text-white"
        }`}
      >
        <span aria-hidden>{layoutIcon}</span>
      </button>
    </div>
  );
}
