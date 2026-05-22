"use client";

import { useRightPanelStore, type RightPanelRegionId } from "@/store/rightPanelStore";
import {
  useWorkspaceLayoutStore,
  type MobileWorkspaceSheet,
} from "@/store/workspaceLayoutStore";
import { useRightPanelBadges } from "@/components/workspace/right-panel/RightPanelRegions";

const PANEL_SHEETS: RightPanelRegionId[] = [
  "scene",
  "properties",
  "members",
  "activity",
  "discussion",
];

function isPanelSheet(s: MobileWorkspaceSheet): s is RightPanelRegionId {
  return s != null && PANEL_SHEETS.includes(s as RightPanelRegionId);
}

function BottomTab({
  label,
  active,
  badge,
  onClick,
}: {
  label: string;
  active: boolean;
  badge?: string | number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex min-h-[44px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1.5 text-[10px] font-medium transition ${
        active
          ? "bg-white/[0.1] text-white"
          : "text-white/50 active:bg-white/[0.06] active:text-white/80"
      }`}
    >
      <span className="truncate">{label}</span>
      {badge != null && badge !== "" && (
        <span className="absolute right-1 top-1 min-w-[14px] rounded-full bg-emerald-500/90 px-1 text-center font-mono text-[8px] font-semibold text-black">
          {badge}
        </span>
      )}
    </button>
  );
}

/** In-flow bottom tabs (sits below timeline — does not cover it). */
export function MobileWorkspaceTabBar() {
  const mobileSheet = useWorkspaceLayoutStore((s) => s.mobileSheet);
  const setMobileSheet = useWorkspaceLayoutStore((s) => s.setMobileSheet);
  const focusRegion = useRightPanelStore((s) => s.focusRegion);
  const badges = useRightPanelBadges();

  const openSheet = (sheet: MobileWorkspaceSheet) => {
    setMobileSheet(mobileSheet === sheet ? null : sheet);
    if (isPanelSheet(sheet)) focusRegion(sheet);
  };

  return (
    <nav
      className="relative z-30 flex shrink-0 gap-0.5 border-t border-white/[0.08] bg-black/95 px-1.5 py-1.5 backdrop-blur-md md:hidden"
      style={{ paddingBottom: "max(0.375rem, env(safe-area-inset-bottom))" }}
      aria-label="Workspace"
    >
      <BottomTab
        label="Tools"
        active={mobileSheet === "tools"}
        onClick={() => openSheet("tools")}
      />
      <BottomTab
        label="Scene"
        active={mobileSheet === "scene"}
        badge={badges.scene}
        onClick={() => openSheet("scene")}
      />
      <BottomTab
        label="Inspect"
        active={mobileSheet === "properties"}
        onClick={() => openSheet("properties")}
      />
      <BottomTab
        label="Chat"
        active={mobileSheet === "discussion"}
        badge={badges.discussion}
        onClick={() => openSheet("discussion")}
      />
      <BottomTab
        label="Menu"
        active={mobileSheet === "nav"}
        onClick={() => openSheet("nav")}
      />
    </nav>
  );
}
