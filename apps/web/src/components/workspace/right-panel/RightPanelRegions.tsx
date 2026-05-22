"use client";

import { useSimulationStore } from "@/store/simulationStore";
import { useCollaborationStore } from "@/store/collaborationStore";
import { useRoomMemberCounts } from "@/hooks/useRoomMembers";
import {
  useRightPanelStore,
  type RightPanelRegionId,
} from "@/store/rightPanelStore";
import { LayersPanel } from "@/components/inspector/LayersPanel";
import { SceneLibraryPanel } from "@/components/inspector/SceneLibraryPanel";
import { PropertyInspector } from "@/components/inspector/PropertyInspector";
import { DebugOverlaysPanel } from "@/components/inspector/DebugOverlaysPanel";
import { ActionHistoryPanel } from "@/components/collaboration/ActionHistoryPanel";
import { DiscussionPanel } from "@/components/collaboration/DiscussionPanel";
import { MembersPanel } from "@/components/collaboration/MembersPanel";
import { SubPanel } from "./SubPanel";

export function RightPanelRegionBody({ id }: { id: RightPanelRegionId }) {
  const sceneLayersOpen = useRightPanelStore((s) => s.sceneLayersOpen);
  const sceneDebugOpen = useRightPanelStore((s) => s.sceneDebugOpen);
  const sceneLibraryOpen = useRightPanelStore((s) => s.sceneLibraryOpen);
  const setSceneLayersOpen = useRightPanelStore((s) => s.setSceneLayersOpen);
  const setSceneDebugOpen = useRightPanelStore((s) => s.setSceneDebugOpen);
  const setSceneLibraryOpen = useRightPanelStore((s) => s.setSceneLibraryOpen);

  if (id === "scene") {
    return (
      <>
        <SubPanel
          title="Library"
          open={sceneLibraryOpen}
          onToggle={() => setSceneLibraryOpen(!sceneLibraryOpen)}
        >
          <SceneLibraryPanel bare />
        </SubPanel>
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
  if (id === "members") return <MembersPanel bare />;
  if (id === "activity") return <ActionHistoryPanel bare />;
  return <DiscussionPanel bare />;
}

export function useRightPanelBadges(): Record<
  RightPanelRegionId,
  string | number | undefined
> {
  const layerCount = useSimulationStore((s) => s.layers.length);
  const messageCount = useCollaborationStore((s) => s.messages.length);
  const connected =
    useCollaborationStore((s) => s.connected) ||
    useCollaborationStore((s) => s.supabaseConnected);
  const { totalCount: memberCount } = useRoomMemberCounts();

  return {
    scene: layerCount,
    properties: undefined,
    members: memberCount > 0 ? memberCount : undefined,
    activity: undefined,
    discussion: connected ? messageCount || undefined : "·",
  };
}
