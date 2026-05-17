"use client";

import { useMemo } from "react";
import { useSimulationStore } from "@/store/simulationStore";
import type { SpawnTool } from "@/lib/physics/types";
import { AnnotationToolbar } from "@/components/collaboration/AnnotationToolbar";
import { useCanWriteInRoom, useRoomSessionStore } from "@/store/roomSessionStore";
import { useRoomSceneCollaborationStore } from "@/store/roomSceneCollaborationStore";
import { countSceneObjects } from "@/lib/scene/storedScene";

const TOOLS: { id: SpawnTool; label: string; hint: string }[] = [
  { id: "select", label: "Select", hint: "1" },
  { id: "circle", label: "Circle", hint: "2" },
  { id: "rectangle", label: "Box", hint: "3" },
  { id: "spring", label: "Spring", hint: "4" },
  { id: "rope", label: "Rope", hint: "5" },
  { id: "collisionBox", label: "Bounds", hint: "6" },
];

interface ObjectToolbarProps {
  timelineOffset?: number;
}

export function ObjectToolbar({ timelineOffset = 120 }: ObjectToolbarProps) {
  const canWrite = useCanWriteInRoom();
  const membership = useRoomSessionStore((s) => s.membership);
  const roomSceneRoomId = useRoomSceneCollaborationStore((s) => s.roomId);
  const objectLimit = useRoomSceneCollaborationStore((s) => s.objectLimit);
  const activeTool = useSimulationStore((s) => s.activeTool);
  const springPending = useSimulationStore((s) => s.springPending);
  const ropePending = useSimulationStore((s) => s.ropePending);
  const snapshot = useSimulationStore((s) => s.snapshot);
  const setTool = useSimulationStore((s) => s.setTool);
  const deleteSelected = useSimulationStore((s) => s.deleteSelected);

  const inCollabRoom =
    !!membership?.roomId &&
    membership.roomId === roomSceneRoomId &&
    (membership.role === "admin" || membership.role === "member");

  const objectCount = useMemo(() => countSceneObjects(snapshot), [snapshot]);
  const atObjectCap = inCollabRoom && objectCount >= objectLimit;

  if (!canWrite) return null;

  return (
    <div
      className="absolute left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-[var(--flux-border)] bg-black/90 px-1.5 py-1"
      style={{ bottom: timelineOffset + 16 }}
    >
      {TOOLS.map((t) => {
        const spawns =
          t.id === "circle" || t.id === "rectangle" || t.id === "spring" || t.id === "rope";
        const disabled = spawns && atObjectCap;
        return (
          <button
            key={t.id}
            type="button"
            disabled={disabled}
            onClick={() => setTool(t.id)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-35 ${
              activeTool === t.id
                ? "flux-btn flux-btn-active text-white"
                : "text-white/45 hover:bg-white/[0.03] hover:text-white/75"
            }`}
            title={
              disabled
                ? `Room object limit reached (${objectLimit})`
                : t.hint
            }
          >
            {t.label}
          </button>
        );
      })}
      <AnnotationToolbar />
      <div className="mx-1 h-5 w-px bg-flux-border" />
      <button
        type="button"
        onClick={deleteSelected}
        title="Delete selection (Del)"
        className="rounded px-2 py-1.5 text-xs text-flux-muted hover:bg-flux-danger/20 hover:text-flux-danger"
      >
        Delete
      </button>
      {springPending && (
        <span className="ml-2 text-[10px] text-flux-text">
          Pick 2nd body · Shift = angle snap · Ctrl = free attach · Esc cancel
        </span>
      )}
      {ropePending && (
        <span className="ml-2 text-[10px] text-flux-text">
          Pick 2nd body · Shift = angle snap · Ctrl = free attach · Esc cancel
        </span>
      )}
    </div>
  );
}
