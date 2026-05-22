"use client";

import { useMemo } from "react";
import { AnnotationToolbar } from "@/components/collaboration/AnnotationToolbar";
import { TapeMeasureHud } from "@/components/workspace/TapeMeasureHud";
import { useSimulationStore } from "@/store/simulationStore";
import { useCanWriteInRoom, useRoomSessionStore } from "@/store/roomSessionStore";
import { useRoomSceneCollaborationStore } from "@/store/roomSceneCollaborationStore";
import { countSceneObjects } from "@/lib/scene/storedScene";
import { useWorkspaceLayoutStore } from "@/store/workspaceLayoutStore";
import type { SpawnTool } from "@/lib/physics/types";
import type { TransformGizmoMode } from "@/lib/physics/transformGizmo";
import {
  ToolIcon,
  ToolButton,
  GizmoIcon,
  IconGridSnap,
  IconPaste,
  IconDuplicate,
  IconDelete,
} from "@/components/workspace/ObjectToolbar";

const TOOLS: { id: SpawnTool; label: string }[] = [
  { id: "select", label: "Select" },
  { id: "circle", label: "Circle" },
  { id: "rectangle", label: "Box" },
  { id: "spring", label: "Spring" },
  { id: "rigidBar", label: "Bar" },
  { id: "rope", label: "Rope" },
  { id: "collisionBox", label: "Bounds" },
  { id: "force", label: "Force" },
  { id: "measure", label: "Measure" },
];

const GIZMO_MODES: { id: TransformGizmoMode; label: string }[] = [
  { id: "move", label: "Move" },
  { id: "rotate", label: "Rotate" },
  { id: "scale", label: "Scale" },
];

export function ObjectToolbarToolsSheet() {
  const closeMobileSheet = useWorkspaceLayoutStore((s) => s.closeMobileSheet);
  const activeTool = useSimulationStore((s) => s.activeTool);
  const setTool = useSimulationStore((s) => s.setTool);
  const transformGizmoMode = useSimulationStore((s) => s.transformGizmoMode);
  const setTransformGizmoMode = useSimulationStore((s) => s.setTransformGizmoMode);
  const gridSnapEnabled = useSimulationStore((s) => s.gridSnapEnabled);
  const toggleGridSnap = useSimulationStore((s) => s.toggleGridSnap);
  const selectedIds = useSimulationStore((s) => s.selectedIds);
  const authoringClipboard = useSimulationStore((s) => s.authoringClipboard);
  const pasteFromClipboard = useSimulationStore((s) => s.pasteFromClipboard);
  const duplicateSelectedAuthoring = useSimulationStore((s) => s.duplicateSelectedAuthoring);
  const deleteSelected = useSimulationStore((s) => s.deleteSelected);
  const springPending = useSimulationStore((s) => s.springPending);
  const ropePending = useSimulationStore((s) => s.ropePending);
  const snapshot = useSimulationStore((s) => s.snapshot);
  const membership = useRoomSessionStore((s) => s.membership);
  const roomSceneRoomId = useRoomSceneCollaborationStore((s) => s.roomId);
  const objectLimit = useRoomSceneCollaborationStore((s) => s.objectLimit);
  const canWrite = useCanWriteInRoom();

  const inCollabRoom =
    !!membership?.roomId &&
    membership.roomId === roomSceneRoomId &&
    (membership.role === "admin" || membership.role === "member");
  const objectCount = useMemo(() => countSceneObjects(snapshot), [snapshot]);
  const atObjectCap = inCollabRoom && objectCount >= objectLimit;

  const clipboardCount =
    authoringClipboard != null
      ? authoringClipboard.bodies.length +
        authoringClipboard.springs.length +
        authoringClipboard.ropes.length
      : 0;

  const pickTool = (id: SpawnTool) => {
    setTool(id);
    closeMobileSheet();
  };

  if (!canWrite) {
    return (
      <p className="px-4 py-6 text-center text-sm text-white/45">
        Read-only in this room — tools unavailable.
      </p>
    );
  }

  return (
    <div className="space-y-4 p-4 pb-6">
      <section>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-white/35">
          Spawn
        </p>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {TOOLS.map((t) => {
            const spawns =
              t.id === "circle" ||
              t.id === "rectangle" ||
              t.id === "spring" ||
              t.id === "rigidBar" ||
              t.id === "rope";
            const disabled = spawns && atObjectCap;
            return (
              <ToolButton
                key={t.id}
                active={activeTool === t.id}
                disabled={disabled}
                onClick={() => pickTool(t.id)}
                title={disabled ? `Object limit (${objectLimit})` : t.label}
                ariaLabel={t.label}
                compact={false}
              >
                <span className="flex flex-col items-center gap-1">
                  <ToolIcon tool={t.id} />
                  <span className="text-[9px] font-medium">{t.label}</span>
                </span>
              </ToolButton>
            );
          })}
        </div>
      </section>

      {activeTool === "select" && (
        <section>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-white/35">
            Transform
          </p>
          <div className="flex flex-wrap gap-2">
            {GIZMO_MODES.map((g) => (
              <ToolButton
                key={g.id}
                active={transformGizmoMode === g.id}
                onClick={() => setTransformGizmoMode(g.id)}
                title={g.label}
                ariaLabel={g.label}
              >
                <GizmoIcon mode={g.id} />
              </ToolButton>
            ))}
            <ToolButton
              active={gridSnapEnabled}
              onClick={toggleGridSnap}
              title="Grid snap"
              ariaLabel="Grid snap"
              tone="snap"
            >
              <IconGridSnap on={gridSnapEnabled} />
            </ToolButton>
          </div>
        </section>
      )}

      <section>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-white/35">
          Markup & edit
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <AnnotationToolbar layout="inline" compact={false} />
          <ToolButton
            disabled={springPending !== null || ropePending !== null || clipboardCount === 0}
            onClick={() => pasteFromClipboard()}
            title="Paste"
            ariaLabel="Paste"
            compact={false}
          >
            <IconPaste />
          </ToolButton>
          <ToolButton
            disabled={
              springPending !== null || ropePending !== null || selectedIds.length === 0
            }
            onClick={() => duplicateSelectedAuthoring()}
            title="Duplicate"
            ariaLabel="Duplicate"
            compact={false}
          >
            <IconDuplicate />
          </ToolButton>
          <ToolButton
            onClick={deleteSelected}
            title="Delete"
            ariaLabel="Delete"
            tone="danger"
            compact={false}
          >
            <IconDelete />
          </ToolButton>
        </div>
      </section>

      {activeTool === "measure" && (
        <section>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-white/35">
            Measure
          </p>
          <TapeMeasureHud />
        </section>
      )}
    </div>
  );
}
