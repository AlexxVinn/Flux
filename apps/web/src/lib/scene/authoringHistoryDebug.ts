"use client";

export type AuthoringUndoDebugEvent =
  | "hotkey"
  | "record"
  | "record_skip"
  | "reset"
  | "undo"
  | "redo"
  | "push"
  | "push_dedupe";

export interface AuthoringUndoDebugEntry {
  id: number;
  t: number;
  kind: AuthoringUndoDebugEvent;
  detail: string;
}

const MAX_LOG = 24;
const log: AuthoringUndoDebugEntry[] = [];
let nextLogId = 0;
let enabled = true;

/** Temp debugging — localStorage `flux_undo_debug=0` disables. */
export function isAuthoringUndoDebugEnabled(): boolean {
  if (typeof window === "undefined") return enabled;
  try {
    const v = window.localStorage.getItem("flux_undo_debug");
    if (v === "0") return false;
    if (v === "1") return true;
  } catch {
    /* ignore */
  }
  return enabled;
}

export function setAuthoringUndoDebugEnabled(on: boolean): void {
  enabled = on;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem("flux_undo_debug", on ? "1" : "0");
    } catch {
      /* ignore */
    }
  }
}

export function authoringUndoDebugLog(kind: AuthoringUndoDebugEvent, detail: string): void {
  if (!isAuthoringUndoDebugEnabled()) return;
  const entry: AuthoringUndoDebugEntry = {
    id: ++nextLogId,
    t: Date.now(),
    kind,
    detail,
  };
  log.unshift(entry);
  if (log.length > MAX_LOG) log.length = MAX_LOG;
  console.info(`[flux-undo] ${kind}: ${detail}`);
}

export function getAuthoringUndoDebugLog(): readonly AuthoringUndoDebugEntry[] {
  return log;
}

export function getAuthoringUndoStackDebugCounts(): {
  entryCount: number;
  index: number;
  canUndo: boolean;
  canRedo: boolean;
} {
  const { authoringUndoStack } = require("./authoringHistory") as typeof import("./authoringHistory");
  return authoringUndoStack.getDebugCounts();
}

export function getAuthoringUndoStackEntrySummaries(): string[] {
  const { authoringUndoStack } = require("./authoringHistory") as typeof import("./authoringHistory");
  return authoringUndoStack.getDebugEntrySummaries();
}

export function clearAuthoringUndoDebugLog(): void {
  log.length = 0;
  nextLogId = 0;
}
