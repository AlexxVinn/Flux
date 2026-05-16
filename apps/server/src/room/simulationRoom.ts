import type { ActionLogEntry, UserId, RoomId } from "@flux/shared";
import type { ExtendedClientMessage, ExtendedServerMessage } from "@flux/shared";
import type { ClientAction } from "@flux/shared";
import {
  SimulationOrchestrator,
  worldToKeyframe,
  seedDemoScene,
} from "@flux/sim-core";
import type { WebSocket } from "ws";
import { CollaborationState } from "./collaborationState.js";

const KEYFRAME_INTERVAL_TICKS = 300;

const USER_COLORS = [
  "#6ee7b7",
  "#60a5fa",
  "#f472b6",
  "#fbbf24",
  "#a78bfa",
  "#fb923c",
];

export class SimulationRoom {
  readonly id: RoomId;
  private orchestrator: SimulationOrchestrator;
  private clients = new Map<WebSocket, { userId: UserId; displayName: string }>();
  private collaboration = new CollaborationState();
  private lastKeyframeTick = 0;
  private tickLoop: ReturnType<typeof setInterval> | null = null;
  private colorIndex = 0;

  constructor(id: RoomId) {
    this.id = id;
    this.orchestrator = new SimulationOrchestrator({ fixedTimestep: 1 / 60 });
    seedDemoScene(this.orchestrator);
    this.startTickLoop();
  }

  private startTickLoop(): void {
    const dt = 1 / 60;
    this.tickLoop = setInterval(() => {
      const results = this.orchestrator.simulate(dt);
      for (const { delta } of results) {
        if (
          (delta.entityPatches && Object.keys(delta.entityPatches).length > 0) ||
          delta.removedEntities.length > 0
        ) {
          this.broadcast({ type: "delta", roomId: this.id, delta });
        }
        const tick = this.orchestrator.getState().tick;
        if (tick - this.lastKeyframeTick >= KEYFRAME_INTERVAL_TICKS) {
          this.lastKeyframeTick = tick;
          this.broadcast({
            type: "keyframe",
            roomId: this.id,
            keyframe: worldToKeyframe(this.orchestrator.getState()),
          });
        }
      }
    }, 1000 / 60);
  }

  addClient(ws: WebSocket, userId: UserId, displayName?: string): void {
    const name = displayName ?? `User ${userId.slice(0, 4)}`;
    const color = USER_COLORS[this.colorIndex % USER_COLORS.length]!;
    this.colorIndex += 1;
    this.clients.set(ws, { userId, displayName: name });
    this.collaboration.setPresence({
      userId,
      displayName: name,
      color,
    });

    const state = this.orchestrator.getState();
    this.send(ws, {
      type: "joined",
      roomId: this.id,
      keyframe: worldToKeyframe(state),
      tick: state.tick,
    });
    this.sendCollaborationSync(ws);
    this.broadcastPresence();
  }

  removeClient(ws: WebSocket): void {
    const client = this.clients.get(ws);
    if (client) {
      this.collaboration.removePresence(client.userId);
      this.clients.delete(ws);
      this.broadcastPresence();
    }
  }

  handleMessage(ws: WebSocket, message: ExtendedClientMessage): void {
    const client = this.clients.get(ws);
    if (!client && message.type !== "join") return;

    switch (message.type) {
      case "action": {
        const result = this.orchestrator.submitAction(message.action);
        this.send(ws, {
          type: "actionAck",
          ack: {
            actionId: message.action.actionId,
            accepted: result.accepted,
            tick: this.orchestrator.getState().tick,
            ...(result.reason !== undefined ? { reason: result.reason } : {}),
          },
        });
        if (result.accepted && client) {
          this.logAction(client, message.action);
        }
        break;
      }
      case "presence":
        if (client) {
          this.collaboration.setPresence({
            ...message.presence,
            userId: client.userId,
            displayName: client.displayName,
          });
          this.broadcastPresence();
        }
        break;
      case "annotationAdd":
        this.collaboration.addAnnotation(message.annotation);
        this.broadcast({
          type: "annotationAdded",
          roomId: this.id,
          annotation: message.annotation,
        });
        break;
      case "annotationRemove":
        if (this.collaboration.removeAnnotation(message.annotationId)) {
          this.broadcast({
            type: "annotationRemoved",
            roomId: this.id,
            annotationId: message.annotationId,
          });
        }
        break;
      case "chat": {
        if (!client) break;
        const msg = {
          id: `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          userId: client.userId,
          displayName: client.displayName,
          text: message.message.text,
          timestamp: Date.now(),
        };
        this.collaboration.addChat(msg);
        this.broadcast({ type: "chatMessage", roomId: this.id, message: msg });
        break;
      }
      case "requestSync":
        this.sendCollaborationSync(ws);
        break;
      case "ping":
        this.send(ws, { type: "pong", ts: message.ts });
        break;
      default:
        break;
    }
  }

  private logAction(
    client: { userId: UserId; displayName: string },
    action: ClientAction,
  ): void {
    const entry: ActionLogEntry = {
      id: `log_${Date.now()}_${action.actionId}`,
      userId: client.userId,
      displayName: client.displayName,
      summary: actionSummary(action),
      actionType: action.type,
      tick: this.orchestrator.getState().tick,
      timestamp: Date.now(),
      ...("entityId" in action ? { entityId: action.entityId } : {}),
    };
    this.collaboration.logAction(entry);
    this.broadcast({ type: "actionLogged", roomId: this.id, entry });
  }

  private sendCollaborationSync(ws: WebSocket): void {
    this.send(ws, {
      type: "presenceSync",
      roomId: this.id,
      users: this.collaboration.listPresence(),
    });
    this.send(ws, {
      type: "annotationSync",
      roomId: this.id,
      annotations: this.collaboration.listAnnotations(),
    });
    this.send(ws, {
      type: "chatSync",
      roomId: this.id,
      messages: [...this.collaboration.chat],
    });
    for (const entry of this.collaboration.actionLog.slice(-50)) {
      this.send(ws, { type: "actionLogged", roomId: this.id, entry });
    }
  }

  private broadcastPresence(): void {
    this.broadcast({
      type: "presenceSync",
      roomId: this.id,
      users: this.collaboration.listPresence(),
    });
  }

  private send(ws: WebSocket, message: ExtendedServerMessage): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
  }

  private broadcast(message: ExtendedServerMessage): void {
    const payload = JSON.stringify(message);
    for (const ws of this.clients.keys()) {
      if (ws.readyState === ws.OPEN) ws.send(payload);
    }
  }

  dispose(): void {
    if (this.tickLoop) clearInterval(this.tickLoop);
    this.clients.clear();
  }

  get clientCount(): number {
    return this.clients.size;
  }
}

function actionSummary(action: ClientAction): string {
  switch (action.type) {
    case "createEntity":
      return `Created entity ${action.entityId}`;
    case "deleteEntity":
      return `Deleted entity ${action.entityId}`;
    case "setComponent":
      return `Updated ${action.component.kind} on ${action.entityId}`;
    case "applyForce":
      return `Applied force to ${action.entityId}`;
    case "setTransform":
      return `Moved ${action.entityId}`;
    case "createSpring":
      return `Connected spring ${action.constraintId}`;
    default:
      return "Unknown action";
  }
}
