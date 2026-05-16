import type { EntityId, ActionId, ConstraintId } from "./ids.js";
import type { ComponentKind, ComponentData } from "./components.js";
import type { Vec2 } from "./math.js";

/** Client-originated intent; server validates and applies. */
export type ClientAction =
  | {
      type: "createEntity";
      actionId: ActionId;
      entityId: EntityId;
      components: Partial<Record<ComponentKind, ComponentData>>;
    }
  | {
      type: "deleteEntity";
      actionId: ActionId;
      entityId: EntityId;
    }
  | {
      type: "setComponent";
      actionId: ActionId;
      entityId: EntityId;
      component: ComponentData;
    }
  | {
      type: "applyForce";
      actionId: ActionId;
      entityId: EntityId;
      force: Vec2;
    }
  | {
      type: "setTransform";
      actionId: ActionId;
      entityId: EntityId;
      position: Vec2;
      rotation?: number;
    }
  | {
      type: "createSpring";
      actionId: ActionId;
      constraintId: ConstraintId;
      entityA: EntityId;
      entityB: EntityId;
      restLength: number;
      stiffness: number;
      damping: number;
    };

export interface ActionAck {
  actionId: ActionId;
  accepted: boolean;
  tick?: number;
  reason?: string;
}
