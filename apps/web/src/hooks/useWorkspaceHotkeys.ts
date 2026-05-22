"use client";

import { useEffect } from "react";
import { useSimulationStore } from "@/store/simulationStore";
import { useCanWriteInRoom, useRoomSessionStore } from "@/store/roomSessionStore";
import { authoringUndoDebugLog } from "@/lib/scene/authoringHistoryDebug";
import type { SpawnTool } from "@/lib/physics/types";

const TOOL_BY_DIGIT: Record<string, SpawnTool> = {
  "1": "select",
  "2": "circle",
  "3": "rectangle",
  "4": "spring",
  "5": "rigidBar",
  "6": "rope",
  "7": "collisionBox",
  "8": "force",
  "9": "measure",
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

      const cmdOrCtrl = e.ctrlKey || e.metaKey;
      const ch = typeof e.key === "string" ? e.key.toLowerCase() : "";

      if (cmdOrCtrl && (ch === "z" || ch === "y")) {
        const role = useRoomSessionStore.getState().membership?.role ?? "none";
        const redo = ch === "y" || (ch === "z" && e.shiftKey);
        authoringUndoDebugLog(
          "hotkey",
          `${redo ? "redo" : "undo"} key=${e.key} canWrite=${canWrite} role=${role} target=${(e.target as HTMLElement)?.tagName ?? "?"}`,
        );
        e.preventDefault();
        e.stopPropagation();
        if (!canWrite) {
          authoringUndoDebugLog("hotkey", "BLOCKED: canWrite=false (need admin/member role)");
          return;
        }
        if (redo) store.redoAuthoring();
        else store.undoAuthoring();
        return;
      }

      if (!canWrite) return;

      if (cmdOrCtrl && !e.shiftKey) {
        if (ch === "c") {
          e.preventDefault();
          store.copySelectionToClipboard();
          return;
        }
        if (ch === "v") {
          e.preventDefault();
          store.pasteFromClipboard();
          return;
        }
        if (ch === "d") {
          e.preventDefault();
          store.duplicateSelectedAuthoring();
          return;
        }
      }

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
        return;
      }

      const gizmoKey =
        typeof e.key === "string" ? e.key.toLowerCase() : "";
      if (
        store.activeTool === "select" &&
        !cmdOrCtrl &&
        (gizmoKey === "g" || gizmoKey === "r" || gizmoKey === "s")
      ) {
        e.preventDefault();
        store.setTransformGizmoMode(gizmoKey === "g" ? "move" : gizmoKey === "r" ? "rotate" : "scale");
        return;
      }

      if (
        e.key === "Enter" &&
        store.activeTool === "force" &&
        store.selectedIds.length > 0
      ) {
        e.preventDefault();
        store.applyForceToSelection();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canWrite]);
}
