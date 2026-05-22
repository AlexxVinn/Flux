import type {
  RopeSnapshot,
  SimBodySnapshot,
  SimulationSnapshot,
  SpringSnapshot,
} from "@/lib/physics/types";
import type { MatterSimulationEngine } from "@/lib/physics/matterEngine";
import type { SceneOp } from "@/lib/scene/storedScene";
import { sanitizeRopeForCollab } from "@/lib/scene/storedScene";
import { PIXELS_PER_METER } from "@/lib/physics/units";

/** In-memory authoring clipboard (same tab). Not OS clipboard. */
export interface AuthoringClipboardFragment {
  bodies: SimBodySnapshot[];
  springs: SpringSnapshot[];
  ropes: RopeSnapshot[];
}

const PASTE_OFFSET_METERS = 0.5;
const DUPLICATE_OFFSET_METERS = 0.06;

/** World-space offset (~0.5 m) for pasted clusters. */
export const PASTE_OFFSET_PX = PASTE_OFFSET_METERS * PIXELS_PER_METER;

/** Tiny diagonal offset so duplicates don’t overlap exactly when stacked. */
export const DUPLICATE_CLUSTER_OFFSET_PX = DUPLICATE_OFFSET_METERS * PIXELS_PER_METER;

function isWallOrFloor(b: SimBodySnapshot): boolean {
  return b.entityKind === "wall" || b.entityKind === "floor";
}

function isAuthoringPasteableBody(b: SimBodySnapshot): boolean {
  if (b.visible === false) return false;
  if (isWallOrFloor(b)) return false;
  if (b.entityKind === "ropeSegment") return false;
  return true;
}

function isStructuralAnchor(body: SimBodySnapshot | undefined): boolean {
  if (!body) return false;
  return body.isStatic || body.entityKind === "floor" || body.entityKind === "wall" || body.entityKind === "collisionBounds";
}

function deepCloneBody(b: SimBodySnapshot): SimBodySnapshot {
  return { ...b };
}

function cloneSpring(s: SpringSnapshot): SpringSnapshot {
  return {
    ...s,
    anchorA: s.anchorA ? { ...s.anchorA } : undefined,
    anchorB: s.anchorB ? { ...s.anchorB } : undefined,
  };
}

function cloneRope(r: RopeSnapshot): RopeSnapshot {
  return sanitizeRopeForCollab({
    ...r,
    anchorA: r.anchorA ? { ...r.anchorA } : undefined,
    anchorB: r.anchorB ? { ...r.anchorB } : undefined,
    particles: r.particles?.map((p) => ({ ...p })),
  });
}

/**
 * Build an authoring clipboard from the current snapshot + selection (entity ids).
 * Expands springs/ropes into their endpoint bodies where needed so copy always carries geometry.
 */
export function extractAuthoringClipboard(
  snapshot: SimulationSnapshot,
  selectedIds: string[],
): AuthoringClipboardFragment | null {
  if (selectedIds.length === 0) return null;

  const bodiesById = new Map(snapshot.bodies.map((b) => [b.id, b]));
  const selected = new Set(selectedIds);

  const bodySeed = new Set<string>();
  for (const id of selectedIds) {
    const sp = snapshot.springs.find((s) => s.id === id);
    if (sp) {
      bodySeed.add(sp.bodyA);
      bodySeed.add(sp.bodyB);
      continue;
    }
    const rp = (snapshot.ropes ?? []).find((r) => r.id === id);
    if (rp) {
      bodySeed.add(rp.bodyA);
      bodySeed.add(rp.bodyB);
      continue;
    }
    const b = bodiesById.get(id);
    if (b && isAuthoringPasteableBody(b)) bodySeed.add(id);
  }

  const fragmentBodies: SimBodySnapshot[] = [];
  const fragmentIds = new Set<string>();
  for (const bid of bodySeed) {
    const b = bodiesById.get(bid);
    if (!b || !isAuthoringPasteableBody(b)) continue;
    fragmentBodies.push(deepCloneBody(b));
    fragmentIds.add(bid);
  }

  const springs: SpringSnapshot[] = [];
  for (const s of snapshot.springs) {
    if (!selected.has(s.id)) continue;
    const a = bodiesById.get(s.bodyA);
    const b = bodiesById.get(s.bodyB);
    const aCopied = fragmentIds.has(s.bodyA);
    const bCopied = fragmentIds.has(s.bodyB);
    if (aCopied && bCopied) {
      springs.push(cloneSpring(s));
      continue;
    }
    if (aCopied && isStructuralAnchor(b)) {
      springs.push(cloneSpring(s));
      continue;
    }
    if (bCopied && isStructuralAnchor(a)) {
      springs.push(cloneSpring(s));
    }
  }

  const ropes: RopeSnapshot[] = [];
  for (const r of snapshot.ropes ?? []) {
    if (!selected.has(r.id)) continue;
    const a = bodiesById.get(r.bodyA);
    const b = bodiesById.get(r.bodyB);
    const aCopied = fragmentIds.has(r.bodyA);
    const bCopied = fragmentIds.has(r.bodyB);
    if (aCopied && bCopied) {
      ropes.push(cloneRope(r));
      continue;
    }
    if (aCopied && isStructuralAnchor(b)) {
      ropes.push(cloneRope(r));
      continue;
    }
    if (bCopied && isStructuralAnchor(a)) {
      ropes.push(cloneRope(r));
    }
  }

  if (fragmentBodies.length === 0 && springs.length === 0 && ropes.length === 0) return null;
  return { bodies: fragmentBodies, springs, ropes };
}

