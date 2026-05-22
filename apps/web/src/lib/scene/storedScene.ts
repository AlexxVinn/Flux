/**
 * Authoritative scene document (DB) — extends {@link SimulationSnapshot} with metadata.
 */
import type {
  RopeSnapshot,
  SceneMarkupSnapshot,
  SimBodySnapshot,
  SimulationSnapshot,
  SpringSnapshot,
} from "@/lib/physics/types";
import {
  inferElasticKnFromMatterConstraintStiffness,
  matterConstraintDampingFromElasticKn,
  matterConstraintStiffnessFromElasticKn,
} from "@/lib/physics/springDefaults";

export const STORED_SCENE_SCHEMA_VERSION = 1;

export interface StoredSceneSnapshot extends SimulationSnapshot {
  schemaVersion?: number;
  gravityEnabled?: boolean;
}

export type SceneOp =
  | { type: "entity.add.body"; body: SimBodySnapshot }
  | { type: "entity.add.spring"; spring: SpringSnapshot }
  | { type: "entity.add.rope"; rope: RopeSnapshot }
  | { type: "entity.add.markup"; markup: SceneMarkupSnapshot }
  | { type: "entity.remove"; id: string }
  | { type: "entity.patch.body"; id: string; patch: Partial<SimBodySnapshot> }
  | {
      type: "entity.patch.spring";
      id: string;
      patch: Partial<
        Pick<SpringSnapshot, "stiffness" | "damping" | "length" | "elasticConstantNnPerM" | "visible" | "locked" | "displayName">
      >;
    }
  | {
      type: "entity.patch.rope";
      id: string;
      patch: Partial<
        Pick<RopeSnapshot, "linkStiffness" | "linkDamping" | "segmentCount" | "visible" | "locked" | "displayName">
      >;
    }
  | {
      type: "entity.patch.markup";
      id: string;
      patch: Partial<
        Pick<SceneMarkupSnapshot, "points" | "text" | "visible" | "locked" | "displayName" | "measureUnit">
      >;
    }
  | { type: "scene.gravity"; gravityEnabled: boolean }
  | { type: "scene.replace"; snapshot: StoredSceneSnapshot }
  | { type: "batch"; ops: SceneOp[] };

const BODY_PATCH_KEYS = new Set([
  "x",
  "y",
  "angle",
  "width",
  "height",
  "velocityX",
  "velocityY",
  "angularVelocity",
  "mass",
  "density",
  "restitution",
  "friction",
  "frictionStatic",
  "frictionAir",
  "isStatic",
  "visible",
  "locked",
  "showTrajectory",
  "displayName",
  "label",
  "gravityScale",
  "sleepThreshold",
  "isSleeping",
]);

const SPRING_PATCH_KEYS = new Set([
  "stiffness",
  "damping",
  "length",
  "elasticConstantNnPerM",
  "visible",
  "locked",
  "displayName",
]);

const ROPE_PATCH_KEYS = new Set([
  "linkStiffness",
  "linkDamping",
  "segmentCount",
  "visible",
  "locked",
  "displayName",
]);

const MARKUP_PATCH_KEYS = new Set([
  "points",
  "text",
  "visible",
  "locked",
  "displayName",
  "measureUnit",
]);

/** Persisted markup document for `entity.add.markup`. */
export function sanitizeMarkupForCollab(markup: SceneMarkupSnapshot): SceneMarkupSnapshot {
  return {
    id: markup.id,
    displayName: markup.displayName,
    kind: markup.kind,
    points: markup.points.map((p) => ({ x: p.x, y: p.y })),
    visible: markup.visible,
    ...(markup.text != null ? { text: markup.text } : {}),
    ...(markup.measureUnit != null ? { measureUnit: markup.measureUnit } : {}),
    ...(markup.locked ? { locked: true } : {}),
  };
}

