import type { SnapshotId } from "@flux/shared";
import { snapshotId, generateId } from "@flux/shared";
import type { StateDelta } from "@flux/shared";
import type { WorldState } from "../world/worldState.js";
import { cloneWorldState } from "../world/worldState.js";
import { computeStateDelta } from "../network/stateDelta.js";

export interface StoredSnapshot {
  id: SnapshotId;
  tick: number;
  time: number;
  state: WorldState;
  /** Patch from previous tick (for compact replay storage). */
  deltaFromPrevious?: StateDelta;
}

/**
 * Indexed tick history: scrub, rewind, deterministic replay preparation.
 */
export class SnapshotStore {
  private snapshots: StoredSnapshot[] = [];
  private byTick = new Map<number, StoredSnapshot>();
  private maxSnapshots: number;
  private lastStored: WorldState | null = null;

  constructor(maxSnapshots = 3600) {
    this.maxSnapshots = maxSnapshots;
  }

  append(state: WorldState): StoredSnapshot {
    const deltaFromPrevious =
      this.lastStored !== null
        ? computeStateDelta(this.lastStored, state)
        : undefined;

    const stored: StoredSnapshot = {
      id: snapshotId(generateId("snap")),
      tick: state.tick,
      time: state.time,
      state: cloneWorldState(state),
      ...(deltaFromPrevious !== undefined ? { deltaFromPrevious } : {}),
    };

    this.snapshots.push(stored);
    this.byTick.set(state.tick, stored);
    this.lastStored = cloneWorldState(state);

    if (this.snapshots.length > this.maxSnapshots) {
      const removed = this.snapshots.shift();
      if (removed) this.byTick.delete(removed.tick);
    }
    return stored;
  }

  getAtTick(tick: number): StoredSnapshot | undefined {
    return this.byTick.get(tick) ?? this.findNearestAtOrBefore(tick);
  }

  getExactTick(tick: number): StoredSnapshot | undefined {
    return this.byTick.get(tick);
  }

  rewindTo(tick: number): WorldState | null {
    const snap = this.getAtTick(tick);
    if (!snap) return null;
    return cloneWorldState(snap.state);
  }

  getLatest(): StoredSnapshot | undefined {
    return this.snapshots[this.snapshots.length - 1];
  }

  getPrevious(): StoredSnapshot | undefined {
    if (this.snapshots.length < 2) return undefined;
    return this.snapshots[this.snapshots.length - 2];
  }

  list(): readonly StoredSnapshot[] {
    return this.snapshots;
  }

  tickRange(): { min: number; max: number } | null {
    if (this.snapshots.length === 0) return null;
    return {
      min: this.snapshots[0]!.tick,
      max: this.snapshots[this.snapshots.length - 1]!.tick,
    };
  }

  private findNearestAtOrBefore(tick: number): StoredSnapshot | undefined {
    for (let i = this.snapshots.length - 1; i >= 0; i--) {
      const s = this.snapshots[i];
      if (s && s.tick <= tick) return s;
    }
    return undefined;
  }
}
