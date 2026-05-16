import type { EntityId } from "@flux/shared";
import {
  type ComponentBag,
  type ComponentKind,
  type ComponentData,
  ComponentKind as CK,
} from "@flux/shared";
import { SCHEMA_VERSION, deepClone } from "@flux/shared";

export interface WorldMetadata {
  name: string;
  gravity: { x: number; y: number };
  /** RNG seed for reproducible experiments. */
  seed: number;
}

export interface WorldState {
  schemaVersion: number;
  tick: number;
  /** Simulation time in seconds. */
  time: number;
  entities: Map<EntityId, ComponentBag>;
  metadata: WorldMetadata;
}

export function createWorldState(metadata?: Partial<WorldMetadata>): WorldState {
  return {
    schemaVersion: SCHEMA_VERSION,
    tick: 0,
    time: 0,
    entities: new Map(),
    metadata: {
      name: metadata?.name ?? "Untitled Experiment",
      gravity: metadata?.gravity ?? { x: 0, y: 9.81 },
      seed: metadata?.seed ?? 1,
    },
  };
}

export function cloneWorldState(state: WorldState): WorldState {
  const entities = new Map<EntityId, ComponentBag>();
  for (const [id, bag] of state.entities) {
    entities.set(id, cloneComponentBag(bag));
  }
  return {
    schemaVersion: state.schemaVersion,
    tick: state.tick,
    time: state.time,
    entities,
    metadata: { ...state.metadata },
  };
}

function cloneComponentBag(bag: ComponentBag): ComponentBag {
  const out: ComponentBag = {};
  for (const k of Object.keys(bag) as ComponentKind[]) {
    const c = bag[k];
    if (c) out[k] = deepClone(c);
  }
  return out;
}

export function getComponent<K extends ComponentKind>(
  state: WorldState,
  entityId: EntityId,
  kind: K,
): ComponentData | undefined {
  return state.entities.get(entityId)?.[kind];
}

export function setComponent(
  state: WorldState,
  entityId: EntityId,
  component: ComponentData,
): void {
  let bag = state.entities.get(entityId);
  if (!bag) {
    bag = {};
    state.entities.set(entityId, bag);
  }
  bag[component.kind] = component;
}

export function removeEntity(state: WorldState, entityId: EntityId): boolean {
  return state.entities.delete(entityId);
}

export function hasComponents(
  bag: ComponentBag,
  required: readonly ComponentKind[],
): boolean {
  return required.every((k) => bag[k] !== undefined);
}

/** Sorted entity IDs for deterministic iteration. */
export function entityIdsSorted(state: WorldState): EntityId[] {
  return [...state.entities.keys()].sort();
}