export function sanitizeMarkupPatchForCollab(
  patch: Partial<SceneMarkupSnapshot>,
): Partial<
  Pick<SceneMarkupSnapshot, "points" | "text" | "visible" | "locked" | "displayName" | "measureUnit">
> {
  const out: Partial<
    Pick<SceneMarkupSnapshot, "points" | "text" | "visible" | "locked" | "displayName" | "measureUnit">
  > = {};
  for (const k of MARKUP_PATCH_KEYS) {
    const key = k as keyof SceneMarkupSnapshot;
    if (key in patch && patch[key] !== undefined) {
      (out as Record<string, unknown>)[k] = patch[key];
    }
  }
  return out;
}

/** Drop engine/spring fields that must never be sent on `entity.patch.spring` (server asserts allowlist). */
export function sanitizeSpringPatchForCollab(
  patch: Partial<SpringSnapshot>,
): Partial<
  Pick<
    SpringSnapshot,
    "stiffness" | "damping" | "length" | "elasticConstantNnPerM" | "visible" | "locked" | "displayName"
  >
> {
  const out: Partial<
    Pick<
      SpringSnapshot,
      "stiffness" | "damping" | "length" | "elasticConstantNnPerM" | "visible" | "locked" | "displayName"
    >
  > = {};
  for (const k of SPRING_PATCH_KEYS) {
    const key = k as keyof SpringSnapshot;
    if (key in patch && patch[key] !== undefined) {
      (out as Record<string, unknown>)[k] = patch[key];
    }
  }
  if (
    typeof out.elasticConstantNnPerM === "number" &&
    Number.isFinite(out.elasticConstantNnPerM)
  ) {
    const k = out.elasticConstantNnPerM;
    out.stiffness = matterConstraintStiffnessFromElasticKn(k);
    out.damping = matterConstraintDampingFromElasticKn(k, out.stiffness);
  }
  return out;
}

/** Persisted rope document for `entity.add.rope` (no engine-only fields). */
export function sanitizeRopeForCollab(rope: RopeSnapshot): RopeSnapshot {
  return {
    id: rope.id,
    displayName: rope.displayName,
    bodyA: rope.bodyA,
    bodyB: rope.bodyB,
    anchorA: rope.anchorA,
    anchorB: rope.anchorB,
    segmentCount: rope.segmentCount,
    linkStiffness: rope.linkStiffness,
    linkDamping: rope.linkDamping,
    visible: rope.visible,
  };
}

export function sanitizeRopePatchForCollab(
  patch: Partial<RopeSnapshot>,
): Partial<
  Pick<RopeSnapshot, "linkStiffness" | "linkDamping" | "segmentCount" | "visible" | "locked" | "displayName">
> {
  const out: Partial<
    Pick<RopeSnapshot, "linkStiffness" | "linkDamping" | "segmentCount" | "visible" | "locked" | "displayName">
  > = {};
  for (const k of ROPE_PATCH_KEYS) {
    const key = k as keyof RopeSnapshot;
    if (key in patch && patch[key] !== undefined) {
      (out as Record<string, unknown>)[k] = patch[key];
    }
  }
  return out;
}