function newEntityId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 18)}`;
  }
  return `${prefix}_${Math.random().toString(36).slice(2, 14)}`;
}

export interface PasteBuildResult {
  /** Bodies as they should appear after offset (already remapped IDs). */
  bodies: SimBodySnapshot[];
  springs: SpringSnapshot[];
  ropes: RopeSnapshot[];
  ops: SceneOp[];
}

/**
 * Produce remapped authoring entities + SceneOps for collab (`entity.add.*`).
 */
export function remapClipboardForPaste(
  fragment: AuthoringClipboardFragment,
  dx: number,
  dy: number,
): PasteBuildResult {
  const idMap = new Map<string, string>();
  for (const b of fragment.bodies) {
    idMap.set(b.id, newEntityId(b.shape === "circle" ? "body" : "body"));
  }

  const bump = (sx: SimBodySnapshot, nid: string): SimBodySnapshot => ({
    ...sx,
    id: nid,
    x: sx.x + dx,
    y: sx.y + dy,
  });

  const bodies: SimBodySnapshot[] = fragment.bodies.map((b) => bump(b, idMap.get(b.id)!));

  const mapEnd = (oid: string) => idMap.get(oid) ?? oid;

  const springs: SpringSnapshot[] = fragment.springs.map((s) => ({
    ...s,
    id: newEntityId("spring"),
    displayName: s.displayName,
    bodyA: mapEnd(s.bodyA),
    bodyB: mapEnd(s.bodyB),
    anchorA: s.anchorA ? { ...s.anchorA } : undefined,
    anchorB: s.anchorB ? { ...s.anchorB } : undefined,
  }));

  const ropes: RopeSnapshot[] = fragment.ropes.map((r) => {
    const nr: RopeSnapshot = {
      ...r,
      id: newEntityId("rope"),
      displayName: r.displayName,
      bodyA: mapEnd(r.bodyA),
      bodyB: mapEnd(r.bodyB),
      anchorA: r.anchorA ? { ...r.anchorA } : undefined,
      anchorB: r.anchorB ? { ...r.anchorB } : undefined,
    };
    return sanitizeRopeForCollab(nr);
  });

  const ops: SceneOp[] = [];
  const bodiesMain = bodies.filter((b) => b.entityKind !== "collisionBounds");
  const bodiesBounds = bodies.filter((b) => b.entityKind === "collisionBounds");
  for (const b of bodiesMain) ops.push({ type: "entity.add.body", body: b });
  for (const b of bodiesBounds) ops.push({ type: "entity.add.body", body: b });
  for (const s of springs) ops.push({ type: "entity.add.spring", spring: s });
  for (const r of ropes) ops.push({ type: "entity.add.rope", rope: r });

  return { bodies, springs, ropes, ops };
}

/**
 * Instantiate pasted authoring bodies/connectors locally (mirror of SceneOps order).
 */
export function instantiatePasteOnEngine(engine: MatterSimulationEngine, pasted: PasteBuildResult): string[] {
  const createdIds: string[] = [];
  const { bodies } = pasted;

  const main = bodies.filter((b) => b.entityKind !== "collisionBounds");
  const bounds = bodies.filter((b) => b.entityKind === "collisionBounds");

  for (const b of main) {
    if (b.shape === "circle") {
      engine.spawnCircle(b.x, b.y, b.width / 2, b.id);
      applySpawnedBodyProps(engine, b);
      createdIds.push(b.id);
    } else {
      engine.spawnRectangle(b.x, b.y, b.width, b.height, b.entityKind, b.displayName, b.id);
      applySpawnedBodyProps(engine, b);
      createdIds.push(b.id);
    }
  }

  for (const b of bounds) {
    engine.spawnCollisionBounds(b.x, b.y, b.width, b.height, b.id, b.displayName);
    applySpawnedBodyProps(engine, b);
    createdIds.push(b.id);
  }

  for (const s of pasted.springs) {
    engine.connectSpring(s.bodyA, s.bodyB, {
      stiffness: s.stiffness,
      damping: s.damping,
      length: s.length > 0 ? s.length : undefined,
      elasticConstantNnPerM: s.elasticConstantNnPerM,
      id: s.id,
      pointA: s.anchorA ?? { x: 0, y: 0 },
      pointB: s.anchorB ?? { x: 0, y: 0 },
    });
    if (engine.snapshot().springs.some((sp) => sp.id === s.id)) {
      engine.renameEntity(s.id, s.displayName);
      createdIds.push(s.id);
    }
  }

  for (const r of pasted.ropes) {
    engine.connectRope(r.bodyA, r.bodyB, {
      id: r.id,
      displayName: r.displayName,
      segmentCount: r.segmentCount,
      linkStiffness: r.linkStiffness,
      linkDamping: r.linkDamping,
      pointA: r.anchorA,
      pointB: r.anchorB,
    });
    createdIds.push(r.id);
  }

  engine.resetAllVerletRopes();
  engine.clearBodyForces();
  return createdIds;
}

function applySpawnedBodyProps(engine: MatterSimulationEngine, b: SimBodySnapshot): void {
  engine.updateBodyProps(b.id, {
    isStatic: b.isStatic,
    restitution: b.restitution,
    friction: b.friction,
    frictionStatic: b.frictionStatic,
    frictionAir: b.frictionAir,
    mass: b.isStatic ? undefined : b.mass,
    density: b.isStatic ? undefined : b.density,
    velocityX: b.velocityX,
    velocityY: b.velocityY,
    angularVelocity: b.angularVelocity,
    angle: b.angle,
    gravityScale: b.gravityScale,
  });
  if (b.visible === false) engine.setBodyVisible(b.id, false);
  if (b.showTrajectory) engine.setBodyShowTrajectory(b.id, true);
}
