"use client";

import type { CSSProperties } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type RightPanelRegionId = "scene" | "properties" | "activity" | "discussion";

export interface RegionLayout {
  collapsed: boolean;
  /** Flex-grow weight — expanded regions always fill the stack height. */
  share: number;
}

export type RightPanelLayoutMode = "stack" | "single";

interface RightPanelState {
  width: number;
  layoutMode: RightPanelLayoutMode;
  focusedRegion: RightPanelRegionId;
  regions: Record<RightPanelRegionId, RegionLayout>;
  sceneLayersOpen: boolean;
  sceneDebugOpen: boolean;

  setWidth: (width: number) => void;
  setLayoutMode: (mode: RightPanelLayoutMode) => void;
  focusRegion: (id: RightPanelRegionId) => void;
  toggleRegion: (id: RightPanelRegionId) => void;
  setRegionShare: (id: RightPanelRegionId, share: number) => void;
  adjustRegionHeights: (
    topId: RightPanelRegionId,
    bottomId: RightPanelRegionId,
    deltaY: number,
    stackHeight: number,
  ) => void;
  setSceneLayersOpen: (open: boolean) => void;
  setSceneDebugOpen: (open: boolean) => void;
}

export const RIGHT_PANEL_WIDTH_MIN = 260;
export const RIGHT_PANEL_WIDTH_MAX = 480;
export const RIGHT_PANEL_WIDTH_DEFAULT = 340;

export const REGION_ORDER: RightPanelRegionId[] = [
  "scene",
  "properties",
  "activity",
  "discussion",
];

const REGION_MIN: Record<RightPanelRegionId, number> = {
  scene: 100,
  properties: 120,
  activity: 64,
  discussion: 120,
};

const MIN_SHARE = 0.35;

const DEFAULT_REGIONS: Record<RightPanelRegionId, RegionLayout> = {
  scene: { collapsed: false, share: 2 },
  properties: { collapsed: false, share: 2.5 },
  activity: { collapsed: false, share: 1.2 },
  discussion: { collapsed: false, share: 2.3 },
};

function clampWidth(w: number): number {
  return Math.round(Math.max(RIGHT_PANEL_WIDTH_MIN, Math.min(RIGHT_PANEL_WIDTH_MAX, w)));
}

function clampShare(share: number): number {
  return Math.max(MIN_SHARE, share);
}

function expandedShareTotal(regions: Record<RightPanelRegionId, RegionLayout>): number {
  return REGION_ORDER.reduce(
    (sum, id) => (regions[id].collapsed ? sum : sum + regions[id].share),
    0,
  );
}

/** @deprecated persisted pixel heights from older builds */
function migrateLegacyRegions(
  raw: Record<string, { collapsed?: boolean; height?: number; share?: number }> | undefined,
): Record<RightPanelRegionId, RegionLayout> {
  const next: Record<RightPanelRegionId, RegionLayout> = {
    ...DEFAULT_REGIONS,
  };
  if (!raw) return next;

  let legacyHeightSum = 0;
  for (const id of REGION_ORDER) {
    const r = raw[id];
    if (!r) continue;
    if (typeof r.collapsed === "boolean") next[id].collapsed = r.collapsed;
    if (typeof r.share === "number" && Number.isFinite(r.share)) {
      next[id].share = clampShare(r.share);
    } else if (typeof r.height === "number" && Number.isFinite(r.height)) {
      next[id].share = clampShare(r.height / 120);
      legacyHeightSum += r.height;
    }
  }

  if (legacyHeightSum > 0) {
    const total = expandedShareTotal(next);
    for (const id of REGION_ORDER) {
      if (!next[id].collapsed) {
        next[id].share = clampShare((next[id].share / total) * 8);
      }
    }
  }

  return next;
}

export const useRightPanelStore = create<RightPanelState>()(
  persist(
    (set, get) => ({
      width: RIGHT_PANEL_WIDTH_DEFAULT,
      layoutMode: "stack",
      focusedRegion: "properties",
      regions: { ...DEFAULT_REGIONS },
      sceneLayersOpen: true,
      sceneDebugOpen: false,

      setWidth: (width) => set({ width: clampWidth(width) }),

      setLayoutMode: (layoutMode) => set({ layoutMode }),

      focusRegion: (id) =>
        set((s) => ({
          layoutMode: "single",
          focusedRegion: id,
          regions: {
            ...s.regions,
            [id]: { ...s.regions[id], collapsed: false },
          },
        })),

      toggleRegion: (id) =>
        set((s) => ({
          regions: {
            ...s.regions,
            [id]: { ...s.regions[id], collapsed: !s.regions[id].collapsed },
          },
        })),

      setRegionShare: (id, share) =>
        set((s) => ({
          regions: {
            ...s.regions,
            [id]: { ...s.regions[id], share: clampShare(share) },
          },
        })),

      adjustRegionHeights: (topId, bottomId, deltaY, stackHeight) => {
        if (stackHeight < 48) return;

        const { regions } = get();
        const top = regions[topId];
        const bottom = regions[bottomId];
        if (top.collapsed || bottom.collapsed) return;

        const totalShare = expandedShareTotal(regions);
        if (totalShare <= 0) return;

        const deltaShare = (deltaY / stackHeight) * totalShare;
        let nextTop = clampShare(top.share + deltaShare);
        let nextBottom = clampShare(bottom.share - deltaShare);

        const topClamp = top.share + deltaShare - nextTop;
        const bottomClamp = bottom.share - deltaShare - nextBottom;
        if (topClamp !== 0) nextBottom = clampShare(nextBottom - topClamp);
        if (bottomClamp !== 0) nextTop = clampShare(nextTop + bottomClamp);

        if (nextTop === top.share && nextBottom === bottom.share) return;

        set({
          regions: {
            ...regions,
            [topId]: { ...top, share: nextTop },
            [bottomId]: { ...bottom, share: nextBottom },
          },
        });
      },

      setSceneLayersOpen: (sceneLayersOpen) => set({ sceneLayersOpen }),
      setSceneDebugOpen: (sceneDebugOpen) => set({ sceneDebugOpen }),
    }),
    {
      name: "flux_right_panel",
      version: 1,
      migrate: (persisted, version) => {
        if (!persisted || typeof persisted !== "object") return persisted;
        const state = persisted as Record<string, unknown>;
        if (version < 1 && state.regions && typeof state.regions === "object") {
          return {
            ...state,
            regions: migrateLegacyRegions(
              state.regions as Record<
                string,
                { collapsed?: boolean; height?: number; share?: number }
              >,
            ),
          };
        }
        return persisted;
      },
    },
  ),
);

export function regionFlexStyle(
  id: RightPanelRegionId,
  collapsed: boolean,
  share: number,
): CSSProperties {
  if (collapsed) return { flex: "0 0 auto" };
  return { flex: `${share} 1 0`, minHeight: REGION_MIN[id] };
}
