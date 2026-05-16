"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useSimulationStore } from "@/store/simulationStore";
import { useCollaborationStore } from "@/store/collaborationStore";
import {
  useRightPanelStore,
  REGION_ORDER,
  regionFlexStyle,
  type RightPanelRegionId,
} from "@/store/rightPanelStore";
import { LayersPanel } from "@/components/inspector/LayersPanel";
import { PropertyInspector } from "@/components/inspector/PropertyInspector";
import { DebugOverlaysPanel } from "@/components/inspector/DebugOverlaysPanel";
import { ActionHistoryPanel } from "@/components/collaboration/ActionHistoryPanel";
import { DiscussionPanel } from "@/components/collaboration/DiscussionPanel";
import { ResizeHandle } from "@/components/workspace/layout/ResizeHandle";
import { PanelRegion } from "./PanelRegion";
import { PanelSplitter } from "./PanelSplitter";
import { PanelTabBar } from "./PanelTabBar";
import { SubPanel } from "./SubPanel";

const REGION_META: Record<
  RightPanelRegionId,
  { title: string; icon: string; accent?: boolean }
> = {
  scene: { title: "Scene", icon: "▣" },
  properties: { title: "Properties", icon: "◇", accent: true },
  activity: { title: "Activity", icon: "◷" },
  discussion: { title: "Chat", icon: "◉" },
};

function RegionBody({ id }: { id: RightPanelRegionId }) {
  const sceneLayersOpen = useRightPanelStore((s) => s.sceneLayersOpen);
  const sceneDebugOpen = useRightPanelStore((s) => s.sceneDebugOpen);
  const setSceneLayersOpen = useRightPanelStore((s) => s.setSceneLayersOpen);
  const setSceneDebugOpen = useRightPanelStore((s) => s.setSceneDebugOpen);

  if (id === "scene") {
    return (
      <>
        <SubPanel
          title="Layers"
          open={sceneLayersOpen}
          onToggle={() => setSceneLayersOpen(!sceneLayersOpen)}
        >
          <LayersPanel bare />
        </SubPanel>
        <SubPanel
          title="Debug overlays"
          open={sceneDebugOpen}
          onToggle={() => setSceneDebugOpen(!sceneDebugOpen)}
        >
          <DebugOverlaysPanel bare />
        </SubPanel>
      </>
    );
  }
  if (id === "properties") return <PropertyInspector />;
  if (id === "activity") return <ActionHistoryPanel bare />;
  return <DiscussionPanel bare />;
}

export function ResizableRightPanel() {
  const width = useRightPanelStore((s) => s.width);
  const layoutMode = useRightPanelStore((s) => s.layoutMode);
  const focusedRegion = useRightPanelStore((s) => s.focusedRegion);
  const regions = useRightPanelStore((s) => s.regions);
  const setWidth = useRightPanelStore((s) => s.setWidth);
  const setLayoutMode = useRightPanelStore((s) => s.setLayoutMode);
  const focusRegion = useRightPanelStore((s) => s.focusRegion);
  const toggleRegion = useRightPanelStore((s) => s.toggleRegion);
  const adjustRegionHeights = useRightPanelStore((s) => s.adjustRegionHeights);

  const stackRef = useRef<HTMLDivElement>(null);
  const [stackHeight, setStackHeight] = useState(0);

  const layerCount = useSimulationStore((s) => s.layers.length);
  const messageCount = useCollaborationStore((s) => s.messages.length);
  const connected =
    useCollaborationStore((s) => s.connected) ||
    useCollaborationStore((s) => s.supabaseConnected);

  useEffect(() => {
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

  const badgeFor = (id: RightPanelRegionId) => {
    if (id === "scene") return layerCount;
    if (id === "discussion") return connected ? messageCount || undefined : "·";
    return undefined;
  };

  const renderRegion = (id: RightPanelRegionId, singleView: boolean) => {
    const region = regions[id];
    const meta = REGION_META[id];
    return (
      <PanelRegion
        key={id}
        title={meta.title}
        icon={meta.icon}
        badge={badgeFor(id)}
        accent={meta.accent}
        active={singleView && focusedRegion === id}
        collapsed={region.collapsed}
        onToggle={() => toggleRegion(id)}
        style={
          singleView
            ? { flex: "1 1 0", minHeight: 0 }
            : regionFlexStyle(id, region.collapsed, region.share)
        }
      >
        <RegionBody id={id} />
      </PanelRegion>
    );
  };

  return (
    <aside
      className="relative flex h-full min-h-0 shrink-0 flex-col border-l border-[var(--flux-border)] bg-black"
      style={{ width }}
    >
      <ResizeHandle axis="column" edge="start" onDrag={(dx) => setWidth(width - dx)} />

      <PanelTabBar
        layoutMode={layoutMode}
        focusedRegion={focusedRegion}
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
