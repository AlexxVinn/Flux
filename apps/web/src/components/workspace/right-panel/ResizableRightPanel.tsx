"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import {
  useRightPanelStore,
  REGION_ORDER,
  regionFlexStyle,
  type RightPanelRegionId,
} from "@/store/rightPanelStore";
import { ResizeHandle } from "@/components/workspace/layout/ResizeHandle";
import { PanelRegion } from "./PanelRegion";
import { PanelSplitter } from "./PanelSplitter";
import { PanelTabBar } from "./PanelTabBar";
import { RightPanelRegionBody, useRightPanelBadges } from "./RightPanelRegions";

const REGION_META: Record<
  RightPanelRegionId,
  { title: string; icon: string; accent?: boolean }
> = {
  scene: { title: "Scene", icon: "▣" },
  properties: { title: "Properties", icon: "◇", accent: true },
  members: { title: "Members", icon: "◎" },
  activity: { title: "Activity", icon: "◷" },
  discussion: { title: "Chat", icon: "◉" },
};

export function ResizableRightPanel({ embedded = false }: { embedded?: boolean }) {
  const width = useRightPanelStore((s) => s.width);
  const layoutMode = useRightPanelStore((s) => s.layoutMode);
  const focusedRegion = useRightPanelStore((s) => s.focusedRegion);
  const regions = useRightPanelStore((s) => s.regions);
  const adjustWidth = useRightPanelStore((s) => s.adjustWidth);
  const setLayoutMode = useRightPanelStore((s) => s.setLayoutMode);
  const focusRegion = useRightPanelStore((s) => s.focusRegion);
  const toggleRegion = useRightPanelStore((s) => s.toggleRegion);
  const adjustRegionHeights = useRightPanelStore((s) => s.adjustRegionHeights);

  const stackRef = useRef<HTMLDivElement>(null);
  const [stackHeight, setStackHeight] = useState(0);
  const badges = useRightPanelBadges();

  useEffect(() => {
    if (embedded) return;
    const el = stackRef.current;
    if (!el) return;

    const measure = () => {
      setStackHeight(el.getBoundingClientRect().height);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [layoutMode, regions]);

  const renderRegion = (id: RightPanelRegionId, singleView: boolean) => {
    const region = regions[id];
    const meta = REGION_META[id];
    return (
      <PanelRegion
        key={id}
        title={meta.title}
        badge={badges[id]}
        active={singleView && focusedRegion === id}
        collapsed={region.collapsed}
        onToggle={() => toggleRegion(id)}
        style={
          singleView
            ? { flex: "1 1 0", minHeight: 0 }
            : regionFlexStyle(id, region.collapsed, region.share)
        }
      >
        <RightPanelRegionBody id={id} />
      </PanelRegion>
    );
  };

  return (
    <aside
      className={
        embedded
          ? "flex h-full min-h-0 flex-col bg-[var(--flux-inspector-bg)]"
          : "relative hidden h-full min-h-0 w-0 shrink-0 flex-col border-l border-[var(--flux-inspector-border)] bg-[var(--flux-inspector-bg)] md:flex"
      }
      style={embedded ? undefined : { width }}
    >
      {!embedded && (
        <ResizeHandle
          overlay
          axis="column"
          edge="start"
          className="absolute inset-y-0 left-0 z-50 w-2 -translate-x-1/2 hover:w-2.5"
          onDrag={adjustWidth}
        />
      )}

      <PanelTabBar
        layoutMode={layoutMode}
        focusedRegion={focusedRegion}
        badgeFor={(id) => badges[id]}
        onSelectTab={(id) => focusRegion(id)}
        onToggleLayout={() =>
          setLayoutMode(layoutMode === "stack" ? "single" : "stack")
        }
      />

      <div ref={stackRef} className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {layoutMode === "single" ? (
          renderRegion(focusedRegion, true)
        ) : (
          REGION_ORDER.map((id, index) => {
            const region = regions[id];
            const nextId = REGION_ORDER[index + 1];
            const showSplitter =
              nextId !== undefined &&
              !region.collapsed &&
              !regions[nextId]!.collapsed;

            return (
              <Fragment key={id}>
                {renderRegion(id, false)}
                {showSplitter && (
                  <PanelSplitter
                    onDrag={(dy) =>
                      adjustRegionHeights(id, nextId, dy, stackHeight)
                    }
                  />
                )}
              </Fragment>
            );
          })
        )}
      </div>
    </aside>
  );
}
