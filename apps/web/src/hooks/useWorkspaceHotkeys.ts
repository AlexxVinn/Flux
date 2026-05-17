"use client";

import { useEffect } from "react";
import { useSimulationStore } from "@/store/simulationStore";
import { useCanWriteInRoom } from "@/store/roomSessionStore";
import type { SpawnTool } from "@/lib/physics/types";

const TOOL_BY_DIGIT: Record<string, SpawnTool> = {
  "1": "select",
  "2": "circle",
  "3": "rectangle",
  "4": "spring",
  "5": "rope",
  "6": "collisionBox",
};

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    target.isContentEditable ||
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT"
  );
}

/** Global authoring shortcuts (tools, delete, cancel). */
export function useWorkspaceHotkeys(): void {
  const canWrite = useCanWriteInRoom();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || isEditableTarget(e.target)) return;

      const store = useSimulationStore.getState();

      if (e.key === "Escape") {
        if (store.springPending || store.ropePending) {
          e.preventDefault();
          useSimulationStore.setState({
            springPending: null,
            ropePending: null,
            springPreviewEnd: null,
          });
        }
        return;
      }

      if (!canWrite) return;

      if (e.key === "Delete" || e.key === "Backspace") {
        if (store.selectedIds.length === 0) return;
        e.preventDefault();
        store.deleteSelected();
        return;
      }

      const tool = TOOL_BY_DIGIT[e.key];
      if (tool) {
        e.preventDefault();
        store.setTool(tool);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canWrite]);
}
