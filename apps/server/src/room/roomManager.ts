import type { RoomId, UserId } from "@flux/shared";
import { roomId as toRoomId } from "@flux/shared";
import { SimulationRoom } from "./simulationRoom.js";

export class RoomManager {
  private rooms = new Map<RoomId, SimulationRoom>();

  getOrCreate(id: RoomId): SimulationRoom {
    let room = this.rooms.get(id);
    if (!room) {
      room = new SimulationRoom(id);
      this.rooms.set(id, room);
    }
    return room;
  }

  get(id: RoomId): SimulationRoom | undefined {
    return this.rooms.get(id);
  }

  /** Default demo room for local development. */
  defaultRoom(): SimulationRoom {
    return this.getOrCreate(toRoomId("demo"));
  }
}