export function normalizeStoredScene(raw: unknown): StoredSceneSnapshot {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rawSprings = Array.isArray(o.springs) ? (o.springs as SpringSnapshot[]) : [];
  const springs: SpringSnapshot[] = rawSprings.map((s) => ({
    ...s,
    elasticConstantNnPerM:
      typeof (s as { elasticConstantNnPerM?: unknown }).elasticConstantNnPerM === "number" &&
      Number.isFinite((s as { elasticConstantNnPerM: number }).elasticConstantNnPerM)
        ? (s as { elasticConstantNnPerM: number }).elasticConstantNnPerM
        : inferElasticKnFromMatterConstraintStiffness(typeof s.stiffness === "number" ? s.stiffness : 0.022),
  }));
  const rawMarkups = Array.isArray(o.markups) ? (o.markups as SceneMarkupSnapshot[]) : [];
  const markups: SceneMarkupSnapshot[] = rawMarkups
    .filter((m) => m && typeof m.id === "string" && typeof m.kind === "string")
    .map((m) => ({
      id: m.id,
      displayName: typeof m.displayName === "string" ? m.displayName : m.id,
      kind: m.kind,
      points: Array.isArray(m.points)
        ? m.points
            .filter((p) => p && typeof p.x === "number" && typeof p.y === "number")
            .map((p) => ({ x: p.x, y: p.y }))
        : [],
      visible: m.visible !== false,
      locked: m.locked === true,
      ...(typeof m.text === "string" ? { text: m.text } : {}),
      ...(m.measureUnit === "cm" || m.measureUnit === "m" ? { measureUnit: m.measureUnit } : {}),
    }));

  return {
    schemaVersion: typeof o.schemaVersion === "number" ? o.schemaVersion : STORED_SCENE_SCHEMA_VERSION,
    bodies: Array.isArray(o.bodies) ? (o.bodies as SimBodySnapshot[]) : [],
    springs,
    ropes: Array.isArray(o.ropes) ? (o.ropes as RopeSnapshot[]) : [],
    markups,
    tick: typeof o.tick === "number" ? o.tick : 0,
    gravityEnabled: typeof o.gravityEnabled === "boolean" ? o.gravityEnabled : true,
  };
}

export function countSceneObjects(
  snap: Pick<StoredSceneSnapshot, "bodies" | "springs" | "ropes">,
): number {
  let n = 0;
  for (const b of snap.bodies) {
    if (
      b.entityKind !== "wall" &&
      b.entityKind !== "floor" &&
      b.entityKind !== "collisionBounds" &&
      b.entityKind !== "ropeSegment"
    ) {
      n += 1;
    }
  }
  return n + snap.springs.length + (snap.ropes?.length ?? 0);
}

/** Bodies that round-trip through the scene doc (excludes engine perimeter walls + default floor). */
function authoringBodiesOnly(snap: SimulationSnapshot): SimBodySnapshot[] {
  return snap.bodies.filter(
    (b) =>
      b.entityKind !== "wall" &&
      b.entityKind !== "floor" &&
      b.entityKind !== "ropeSegment",
  );
}

/** Hash of persisted authoring content — ignores Matter-only wall/floor/rope-segment bodies. */
export function authoringSceneSignature(
  snap: Pick<SimulationSnapshot, "bodies" | "springs" | "ropes" | "markups">,
): string {
  const bodyBits = authoringBodiesOnly(snap as SimulationSnapshot)
    .map((b) => `${b.id}:${Math.round(b.x)}:${Math.round(b.y)}`)
    .sort()
    .join("|");
  const springIds = snap.springs
    .map((s) => s.id)
    .sort()
    .join(",");
  const ropeIds = (snap.ropes ?? [])
    .map((r) => r.id)
    .sort()
    .join(",");
  const markupIds = (snap.markups ?? [])
    .map((m) => m.id)
    .sort()
    .join(",");
  return `${bodyBits}#${springIds}#${ropeIds}#${markupIds}`;
}

export function localEngineMatchesStoredAuthoring(
  simSnap: SimulationSnapshot,
  gravityEnabled: boolean,
  stored: StoredSceneSnapshot,
): boolean {
  const local = snapshotForServer(simSnap, gravityEnabled);
  const server = normalizeStoredScene(stored);
  return (
    authoringSceneSignature(toSimulationSnapshot(local)) ===
    authoringSceneSignature(toSimulationSnapshot(server))
  );
}

/**
 * True when collaborative snapshots match for setup-time authoring (bodies + springs + ropes).
 * Ignores outer wall layers and runtime rope segment beads present only in the local Matter snapshot.
 */
