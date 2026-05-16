import type {
  ActionLogEntry,
  CanvasAnnotation,
  ChatMessage,
  UserPresence,
} from "./collaboration.js";
import type { RoomId, UserId } from "./ids.js";
import type { ClientAction, ActionAck } from "./actions.js";
import type { StateDelta, WorldKeyframe } from "./protocol.js";

/** Collaborative messages layered on top of simulation sync. */

export type CollaborationClientMessage =
  | { type: "presence"; roomId: RoomId; presence: UserPresence }
  | { type: "annotationAdd"; roomId: RoomId; annotation: CanvasAnnotation }
  | { type: "annotationRemove"; roomId: RoomId; annotationId: string }
  | { type: "chat"; roomId: RoomId; message: Omit<ChatMessage, "id" | "timestamp"> & { text: string } }
  | { type: "requestSync"; roomId: RoomId };

export type CollaborationServerMessage =
  | { type: "presenceSync"; roomId: RoomId; users: UserPresence[] }
  | { type: "annotationSync"; roomId: RoomId; annotations: CanvasAnnotation[] }
  | { type: "annotationAdded"; roomId: RoomId; annotation: CanvasAnnotation }
  | { type: "annotationRemoved"; roomId: RoomId; annotationId: string }
  | { type: "chatSync"; roomId: RoomId; messages: ChatMessage[] }
  | { type: "chatMessage"; roomId: RoomId; message: ChatMessage }
  | { type: "actionLogged"; roomId: RoomId; entry: ActionLogEntry };

export type ExtendedClientMessage =
  | { type: "join"; roomId: RoomId; userId: UserId; displayName?: string }
  | { type: "action"; roomId: RoomId; sequence: number; action: ClientAction }
  | { type: "ping"; ts: number }
  | CollaborationClientMessage;

export type ExtendedServerMessage =
  | { type: "joined"; roomId: RoomId; keyframe: WorldKeyframe; tick: number }
  | { type: "delta"; roomId: RoomId; delta: StateDelta }
  | { type: "keyframe"; roomId: RoomId; keyframe: WorldKeyframe }
  | { type: "actionAck"; ack: ActionAck }
  | { type: "error"; code: string; message: string }
  | { type: "pong"; ts: number }
  | CollaborationServerMessage;
