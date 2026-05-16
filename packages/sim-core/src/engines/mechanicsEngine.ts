import type { EntityId } from "@flux/shared";
import {
  ComponentKind,
  type TransformComponent,
  type RigidBodyComponent,
  type SpringConstraintComponent,
} from "@flux/shared";
import { add, sub, scale, dot } from "@flux/shared";
import type { SimulationEngine, EngineContext } from "./types.js";
import { entityIdsSorted, hasComponents, getComponent } from "../world/worldState.js";
import { solveContacts } from "../physics/contactSolver.js";

const REQUIRED_DYNAMIC = [
  ComponentKind.Transform,
  ComponentKind.RigidBody,
] as const;

/**
 * 2D mechanics: semi-implicit Euler, springs, sequential impulse contacts, sleep.
 */
export class MechanicsEngine implements SimulationEngine {
  readonly id = "mechanics";
  readonly reads = [
    ComponentKind.Transform,
    ComponentKind.RigidBody,
    ComponentKind.Collider,
    ComponentKind.SpringConstraint,
  ] as const;
  readonly writes = [ComponentKind.Transform, ComponentKind.RigidBody] as const;

  step(ctx: EngineContext): void {
    const { world, dt, ports, kinematicIds, debug } = ctx;
    const g = world.metadata.gravity;
    const kinematic = kinematicIds ?? new Set<EntityId>();

    this.applyKinematicOverrides(world, kinematic);
    this.accumulateSpringForces(world, dt);

    for (const entityId of entityIdsSorted(world)) {
      const bag = world.entities.get(entityId);
      if (!bag || !hasComponents(bag, REQUIRED_DYNAMIC)) continue;

      const transform = bag[ComponentKind.Transform] as TransformComponent;
      const body = bag[ComponentKind.RigidBody] as RigidBodyComponent;

      if (body.isStatic || body.isKinematic || kinematic.has(entityId)) continue;
      if (body.isSleeping) continue;

      const ax = (body.force.x + body.mass * g.x) / body.mass;
      const ay = (body.force.y + body.mass * g.y) / body.mass;

      const velocity = {
        x: body.velocity.x + ax * dt,
        y: body.velocity.y + ay * dt,
      };
      const position = {
        x: transform.position.x + velocity.x * dt,
        y: transform.position.y + velocity.y * dt,
      };

      world.entities.set(entityId, {
        ...bag,
        [ComponentKind.Transform]: { ...transform, position },
        [ComponentKind.RigidBody]: {
          ...body,
          velocity,
          force: { x: 0, y: 0 },
        },
      });
    }

    const result = solveContacts(world, dt, ports, kinematic);
    if (debug) {
      debug.contacts = result.contacts;
    }
  }

  private applyKinematicOverrides(
    world: EngineContext["world"],
    kinematic: ReadonlySet<EntityId>,
  ): void {
    for (const entityId of kinematic) {
      const bag = world.entities.get(entityId);
      if (!bag) continue;
      const transform = bag[ComponentKind.Transform] as TransformComponent | undefined;
      const body = bag[ComponentKind.RigidBody] as RigidBodyComponent | undefined;
      if (!transform || !body) continue;
      world.entities.set(entityId, {
        ...bag,
        [ComponentKind.RigidBody]: {
          ...body,
          velocity: { x: 0, y: 0 },
          isSleeping: false,
          sleepTimer: 0,
        },
      });
    }
  }

  private accumulateSpringForces(world: EngineContext["world"], dt: number): void {
    for (const entityId of entityIdsSorted(world)) {
      const spring = getComponent(
        world,
        entityId,
        ComponentKind.SpringConstraint,
      ) as SpringConstraintComponent | undefined;
      if (!spring) continue;

      const bagA = world.entities.get(spring.entityA);
      const bagB = world.entities.get(spring.entityB);
      if (!bagA || !bagB) continue;

      const tA = bagA[ComponentKind.Transform] as TransformComponent | undefined;
      const tB = bagB[ComponentKind.Transform] as TransformComponent | undefined;
      const bA = bagA[ComponentKind.RigidBody] as RigidBodyComponent | undefined;
      const bB = bagB[ComponentKind.RigidBody] as RigidBodyComponent | undefined;
      if (!tA || !tB || !bA || !bB) continue;

      const worldAnchorA = add(tA.position, spring.anchorA);
      const worldAnchorB = add(tB.position, spring.anchorB);
      const delta = sub(worldAnchorB, worldAnchorA);
      const dist = Math.hypot(delta.x, delta.y) || 1e-6;
      const stretch = dist - spring.restLength;
      const dir = scale(delta, 1 / dist);

      const relVel = sub(bB.velocity, bA.velocity);
      const velAlong = dot(relVel, dir);
      const forceMag = -spring.stiffness * stretch - spring.damping * velAlong;

      if (!bA.isStatic && !bA.isSleeping) {
        bA.force = add(bA.force, scale(dir, -forceMag));
        world.entities.set(spring.entityA, { ...bagA, [ComponentKind.RigidBody]: bA });
      }
      if (!bB.isStatic && !bB.isSleeping) {
        bB.force = add(bB.force, scale(dir, forceMag));
        world.entities.set(spring.entityB, { ...bagB, [ComponentKind.RigidBody]: bB });
      }

      void dt;
    }
  }
}
