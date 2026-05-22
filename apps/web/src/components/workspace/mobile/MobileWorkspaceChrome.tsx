"use client";

import { useEffect } from "react";
import { useRightPanelStore, type RightPanelRegionId } from "@/store/rightPanelStore";
import {
  useWorkspaceLayoutStore,
  type MobileWorkspaceSheet,
} from "@/store/workspaceLayoutStore";
import { WorkspaceSidebar } from "@/components/workspace/WorkspaceSidebar";
import { RightPanelRegionBody } from "@/components/workspace/right-panel/RightPanelRegions";
import { ObjectToolbarToolsSheet } from "@/components/workspace/mobile/ObjectToolbarToolsSheet";

const PANEL_SHEETS: RightPanelRegionId[] = [
  "scene",
  "properties",
  "members",
  "activity",
  "discussion",
];

const PANEL_LABELS: Record<RightPanelRegionId, string> = {
  scene: "Scene",
  properties: "Inspector",
  members: "Members",
  activity: "Activity",
  discussion: "Chat",
};

function isPanelSheet(s: MobileWorkspaceSheet): s is RightPanelRegionId {
  return s != null && PANEL_SHEETS.includes(s as RightPanelRegionId);
}

interface MobileWorkspaceChromeProps {
  roomId: string;
  benchId: string | null;
}

export function MobileWorkspaceChrome({ roomId, benchId }: MobileWorkspaceChromeProps) {
  const mobileSheet = useWorkspaceLayoutStore((s) => s.mobileSheet);
  const closeMobileSheet = useWorkspaceLayoutStore((s) => s.closeMobileSheet);
  const focusRegion = useRightPanelStore((s) => s.focusRegion);

  useEffect(() => {
    if (isPanelSheet(mobileSheet)) focusRegion(mobileSheet);
  }, [mobileSheet, focusRegion]);

  const sheetTitle =
    mobileSheet === "nav"
      ? "Menu"
      : mobileSheet === "tools"
        ? "Tools"
        : mobileSheet && isPanelSheet(mobileSheet)
          ? PANEL_LABELS[mobileSheet]
          : null;

  return (
    <>
      {mobileSheet != null && (
        <button
          type="button"
          aria-label="Close panel"
          className="fixed inset-0 z-[60] bg-black/55 backdrop-blur-[2px] md:hidden"
          onClick={closeMobileSheet}
        />
      )}

      {mobileSheet === "nav" && (
        <div
          className="fixed inset-y-0 left-0 z-[70] flex w-[min(300px,88vw)] flex-col border-r border-[var(--flux-border)] bg-black shadow-2xl md:hidden"
          style={{ paddingTop: "env(safe-area-inset-top)" }}
        >
          <WorkspaceSidebar roomId={roomId} benchId={benchId} variant="drawer" />
        </div>
      )}

      {mobileSheet != null && mobileSheet !== "nav" && (
        <div
          className="fixed inset-x-0 bottom-0 z-[70] flex max-h-[min(78dvh,640px)] flex-col rounded-t-2xl border border-b-0 border-white/[0.1] bg-[var(--flux-inspector-bg)] shadow-2xl md:hidden"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <div className="flex shrink-0 items-center justify-between border-b border-white/[0.08] px-4 py-3">
            <h2 className="text-sm font-semibold text-white">{sheetTitle}</h2>
            <button
              type="button"
              onClick={closeMobileSheet}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.1] text-white/70"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {mobileSheet === "tools" && <ObjectToolbarToolsSheet />}
            {isPanelSheet(mobileSheet) && (
              <div className="p-2">
                <RightPanelRegionBody id={mobileSheet} />
              </div>
            )}
          </div>
        </div>
      )}

    </>
  );
}
