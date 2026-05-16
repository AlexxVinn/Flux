"use client";

import type { RightPanelRegionId, RightPanelLayoutMode } from "@/store/rightPanelStore";

const TABS: { id: RightPanelRegionId; label: string; icon: string }[] = [
  { id: "scene", label: "Scene", icon: "▣" },
  { id: "properties", label: "Inspect", icon: "◇" },
  { id: "activity", label: "Activity", icon: "◷" },
  { id: "discussion", label: "Chat", icon: "◉" },
];

interface PanelTabBarProps {
  layoutMode: RightPanelLayoutMode;
  focusedRegion: RightPanelRegionId;
  onSelectTab: (id: RightPanelRegionId) => void;
  onToggleLayout: () => void;
}

export function PanelTabBar({
  layoutMode,
  focusedRegion,
  onSelectTab,
  onToggleLayout,
}: PanelTabBarProps) {
  return (
    <div className="flux-panel-header flex shrink-0 items-center gap-1 px-2 py-1.5">
      <div className="flux-scroll flex min-w-0 flex-1 gap-1 overflow-x-auto">
        {TABS.map((tab) => {
          const isActive = layoutMode === "single" && focusedRegion === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSelectTab(tab.id)}
              className={`flux-btn flex shrink-0 items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium ${
                isActive ? "flux-btn-active text-white" : "text-white/45 hover:text-white/70"
              }`}
            >
              <span className="text-[10px] opacity-70">{tab.icon}</span>
              {tab.label}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={onToggleLayout}
        title={layoutMode === "stack" ? "Focus one panel" : "Split resizable panels"}
        className={`flux-btn shrink-0 px-2 py-1 text-[10px] font-medium ${
          layoutMode === "stack" ? "text-white/45" : "flux-btn-active text-white"
        }`}
      >
        {layoutMode === "stack" ? "Focus" : "Split"}
      </button>
    </div>
  );
}
