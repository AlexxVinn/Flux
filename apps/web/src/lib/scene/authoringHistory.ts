import {
  authoringSceneSignature,
  countSceneObjects,
  normalizeStoredScene,
  snapshotForServer,
  toSimulationSnapshot,
  type StoredSceneSnapshot,
} from "./storedScene";
import type { SimulationSnapshot } from "@/lib/physics/types";
import { authoringUndoDebugLog } from "./authoringHistoryDebug";

const MAX_ENTRIES = 80;

function cloneStored(s: StoredSceneSnapshot): StoredSceneSnapshot {
  return normalizeStoredScene(structuredClone(s));
}

function checkpointKey(s: StoredSceneSnapshot): string {
  return authoringSceneSignature(toSimulationSnapshot(normalizeStoredScene(s)));
}

/** Authoring undo/redo stack (setup-time scene edits). Not playback timeline samples. */
export class AuthoringUndoStack {
  private entries: StoredSceneSnapshot[] = [];
  private index = -1;

  reset(initial?: StoredSceneSnapshot): void {
    this.entries = initial ? [cloneStored(initial)] : [];
    this.index = this.entries.length > 0 ? 0 : -1;
    authoringUndoDebugLog(
      "reset",
      `entries=${this.entries.length} index=${this.index}${initial ? ` objs=${countSceneObjects(initial)}` : ""}`,
    );
  }

  pushFromSimulation(snap: SimulationSnapshot, gravityEnabled: boolean): void {
    this.push(snapshotForServer(snap, gravityEnabled));
  }

  push(entry: StoredSceneSnapshot): void {
    const normalized = normalizeStoredScene(entry);
    const cur = this.index >= 0 ? this.entries[this.index] : null;
    if (cur && checkpointKey(cur) === checkpointKey(normalized)) {
      authoringUndoDebugLog("push_dedupe", `skipped identical checkpoint (index=${this.index})`);
      return;
    }

    if (this.index >= 0 && this.index < this.entries.length - 1) {
      this.entries = this.entries.slice(0, this.index + 1);
    }
    this.entries.push(cloneStored(normalized));
    this.index = this.entries.length - 1;
    authoringUndoDebugLog(
      "push",
      `entries=${this.entries.length} index=${this.index} objs=${countSceneObjects(normalized)}`,
    );
    if (this.entries.length > MAX_ENTRIES) {
      const trim = this.entries.length - MAX_ENTRIES;
      this.entries = this.entries.slice(trim);
      this.index = this.entries.length - 1;
    }
  }

  canUndo(): boolean {
    return this.index > 0;
  }

  canRedo(): boolean {
    return this.index >= 0 && this.index < this.entries.length - 1;
  }

  undo(): StoredSceneSnapshot | null {
    if (!this.canUndo()) return null;
    this.index -= 1;
    return cloneStored(this.entries[this.index]!);
  }

  redo(): StoredSceneSnapshot | null {
    if (!this.canRedo()) return null;
    this.index += 1;
    return cloneStored(this.entries[this.index]!);
  }

  getDebugCounts(): {
    entryCount: number;
    index: number;
    canUndo: boolean;
    canRedo: boolean;
  } {
    return {
      entryCount: this.entries.length,
      index: this.index,
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
    };
  }

  getDebugEntrySummaries(): string[] {
    return this.entries.map((e, i) => {
      const n = countSceneObjects(e);
      const mk = e.markups?.length ?? 0;
      const marker = i === this.index ? "◀" : " ";
      return `${marker}[${i}] objs=${n} mk=${mk} g=${e.gravityEnabled !== false}`;
    });
  }
}

export const authoringUndoStack = new AuthoringUndoStack();
