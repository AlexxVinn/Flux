import type { ClientAction, ComponentData } from "@flux/shared";
import {
  ComponentKind,
  type RigidBodyComponent,
  type ColliderComponent,
  type ThermalComponent,
} from "@flux/shared";
import type { WorldState } from "./worldState.js";

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

const MAX_MASS = 1e6;
const MIN_MASS = 0.001;
const MAX_DIM = 5000;
const MIN_DIM = 0.01;
const MAX_TEMP = 5000;
const MIN_TEMP = 0;
const MAX_FORCE = 1e7;

export function validateClientAction(
  state: WorldState,
  action: ClientAction,
  ownerEntityIds?: ReadonlySet<string>,
): ValidationResult {
  if (ownerEntityIds && "entityId" in action) {
    const id = action.entityId as string;
    if (
      action.type !== "createEntity" &&
      ownerEntityIds.size > 0 &&
      !ownerEntityIds.has(id)
    ) {
      return { valid: false, reason: "entity not owned by client" };
    }
  }

  switch (action.type) {
    case "createEntity":
      return validateComponents(action.components);
    case "deleteEntity":
      return state.entities.has(action.entityId)
        ? { valid: true }
        : { valid: false, reason: "entity not found" };
    case "setComponent":
      return validateSingleComponent(action.component);
    case "applyForce": {
      const mag = Math.hypot(action.force.x, action.force.y);
      if (mag > MAX_FORCE) return { valid: false, reason: "force too large" };
      return { valid: true };
    }
    case "setTransform":
      return state.entities.has(action.entityId)
        ? { valid: true }
        : { valid: false, reason: "entity not found" };
    case "createSpring":
      return { valid: true };
    default:
      return { valid: false, reason: "unknown action" };
  }
}

function validateComponents(
  components: Partial<Record<ComponentKind, ComponentData>>,
): ValidationResult {
  for (const c of Object.values(components)) {
    if (!c) continue;
    const r = validateSingleComponent(c);
    if (!r.valid) return r;
  }
  return { valid: true };
}

function validateSingleComponent(component: ComponentData): ValidationResult {
  switch (component.kind) {
    case ComponentKind.RigidBody: {
      const b = component as RigidBodyComponent;
      if (b.mass < MIN_MASS && !b.isStatic) {
        return { valid: false, reason: "mass too small" };
      }
      if (b.mass > MAX_MASS) return { valid: false, reason: "mass too large" };
      return { valid: true };
    }
    case ComponentKind.Collider: {
      const c = component as ColliderComponent;
      if (c.width < MIN_DIM || c.height < MIN_DIM) {
        return { valid: false, reason: "collider too small" };
      }
      if (c.width > MAX_DIM || c.height > MAX_DIM) {
        return { valid: false, reason: "collider too large" };
      }
      if (c.friction < 0 || c.friction > 2) {
        return { valid: false, reason: "friction out of range" };
      }
      if (c.restitution < 0 || c.restitution > 1) {
        return { valid: false, reason: "restitution out of range" };
      }
      return { valid: true };
    }
    case ComponentKind.Thermal: {
      const t = component as ThermalComponent;
      if (t.temperature < MIN_TEMP || t.temperature > MAX_TEMP) {
        return { valid: false, reason: "temperature out of range" };
      }
      return { valid: true };
    }
    default:
      return { valid: true };
  }
}
