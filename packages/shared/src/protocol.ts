import type { RoomId, UserId } from "./ids.js";
import type { ClientAction, ActionAck } from "./actions.js";
import type { ComponentKind, ComponentData } from "./components.js";
import type { EntityId } from "./ids.js";

/** Wire messages between client and server. */

export type ClientMessage =
  | { type: "join"; roomId: RoomId; userId: UserId }
  | { type: "action"; roomId: RoomId; sequence: number; action: ClientAction }
  | { type: "ping"; ts: number };

export type EntityPatch = Partial<Record<ComponentKind, ComponentData>>;

export interface StateDelta {
  tick: number;
  time: number;
  entityPatches: Record<EntityId, EntityPatch>;
  removedEntities: EntityId[];
}

export interface WorldKeyframe {
  tick: number;
  time: number;
  schemaVersion: number;
  entities: Record<EntityId, Partial<Record<ComponentKind, ComponentData>>>;
  constraints: unknown[];
}

export type ServerMessage =
  | { type: "joined"; roomId: RoomId; keyframe: WorldKeyframe; tick: number }
  | { type: "delta"; roomId: RoomId; delta: StateDelta }
  | { type: "keyframe"; roomId: RoomId; keyframe: WorldKeyframe }
  | { type: "actionAck"; ack: ActionAck }
  | { type: "error"; code: string; message: string }
  | { type: "pong"; ts: number };

export const PROTOCOL_VERSION = 1;
export const SCHEMA_VERSION = 1;