export function authoringPhysicsSnapshotsEqual(a: SimulationSnapshot, b: SimulationSnapshot): boolean {
  const EPS = 1e-3;
  const aa = authoringBodiesOnly(a);
  const bb = authoringBodiesOnly(b);
  if (aa.length !== bb.length) return false;
  const bMap = new Map(bb.map((x) => [x.id, x]));
  for (const body of aa) {
    const o = bMap.get(body.id);
    if (!o) return false;
    if (body.entityKind !== o.entityKind) return false;
    if (body.visible !== o.visible) return false;
    if (Math.abs(body.x - o.x) > EPS) return false;
    if (Math.abs(body.y - o.y) > EPS) return false;
    if (Math.abs(body.angle - o.angle) > EPS) return false;
    if (Math.abs(body.width - o.width) > EPS) return false;
    if (Math.abs(body.height - o.height) > EPS) return false;
    if (Math.abs(body.velocityX - o.velocityX) > EPS) return false;
    if (Math.abs(body.velocityY - o.velocityY) > EPS) return false;
  }
  if (a.springs.length !== b.springs.length) return false;
  const sMap = new Map(b.springs.map((x) => [x.id, x]));
  for (const s of a.springs) {
    const o = sMap.get(s.id);
    if (!o) return false;
    if (s.visible !== o.visible) return false;
    if (Math.abs(s.stiffness - o.stiffness) > EPS) return false;
    if (Math.abs(s.damping - o.damping) > EPS) return false;
    if (Math.abs(s.length - o.length) > EPS) return false;
    if (Math.abs(s.elasticConstantNnPerM - o.elasticConstantNnPerM) > EPS) return false;
  }
  const ar = a.ropes ?? [];
  const br = b.ropes ?? [];
  if (ar.length !== br.length) return false;
  const rMap = new Map(br.map((x) => [x.id, x]));
  for (const r of ar) {
    const o = rMap.get(r.id);
    if (!o) return false;
    if (r.visible !== o.visible) return false;
    if (r.bodyA !== o.bodyA || r.bodyB !== o.bodyB) return false;
    if (Math.abs(r.linkStiffness - o.linkStiffness) > EPS) return false;
    if (Math.abs(r.linkDamping - o.linkDamping) > EPS) return false;
    if (r.segmentCount !== o.segmentCount) return false;
  }
  return true;
}

/** Strip DB metadata for engine seeding — walls/floor are added by the engine. */
export function toSimulationSnapshot(stored: StoredSceneSnapshot): SimulationSnapshot {
  const n = normalizeStoredScene(stored);
  return {
    bodies: n.bodies,
    springs: n.springs,
    ropes: n.ropes,
    markups: n.markups ?? [],
    tick: n.tick,
  };
}

function assertKeys(allowed: Set<string>, patch: Record<string, unknown>): void {
  for (const k of Object.keys(patch)) {
    if (!allowed.has(k)) throw new Error(`invalid_patch_key:${k}`);
  }
}

