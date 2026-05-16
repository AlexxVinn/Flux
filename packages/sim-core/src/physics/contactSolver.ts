import type { EntityId } from "@flux/shared";
import {
  ComponentKind,
  type TransformComponent,
  type RigidBodyComponent,
  type ColliderComponent,
} from "@flux/shared";
import { add, sub, scale, dot } from "@flux/shared";
import type { WorldState } from "../world/worldState.js";
import { entityIdsSorted } from "../world/worldState.js";
import type { PortBus } from "../ports/portBus.js";
import { PortKind } from "../ports/portBus.js";

export interface ContactManifold {
  entityA: EntityId;
  entityB: EntityId;
  normalX: number;
  normalY: number;
  depth: number;
  contactX: number;
  contactY: number;
}

export interface DebugContactInfo extends ContactManifold {
  normalImpulse: number;
  tangentImpulse: number;
  frictionWorkJ: number;
}

const POSITION_ITERATIONS = 8;
const VELOCITY_ITERATIONS = 6;
const POSITION_SLOP = 0.005;
const POSITION_PERCENT = 0.6;
const SLEEP_LINEAR_THRESHOLD = 0.08;
const SLEEP_ANGULAR_THRESHOLD = 0.08;
const SLEEP_TIME_REQUIRED = 0.5;

export interface ContactSolverResult {
  contacts: DebugContactInfo[];
}

interface BodyRef {
  id: EntityId;
  transform: TransformComponent;
  body: RigidBodyComponent;
  collider: ColliderComponent;
  invMass: number;
}

/**
 * Sequential impulse AABB contact solver with friction heat port emission.
 */
export function solveContacts(
  world: WorldState,
  dt: number,
  ports: PortBus,
  kinematicIds: ReadonlySet<EntityId>,
): ContactSolverResult {
  const debugContacts: DebugContactInfo[] = [];
  const manifolds: ContactManifold[] = [];

  const ids = entityIdsSorted(world);
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const m = detectAabbContact(world, ids[i]!, ids[j]!);
      if (m) manifolds.push(m);
    }
  }

  for (let iter = 0; iter < POSITION_ITERATIONS; iter++) {
    for (const m of manifolds) {
      resolvePosition(world, m, kinematicIds);
    }
  }

  for (let iter = 0; iter < VELOCITY_ITERATIONS; iter++) {
    for (const m of manifolds) {
      const info = resolveVelocity(world, m, dt, ports, kinematicIds);
      if (info && iter === VELOCITY_ITERATIONS - 1) {
        debugContacts.push(info);
      }
    }
  }

  updateSleeping(world, dt, kinematicIds);

  return { contacts: debugContacts };
}

function detectAabbContact(
  world: WorldState,
  idA: EntityId,
  idB: EntityId,
): ContactManifold | null {
  const refA = getBodyRef(world, idA);
  const refB = getBodyRef(world, idB);
  if (!refA || !refB) return null;

  const dx = refB.transform.position.x - refA.transform.position.x;
  const dy = refB.transform.position.y - refA.transform.position.y;
  const overlapX = refA.collider.width / 2 + refB.collider.width / 2 - Math.abs(dx);
  const overlapY = refA.collider.height / 2 + refB.collider.height / 2 - Math.abs(dy);
  if (overlapX <= 0 || overlapY <= 0) return null;

  let normalX = 0;
  let normalY = 0;
  let depth: number;

  if (overlapX < overlapY) {
    depth = overlapX;
    normalX = dx >= 0 ? 1 : -1;
  } else {
    depth = overlapY;
    normalY = dy >= 0 ? 1 : -1;
  }

  const contactX = (refA.transform.position.x + refB.transform.position.x) / 2;
  const contactY = (refA.transform.position.y + refB.transform.position.y) / 2;

  return {
    entityA: idA,
    entityB: idB,
    normalX,
    normalY,
    depth,
    contactX,
    contactY,
  };
}

function resolvePosition(
  world: WorldState,
  m: ContactManifold,
  kinematicIds: ReadonlySet<EntityId>,
): void {
  const refA = getBodyRef(world, m.entityA);
  const refB = getBodyRef(world, m.entityB);
  if (!refA || !refB) return;

  const invMassSum = refA.invMass + refB.invMass;
  if (invMassSum <= 0) return;

  const correction = Math.max(m.depth - POSITION_SLOP, 0) * POSITION_PERCENT;
  const cx = (m.normalX * correction) / invMassSum;
  const cy = (m.normalY * correction) / invMassSum;

  if (refA.invMass > 0 && !kinematicIds.has(m.entityA)) {
    refA.transform.position.x -= m.normalX * cx * refA.invMass;
    refA.transform.position.y -= m.normalY * cy * refA.invMass;
    writeBodyRef(world, refA);
  }
  if (refB.invMass > 0 && !kinematicIds.has(m.entityB)) {
    refB.transform.position.x += m.normalX * cx * refB.invMass;
    refB.transform.position.y += m.normalY * cy * refB.invMass;
    writeBodyRef(world, refB);
  }
}

