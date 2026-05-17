/**
 * Canonical multiplayer event taxonomy. Transport-agnostic: map Supabase Realtime,
 * WebSockets, or future gateways to these kinds for validation and debugging.
 */

export const MultiplayerEventKind = {
  PLAYER_JOIN: "PLAYER_JOIN",
  PLAYER_LEAVE: "PLAYER_LEAVE",
  ROOM_SNAPSHOT: "ROOM_SNAPSHOT",
  ENTITY_CREATE: "ENTITY_CREATE",
  ENTITY_UPDATE: "ENTITY_UPDATE",
  ENTITY_DELETE: "ENTITY_DELETE",
  PHYSICS_TICK: "PHYSICS_TICK",
  STATE_RECONCILE: "STATE_RECONCILE",
  CONNECTION_LOST: "CONNECTION_LOST",
  CONNECTION_RESTORED: "CONNECTION_RESTORED",
  ROOM_CLOSED: "ROOM_CLOSED",
  CHAT_MESSAGE: "CHAT_MESSAGE",
  ANNOTATION: "ANNOTATION",
  SCENE_OP: "SCENE_OP",
  ROOM_METADATA: "ROOM_METADATA",
} as const;

export type MultiplayerEventKind =
  (typeof MultiplayerEventKind)[keyof typeof MultiplayerEventKind];

/** Required envelope for every inbound/outbound logical event. */
export interface NetworkEventEnvelope<T = unknown> {
  kind: MultiplayerEventKind | string;
  ts: number;
  roomId: string;
  senderId: string;
  /** Monotonic room document revision (e.g. scene_revision) or 0 if unknown. */
  version: number;
  /** Simulation or logical tick; 0 if N/A. */
  tick: number;
  payload: T;
}

export function createNetworkEvent<T>(params: {
  kind: MultiplayerEventKind | string;
  roomId: string;
  senderId: string;
  version?: number;
  tick?: number;
  payload: T;
}): NetworkEventEnvelope<T> {
  return {
    kind: params.kind,
    ts: Date.now(),
    roomId: params.roomId,
    senderId: params.senderId,
    version: params.version ?? 0,
    tick: params.tick ?? 0,
    payload: params.payload,
  };
}

/** Drop stale/out-of-order events when room version advanced past `appliedVersion`. */
export function shouldDiscardStaleEvent(
  appliedVersion: number,
  envelopeVersion: number,
): boolean {
  if (envelopeVersion <= 0 || appliedVersion < 0) return false;
  return envelopeVersion < appliedVersion;
}
