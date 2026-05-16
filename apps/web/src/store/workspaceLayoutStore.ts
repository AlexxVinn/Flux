"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface WorkspaceLayoutState {
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  timelineHeight: number;

  setSidebarWidth: (width: number) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebarCollapsed: () => void;
  setTimelineHeight: (height: number) => void;
  adjustTimelineHeight: (deltaY: number) => void;
}

export const SIDEBAR_WIDTH_MIN = 52;
export const SIDEBAR_WIDTH_MAX = 280;
export const SIDEBAR_WIDTH_DEFAULT = 220;
export const SIDEBAR_WIDTH_COLLAPSED = 56;

export const TIMELINE_HEIGHT_MIN = 88;
export const TIMELINE_HEIGHT_MAX = 220;
export const TIMELINE_HEIGHT_DEFAULT = 120;

function clampSidebar(w: number, collapsed: boolean): number {
  if (collapsed) return SIDEBAR_WIDTH_COLLAPSED;
  return Math.round(
    Math.max(SIDEBAR_WIDTH_MIN + 120, Math.min(SIDEBAR_WIDTH_MAX, w)),
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

      setSidebarWidth: (width) => {
        const { sidebarCollapsed } = get();
        set({ sidebarWidth: clampSidebar(width, sidebarCollapsed) });
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
    }),
    { name: "flux_workspace_layout" },
  ),
);
