/**
 * Bridge between Matter.js sandbox snapshots and @flux/sim-core ECS world state.
 *
 * Authoritative multiplayer should run sim-core on the server; clients may use
 * Matter.js for local preview and reconcile from keyframes/deltas. This module
 * keeps the two representations aligned.
 */
import {
  ComponentKind,
  type EntityId,
  type TransformComponent,
  type RigidBodyComponent,
  type ColliderComponent,
  type SpringConstraintComponent,
} from "@flux/shared";
import type { WorldState } from "../world/worldState.js";
import { setComponent } from "../world/worldState.js";

/** Minimal Matter-like body for import (matches web SimBodySnapshot). */
export interface MatterBodyLike {
  id: string;
  displayName: string;
  shape: "circle" | "rectangle";
  x: number;
  y: number;
  angle: number;
  velocityX: number;
  velocityY: number;
  mass: number;
  restitution: number;
  friction: number;
  isStatic: boolean;
  width: number;
  height: number;
}

export interface MatterSpringLike {
  id: string;
  bodyA: string;
  bodyB: string;
  stiffness: number;
  damping: number;
}

export interface MatterSnapshotLike {
  bodies: MatterBodyLike[];
  springs: MatterSpringLike[];
  tick: number;
}

/** Push Matter snapshot bodies into an ECS world (non-destructive add/update). */
export function importMatterSnapshot(
  world: WorldState,
  snap: MatterSnapshotLike,
): void {
  for (const b of snap.bodies) {
    const id = b.id as EntityId;
    const transform: TransformComponent = {
      kind: ComponentKind.Transform,
      position: { x: b.x, y: b.y },
      rotation: b.angle,
    };
    const rigidBody: RigidBodyComponent = {
      kind: ComponentKind.RigidBody,
      velocity: { x: b.velocityX, y: b.velocityY },
      mass: b.mass,
      force: { x: 0, y: 0 },
      isStatic: b.isStatic,
      isKinematic: false,
      isSleeping: false,
      sleepTimer: 0,
    };
    const collider: ColliderComponent = {
      kind: ComponentKind.Collider,
      shape: "aabb",
      width: b.width,
      height: b.height,
      restitution: b.restitution,
      friction: b.friction,
    };
    setComponent(world, id, transform);
    setComponent(world, id, rigidBody);
    setComponent(world, id, collider);
  }

  for (const s of snap.springs) {
    const spring: SpringConstraintComponent = {
      kind: ComponentKind.SpringConstraint,
      id: s.id as SpringConstraintComponent["id"],
      entityA: s.bodyA as EntityId,
      entityB: s.bodyB as EntityId,
      anchorA: { x: 0, y: 0 },
      anchorB: { x: 0, y: 0 },
      restLength: 80,
      stiffness: s.stiffness,
      damping: s.damping,
    };
    setComponent(world, s.id as EntityId, spring);
  }

  world.tick = snap.tick;
}

/** Export ECS dynamic bodies to a Matter-friendly snapshot (for render preview). */
export function exportToMatterSnapshot(world: WorldState): MatterSnapshotLike {
  const bodies: MatterBodyLike[] = [];
  const springs: MatterSpringLike[] = [];

  for (const [entityId, bag] of world.entities) {
    const t = bag[ComponentKind.Transform] as TransformComponent | undefined;
    const rb = bag[ComponentKind.RigidBody] as RigidBodyComponent | undefined;
    const col = bag[ComponentKind.Collider] as ColliderComponent | undefined;
    const spring = bag[ComponentKind.SpringConstraint] as
      | SpringConstraintComponent
      | undefined;

    if (spring) {
      springs.push({
        id: spring.id,
        bodyA: spring.entityA,
        bodyB: spring.entityB,
        stiffness: spring.stiffness,
        damping: spring.damping,
      });
      continue;
    }

    if (!t || !rb || !col) continue;

    bodies.push({
      id: entityId,
      displayName: entityId,
      shape: col.width === col.height ? "circle" : "rectangle",
      x: t.position.x,
      y: t.position.y,
      angle: t.rotation,
      velocityX: rb.velocity.x,
      velocityY: rb.velocity.y,
      mass: rb.mass,
      restitution: col.restitution,
      friction: col.friction,
      isStatic: rb.isStatic,
      width: col.width,
      height: col.height,
    });
  }

  return { bodies, springs, tick: world.tick };
}
