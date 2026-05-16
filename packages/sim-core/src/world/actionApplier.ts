import type { ClientAction } from "@flux/shared";
import {
  ComponentKind,
  type TransformComponent,
  type RigidBodyComponent,
  type SpringConstraintComponent,
} from "@flux/shared";
import type { WorldState } from "./worldState.js";
import { setComponent, removeEntity, getComponent } from "./worldState.js";

export interface ApplyResult {
  accepted: boolean;
  reason?: string;
}

export function applyClientAction(state: WorldState, action: ClientAction): ApplyResult {
  switch (action.type) {
    case "createEntity": {
      if (state.entities.has(action.entityId)) {
        return { accepted: false, reason: "entity already exists" };
      }
      const bag: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(action.components)) {
        if (v) bag[k] = v;
      }
      state.entities.set(action.entityId, bag as import("@flux/shared").ComponentBag);
      return { accepted: true };
    }
    case "deleteEntity": {
      if (!state.entities.has(action.entityId)) {
        return { accepted: false, reason: "entity not found" };
      }
      removeEntity(state, action.entityId);
      return { accepted: true };
    }
    case "setComponent": {
      if (!state.entities.has(action.entityId)) {
        return { accepted: false, reason: "entity not found" };
      }
      setComponent(state, action.entityId, action.component);
      return { accepted: true };
    }
    case "applyForce": {
      const body = getComponent(state, action.entityId, ComponentKind.RigidBody) as
        | RigidBodyComponent
        | undefined;
      if (!body || body.isStatic) {
        return { accepted: false, reason: "no dynamic rigid body" };
      }
      setComponent(state, action.entityId, {
        ...body,
        force: {
          x: body.force.x + action.force.x,
          y: body.force.y + action.force.y,
        },
      });
      return { accepted: true };
    }
    case "setTransform": {
      const transform = getComponent(state, action.entityId, ComponentKind.Transform) as
        | TransformComponent
        | undefined;
      if (!transform) {
        return { accepted: false, reason: "no transform" };
      }
      const next: TransformComponent = {
        ...transform,
        position: action.position,
      };
      if (action.rotation !== undefined) {
        next.rotation = action.rotation;
      }
      setComponent(state, action.entityId, next);
      const body = getComponent(state, action.entityId, ComponentKind.RigidBody) as
        | RigidBodyComponent
        | undefined;
      if (body && !body.isStatic) {
        setComponent(state, action.entityId, {
          ...body,
          velocity: { x: 0, y: 0 },
          isSleeping: false,
          sleepTimer: 0,
        });
      }
      return { accepted: true };
    }
    case "createSpring": {
      const spring: SpringConstraintComponent = {
        kind: ComponentKind.SpringConstraint,
        id: action.constraintId,
        entityA: action.entityA,
        entityB: action.entityB,
        anchorA: { x: 0, y: 0 },
        anchorB: { x: 0, y: 0 },
        restLength: action.restLength,
        stiffness: action.stiffness,
        damping: action.damping,
      };
      setComponent(state, action.entityA, spring);
      return { accepted: true };
    }
    default:
      return { accepted: false, reason: "unknown action" };
  }
}
