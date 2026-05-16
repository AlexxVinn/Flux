import { WebSocketServer, type WebSocket } from "ws";
import type { ExtendedClientMessage } from "@flux/shared";
import { userId as toUserId } from "@flux/shared";
import { RoomManager } from "./room/roomManager.js";

const PORT = Number(process.env.PORT ?? 3001);

const roomManager = new RoomManager();

const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (ws: WebSocket) => {
  let joinedRoom: ReturnType<RoomManager["get"]> | undefined;

  ws.on("message", (raw) => {
    try {
      const message = JSON.parse(String(raw)) as ExtendedClientMessage;

      if (message.type === "join") {
        joinedRoom = roomManager.getOrCreate(message.roomId);
        joinedRoom.addClient(
          ws,
          toUserId(message.userId),
          "displayName" in message ? message.displayName : undefined,
        );
        return;
      }

      if (!joinedRoom) {
        ws.send(
          JSON.stringify({
            type: "error",
            code: "NOT_JOINED",
            message: "Send join before other messages",
          }),
        );
        return;
      }

      joinedRoom.handleMessage(ws, message);
    } catch {
      ws.send(
        JSON.stringify({
          type: "error",
          code: "INVALID_MESSAGE",
          message: "Failed to parse message",
        }),
      );
    }
  });

  ws.on("close", () => {
    joinedRoom?.removeClient(ws);
  });
});

console.log(`flux server listening on ws://localhost:${PORT}`);
