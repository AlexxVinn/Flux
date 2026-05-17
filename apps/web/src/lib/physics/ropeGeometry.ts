import type { RopeSnapshot, SimBodySnapshot } from "./types";
import { attachWorldFromLocal } from "./bodyAttachPoint";
import { anchorCollisionRadius, anchorSurfaceWorld } from "./ropeGeometryAnchors";

export { anchorCollisionRadius, anchorSurfaceWorld } from "./ropeGeometryAnchors";

export function ropeAnchorWorld(
  rope: Pick<RopeSnapshot, "bodyA" | "bodyB" | "anchorA" | "anchorB">,
  bodyA: SimBodySnapshot,
  bodyB: SimBodySnapshot,
): { surfA: { x: number; y: number }; surfB: { x: number; y: number } } | null {
  if (rope.anchorA && rope.anchorB) {
    return {
      surfA: attachWorldFromLocal(bodyA, rope.anchorA.x, rope.anchorA.y),
      surfB: attachWorldFromLocal(bodyB, rope.anchorB.x, rope.anchorB.y),
    };
  }
  const dx = bodyB.x - bodyA.x;
  const dy = bodyB.y - bodyA.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-3) return null;
  const ux = dx / dist;
  const uy = dy / dist;
  const ra = anchorCollisionRadius(bodyA.width, bodyA.height, bodyA.shape);
  const rb = anchorCollisionRadius(bodyB.width, bodyB.height, bodyB.shape);
  return {
    surfA: anchorSurfaceWorld(bodyA.x, bodyA.y, ux, uy, ra, true),
    surfB: anchorSurfaceWorld(bodyB.x, bodyB.y, ux, uy, rb, false),
  };
}

/** Pick / render polyline from simulated particles (physics truth). */
export function ropePolylineFromSnapshot(rope: RopeSnapshot): { x: number; y: number }[] {
  if (rope.particles && rope.particles.length >= 2) {
    return rope.particles.map((p) => ({ x: p.x, y: p.y }));
  }
  return [];
}
