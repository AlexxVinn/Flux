import { ropePolylineFromSnapshot } from "@/lib/physics/ropeGeometry";
import type { SimulationSnapshot } from "@/lib/physics/types";
import type { UserPresence } from "@flux/shared";
import { COLLISION_FRAME_WALL_THICKNESS } from "@/lib/physics/physicsConstants";

export interface EntityBounds {
  id: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  anchorX: number;
  anchorY: number;
}

export interface PeerEntityMark {
  userId: string;
  displayName: string;
  color: string;
}

export function getEntityBounds(
  snapshot: SimulationSnapshot,
  entityId: string,
): EntityBounds | null {
  const body = snapshot.bodies.find((b) => b.id === entityId);
  if (body?.visible) {
    const rim = body.entityKind === "collisionBounds" ? COLLISION_FRAME_WALL_THICKNESS : 0;
    const hw = body.width / 2 + rim;
    const hh = body.height / 2 + rim;
    return {
      id: entityId,
      minX: body.x - hw,
      minY: body.y - hh,
      maxX: body.x + hw,
      maxY: body.y + hh,
      anchorX: body.x - hw,
      anchorY: body.y - hh,
    };
  }

  const spring = snapshot.springs.find((s) => s.id === entityId);
  if (spring?.visible) {
    const a = snapshot.bodies.find((b) => b.id === spring.bodyA);
    const b = snapshot.bodies.find((b) => b.id === spring.bodyB);
    if (!a?.visible || !b?.visible) return null;
    const pad = 10;
    return {
      id: entityId,
      minX: Math.min(a.x, b.x) - pad,
      minY: Math.min(a.y, b.y) - pad,
      maxX: Math.max(a.x, b.x) + pad,
      maxY: Math.max(a.y, b.y) + pad,
      anchorX: Math.min(a.x, b.x) - pad,
      anchorY: Math.min(a.y, b.y) - pad,
    };
  }

  const rope = (snapshot.ropes ?? []).find((r) => r.id === entityId);
  if (rope?.visible) {
    const pts = ropePolylineFromSnapshot(rope);
    if (pts.length < 2) return null;
    const pad = 10;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    return {
      id: entityId,
      minX: minX - pad,
      minY: minY - pad,
      maxX: maxX + pad,
      maxY: maxY + pad,
      anchorX: minX - pad,
      anchorY: minY - pad,
    };
  }

  return null;
}

/** Map entity id → peers who have it selected (excludes self). */
export function buildPeerMarksByEntity(
  peers: UserPresence[],
  snapshot: SimulationSnapshot,
  selfUserId: string,
): Map<string, PeerEntityMark[]> {
  const map = new Map<string, PeerEntityMark[]>();

  for (const peer of peers) {
    if (peer.userId === selfUserId) continue;
    const ids = peer.selectedIds ?? [];
    if (ids.length === 0) continue;
    for (const entityId of ids) {
      if (!getEntityBounds(snapshot, entityId)) continue;
      const list = map.get(entityId) ?? [];
      if (!list.some((m) => m.userId === peer.userId)) {
        list.push({
          userId: peer.userId,
          displayName: peer.displayName,
          color: peer.color,
        });
        map.set(entityId, list);
      }
    }
  }

  return map;
}
