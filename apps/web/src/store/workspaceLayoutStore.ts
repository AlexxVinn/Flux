"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type MobileWorkspaceSheet =
  | null
  | "nav"
  | "tools"
  | "scene"
  | "properties"
  | "members"
  | "activity"
  | "discussion";

interface WorkspaceLayoutState {
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  timelineHeight: number;
  mobileSheet: MobileWorkspaceSheet;

  setSidebarWidth: (width: number) => void;
  adjustSidebarWidth: (delta: number) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebarCollapsed: () => void;
  setTimelineHeight: (height: number) => void;
  adjustTimelineHeight: (deltaY: number) => void;
  setMobileSheet: (sheet: MobileWorkspaceSheet) => void;
  closeMobileSheet: () => void;
}

export const SIDEBAR_WIDTH_MIN = 52;
/** Minimum width when the sidebar is expanded (drag resize). */
export const SIDEBAR_WIDTH_EXPANDED_MIN = 160;
export const SIDEBAR_WIDTH_MAX = 320;
export const SIDEBAR_WIDTH_DEFAULT = 220;
export const SIDEBAR_WIDTH_COLLAPSED = 56;

export const TIMELINE_HEIGHT_MIN = 44;
export const TIMELINE_HEIGHT_MAX = 72;
export const TIMELINE_HEIGHT_DEFAULT = TIMELINE_HEIGHT_MIN;

/** Matches canvas dock inset (`left-3` / `bottom-3`). */
export const WORKSPACE_PANEL_INSET_PX = 12;

/** Lift bottom docks above the canvas “3000×2000 world” readout. */
export const AUTHORING_DOCK_BOTTOM_EXTRA_PX = 14;

function clampSidebar(w: number, collapsed: boolean): number {
  if (collapsed) return SIDEBAR_WIDTH_COLLAPSED;
  return Math.round(
    Math.max(SIDEBAR_WIDTH_EXPANDED_MIN, Math.min(SIDEBAR_WIDTH_MAX, w)),
  );
}

function clampTimeline(h: number): number {
  return Math.round(Math.max(TIMELINE_HEIGHT_MIN, Math.min(TIMELINE_HEIGHT_MAX, h)));
}

export const useWorkspaceLayoutStore = create<WorkspaceLayoutState>()(
  persist(
    (set, get) => ({
      sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
      sidebarCollapsed: false,
      timelineHeight: TIMELINE_HEIGHT_DEFAULT,
      mobileSheet: null,

      setSidebarWidth: (width) => {
        const { sidebarCollapsed } = get();
        set({ sidebarWidth: clampSidebar(width, sidebarCollapsed) });
      },

      adjustSidebarWidth: (delta) => {
        const { sidebarWidth, sidebarCollapsed } = get();
        if (sidebarCollapsed || delta === 0) return;
        set({ sidebarWidth: clampSidebar(sidebarWidth + delta, false) });
      },

      setSidebarCollapsed: (sidebarCollapsed) =>
        set((s) => ({
          sidebarCollapsed,
          sidebarWidth: sidebarCollapsed ? SIDEBAR_WIDTH_COLLAPSED : clampSidebar(s.sidebarWidth, false),
        })),

      toggleSidebarCollapsed: () => {
        const { sidebarCollapsed, sidebarWidth } = get();
        const next = !sidebarCollapsed;
        set({
          sidebarCollapsed: next,
          sidebarWidth: next
            ? SIDEBAR_WIDTH_COLLAPSED
            : clampSidebar(Math.max(sidebarWidth, SIDEBAR_WIDTH_DEFAULT), false),
        });
      },

      setTimelineHeight: (height) => set({ timelineHeight: clampTimeline(height) }),

      adjustTimelineHeight: (deltaY) =>
        set((s) => ({ timelineHeight: clampTimeline(s.timelineHeight - deltaY) })),

      setMobileSheet: (mobileSheet) => set({ mobileSheet }),
      closeMobileSheet: () => set({ mobileSheet: null }),
    }),
    {
      name: "flux_workspace_layout",
      version: 2,
      migrate: (persisted, version) => {
        if (!persisted || typeof persisted !== "object") return persisted;
        const state = persisted as Partial<WorkspaceLayoutState>;
        if (version < 2) {
          return { ...state, timelineHeight: TIMELINE_HEIGHT_MIN };
        }
        return {
          ...state,
          timelineHeight: clampTimeline(state.timelineHeight ?? TIMELINE_HEIGHT_MIN),
        };
      },
    },
  ),
);