/** Client-side mirror of server `flux_apply_scene_op_inner` — keep in sync with migration. */
export function applySceneOpToStoredSnapshot(
  snap: StoredSceneSnapshot,
  op: SceneOp,
): StoredSceneSnapshot {
  const base = normalizeStoredScene(snap);

  switch (op.type) {
    case "entity.add.body":
      if (!op.body?.id) throw new Error("invalid_op");
      return normalizeStoredScene({
        ...base,
        bodies: [...base.bodies, op.body],
      });
    case "entity.add.spring":
      if (!op.spring?.id) throw new Error("invalid_op");
      return normalizeStoredScene({
        ...base,
        springs: [...base.springs, op.spring],
      });
    case "entity.add.rope":
      if (!op.rope?.id) throw new Error("invalid_op");
      return normalizeStoredScene({
        ...base,
        ropes: [...base.ropes, op.rope],
      });
    case "entity.add.markup":
      if (!op.markup?.id) throw new Error("invalid_op");
      return normalizeStoredScene({
        ...base,
        markups: [...(base.markups ?? []), op.markup],
      });
    case "entity.remove": {
      if (!op.id) throw new Error("invalid_op");
      const ropesAfterBody = base.ropes.filter(
        (r) => r.bodyA !== op.id && r.bodyB !== op.id && r.id !== op.id,
      );
      return normalizeStoredScene({
        ...base,
        bodies: base.bodies.filter((b) => b.id !== op.id),
        springs: base.springs.filter((s) => s.id !== op.id),
        ropes: ropesAfterBody,
        markups: (base.markups ?? []).filter((m) => m.id !== op.id),
      });
    }
    case "entity.patch.body": {
      const patch = op.patch as Record<string, unknown>;
      assertKeys(BODY_PATCH_KEYS, patch);
      const idx = base.bodies.findIndex((b) => b.id === op.id);
      if (idx < 0) throw new Error("entity_not_found");
      const next = [...base.bodies];
      next[idx] = { ...next[idx]!, ...op.patch };
      return normalizeStoredScene({ ...base, bodies: next });
    }
    case "entity.patch.spring": {
      const patch = op.patch as Record<string, unknown>;
      assertKeys(SPRING_PATCH_KEYS, patch);
      const idx = base.springs.findIndex((s) => s.id === op.id);
      if (idx < 0) throw new Error("entity_not_found");
      const next = [...base.springs];
      next[idx] = { ...next[idx]!, ...op.patch };
      return normalizeStoredScene({ ...base, springs: next });
    }
    case "entity.patch.rope": {
      const patch = op.patch as Record<string, unknown>;
      assertKeys(ROPE_PATCH_KEYS, patch);
      const idx = base.ropes.findIndex((r) => r.id === op.id);
      if (idx < 0) throw new Error("entity_not_found");
      const next = [...base.ropes];
      next[idx] = { ...next[idx]!, ...op.patch };
      return normalizeStoredScene({ ...base, ropes: next });
    }
    case "entity.patch.markup": {
      const patch = op.patch as Record<string, unknown>;
      assertKeys(MARKUP_PATCH_KEYS, patch);
      const markups = base.markups ?? [];
      const idx = markups.findIndex((m) => m.id === op.id);
      if (idx < 0) throw new Error("entity_not_found");
      const next = [...markups];
      next[idx] = { ...next[idx]!, ...op.patch };
      return normalizeStoredScene({ ...base, markups: next });
    }
    case "scene.gravity":
      return normalizeStoredScene({ ...base, gravityEnabled: op.gravityEnabled });
    case "scene.replace":
      return normalizeStoredScene(op.snapshot);
    case "batch": {
      let acc = base;
      for (const child of op.ops) {
        acc = applySceneOpToStoredSnapshot(acc, child);
      }
      return acc;
    }
    default:
      throw new Error("unknown_op_type");
  }
}

export function opIsStructural(op: SceneOp): boolean {
  switch (op.type) {
    case "entity.add.body":
    case "entity.add.spring":
    case "entity.add.rope":
    case "entity.add.markup":
    case "entity.remove":
    case "scene.replace":
      return true;
    case "batch":
      return op.ops.some(opIsStructural);
    default:
      return false;
  }
}

/** Strip engine-only entities for persistence (walls / floor / rope segments recreated on load). */
export function snapshotForServer(
  snap: SimulationSnapshot,
  gravityEnabled: boolean,
): StoredSceneSnapshot {
  return normalizeStoredScene({
    schemaVersion: STORED_SCENE_SCHEMA_VERSION,
    bodies: snap.bodies.filter(
      (b) =>
        b.entityKind !== "wall" &&
        b.entityKind !== "floor" &&
        b.entityKind !== "ropeSegment",
    ),
    springs: snap.springs.map((s) => ({ ...s })),
    ropes: (snap.ropes ?? []).map((r) => ({ ...r })),
    markups: (snap.markups ?? []).map((m) => sanitizeMarkupForCollab(m)),
    tick: 0,
    gravityEnabled,
  });
}