function resolveVelocity(
  world: WorldState,
  m: ContactManifold,
  dt: number,
  ports: PortBus,
  kinematicIds: ReadonlySet<EntityId>,
): DebugContactInfo | null {
  const refA = getBodyRef(world, m.entityA);
  const refB = getBodyRef(world, m.entityB);
  if (!refA || !refB) return null;

  const nx = m.normalX;
  const ny = m.normalY;

  const relVx = refB.body.velocity.x - refA.body.velocity.x;
  const relVy = refB.body.velocity.y - refA.body.velocity.y;
  const velAlongNormal = relVx * nx + relVy * ny;

  if (velAlongNormal > 0) return null;

  const e = Math.min(refA.collider.restitution, refB.collider.restitution);
  const invMassSum = refA.invMass + refB.invMass;
  if (invMassSum <= 0) return null;

  let jNormal = (-(1 + e) * velAlongNormal) / invMassSum;
  jNormal = Math.max(jNormal, 0);

  applyImpulse(refA, refB, nx, ny, -jNormal, kinematicIds, world);

  const relVx2 = refB.body.velocity.x - refA.body.velocity.x;
  const relVy2 = refB.body.velocity.y - refA.body.velocity.y;
  const tx = -ny;
  const ty = nx;
  const velTangent = relVx2 * tx + relVy2 * ty;

  const mu = Math.sqrt(refA.collider.friction * refB.collider.friction);
  let jTangent = (-velTangent) / invMassSum;
  const maxFriction = mu * jNormal;
  jTangent = Math.max(-maxFriction, Math.min(maxFriction, jTangent));

  applyImpulse(refA, refB, tx, ty, -jTangent, kinematicIds, world);

  const frictionWorkJ = Math.abs(jTangent * velTangent) * dt;
  if (frictionWorkJ > 1e-9) {
    publishFrictionHeat(ports, m.entityA, m.entityB, refA, refB, frictionWorkJ);
  }

  writeBodyRef(world, refA);
  writeBodyRef(world, refB);

  return {
    ...m,
    normalImpulse: jNormal,
    tangentImpulse: jTangent,
    frictionWorkJ,
  };
}

function applyImpulse(
  refA: BodyRef,
  refB: BodyRef,
  ix: number,
  iy: number,
  impulse: number,
  kinematicIds: ReadonlySet<EntityId>,
  world: WorldState,
): void {
  if (refA.invMass > 0 && !kinematicIds.has(refA.id) && !refA.body.isSleeping) {
    refA.body.velocity.x -= ix * impulse * refA.invMass;
    refA.body.velocity.y -= iy * impulse * refA.invMass;
    refA.body.isSleeping = false;
  }
  if (refB.invMass > 0 && !kinematicIds.has(refB.id) && !refB.body.isSleeping) {
    refB.body.velocity.x += ix * impulse * refB.invMass;
    refB.body.velocity.y += iy * impulse * refB.invMass;
    refB.body.isSleeping = false;
  }
  writeBodyRef(world, refA);
  writeBodyRef(world, refB);
}

function publishFrictionHeat(
  ports: PortBus,
  idA: EntityId,
  idB: EntityId,
  refA: BodyRef,
  refB: BodyRef,
  workJ: number,
): void {
  const invSum = refA.invMass + refB.invMass;
  if (invSum <= 0) return;
  if (refA.invMass > 0) {
    ports.publish({
      kind: PortKind.FrictionHeat,
      entityId: idA,
      partnerEntityId: idB,
      energyJoules: workJ * (refA.invMass / invSum),
    });
  }
  if (refB.invMass > 0) {
    ports.publish({
      kind: PortKind.FrictionHeat,
      entityId: idB,
      partnerEntityId: idA,
      energyJoules: workJ * (refB.invMass / invSum),
    });
  }
}

function updateSleeping(
  world: WorldState,
  dt: number,
  kinematicIds: ReadonlySet<EntityId>,
): void {
  for (const [entityId, bag] of world.entities) {
    const body = bag[ComponentKind.RigidBody] as RigidBodyComponent | undefined;
    if (!body || body.isStatic || body.isKinematic || kinematicIds.has(entityId)) continue;

    const speed = Math.hypot(body.velocity.x, body.velocity.y);
    if (speed < SLEEP_LINEAR_THRESHOLD) {
      const accumulated = body.sleepTimer + dt;
      if (accumulated >= SLEEP_TIME_REQUIRED) {
        setComponentBody(world, entityId, {
          ...body,
          velocity: { x: 0, y: 0 },
          isSleeping: true,
          sleepTimer: accumulated,
        });
      } else {
        setComponentBody(world, entityId, { ...body, sleepTimer: accumulated });
      }
    } else if (body.isSleeping || body.sleepTimer > 0) {
      setComponentBody(world, entityId, {
        ...body,
        isSleeping: false,
        sleepTimer: 0,
      });
    }
    void SLEEP_ANGULAR_THRESHOLD;
  }
}

function getBodyRef(world: WorldState, id: EntityId): BodyRef | null {
  const bag = world.entities.get(id);
  if (!bag) return null;
  const transform = bag[ComponentKind.Transform] as TransformComponent | undefined;
  const body = bag[ComponentKind.RigidBody] as RigidBodyComponent | undefined;
  const collider = bag[ComponentKind.Collider] as ColliderComponent | undefined;
  if (!transform || !body || !collider || collider.shape !== "aabb") return null;
  if (body.isStatic) {
    return {
      id,
      transform,
      body,
      collider,
      invMass: 0,
    };
  }
  return {
    id,
    transform,
    body,
    collider,
    invMass: body.mass > 0 ? 1 / body.mass : 0,
  };
}

function writeBodyRef(world: WorldState, ref: BodyRef): void {
  const bag = world.entities.get(ref.id);
  if (!bag) return;
  world.entities.set(ref.id, {
    ...bag,
    [ComponentKind.Transform]: ref.transform,
    [ComponentKind.RigidBody]: ref.body,
  });
}

function setComponentBody(world: WorldState, id: EntityId, body: RigidBodyComponent): void {
  const bag = world.entities.get(id);
  if (!bag) return;
  world.entities.set(id, { ...bag, [ComponentKind.RigidBody]: body });
}
