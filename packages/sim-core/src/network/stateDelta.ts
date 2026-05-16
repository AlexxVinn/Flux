import type { EntityId, EntityPatch, StateDelta, WorldKeyframe } from "@flux/shared";
import { deepClone } from "@flux/shared";
import type { ComponentKind, ComponentData } from "@flux/shared";
import type { WorldState } from "../world/worldState.js";
import { cloneWorldState, createWorldState } from "../world/worldState.js";

/** Compute component-level patch between two world states. */
export function computeStateDelta(
  prev: WorldState,
  next: WorldState,
): StateDelta {
  const entityPatches: Record<EntityId, EntityPatch> = {};
  const removedEntities: EntityId[] = [];

  for (const id of prev.entities.keys()) {
    if (!next.entities.has(id)) {
      removedEntities.push(id);
    }
  }

  for (const [id, nextBag] of next.entities) {
    const prevBag = prev.entities.get(id);
    const patch: EntityPatch = {};
    let changed = false;

    for (const kind of Object.keys(nextBag) as ComponentKind[]) {
      const nextC = nextBag[kind];
      const prevC = prevBag?.[kind];
      if (!nextC) continue;
      if (!prevC || !componentsEqual(prevC, nextC)) {
        patch[kind] = deepClone(nextC);
        changed = true;
      }
    }

    if (!prevBag) changed = true;
    if (changed) entityPatches[id] = patch;
  }

  return {
    tick: next.tick,
    time: next.time,
    entityPatches,
    removedEntities,
  };
}

function componentsEqual(a: ComponentData, b: ComponentData): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function worldToKeyframe(state: WorldState): WorldKeyframe {
  const entities: WorldKeyframe["entities"] = {};
  for (const [id, bag] of state.entities) {
    const copy: Partial<Record<ComponentKind, ComponentData>> = {};
    for (const k of Object.keys(bag) as ComponentKind[]) {
      const c = bag[k];
      if (c) copy[k] = deepClone(c);
    }
    entities[id] = copy;
  }
  return {
    tick: state.tick,
    time: state.time,
    schemaVersion: state.schemaVersion,
    entities,
    constraints: [],
  };
}

export function applyKeyframe(state: WorldState, keyframe: WorldKeyframe): void {
  state.tick = keyframe.tick;
  state.time = keyframe.time;
  state.schemaVersion = keyframe.schemaVersion;
  state.entities.clear();
  for (const [id, bag] of Object.entries(keyframe.entities)) {
    state.entities.set(id as EntityId, { ...bag });
  }
}

export function keyframeToWorld(keyframe: WorldKeyframe): WorldState {
  const state = createWorldState();
  applyKeyframe(state, keyframe);
  return state;
}
