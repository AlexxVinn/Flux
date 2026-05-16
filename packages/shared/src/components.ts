import type { Vec2 } from "./math.js";
import type { EntityId, ConstraintId } from "./ids.js";

/**
 * Component kinds — engines subscribe to these, not to entity classes.
 */
export const ComponentKind = {
  Transform: "transform",
  RigidBody: "rigidBody",
  Collider: "collider",
  Material: "material",
  Thermal: "thermal",
  SpringConstraint: "springConstraint",
} as const;

export type ComponentKind = (typeof ComponentKind)[keyof typeof ComponentKind];

export interface TransformComponent {
  kind: typeof ComponentKind.Transform;
  position: Vec2;
  rotation: number;
}

export interface RigidBodyComponent {
  kind: typeof ComponentKind.RigidBody;
  velocity: Vec2;
  mass: number;
  /** Accumulated forces for this tick (cleared after integration). */
  force: Vec2;
  isStatic: boolean;
  /** Tool-driven; skips integration, position set externally. */
  isKinematic: boolean;
  /** At rest; skipped until disturbed. */
  isSleeping: boolean;
  /** Seconds below sleep velocity threshold (deterministic). */
  sleepTimer: number;
}

export type ColliderShape = "aabb";

export interface ColliderComponent {
  kind: typeof ComponentKind.Collider;
  shape: ColliderShape;
  width: number;
  height: number;
  restitution: number;
  friction: number;
}

export interface MaterialComponent {
  kind: typeof ComponentKind.Material;
  density: number;
  /** Specific heat capacity J/(kg·K) */
  specificHeat: number;
}

export interface ThermalComponent {
  kind: typeof ComponentKind.Thermal;
  temperature: number;
  /** Thermal mass = mass * specificHeat (cached for performance). */
  thermalMass: number;
}

export interface SpringConstraintComponent {
  kind: typeof ComponentKind.SpringConstraint;
  id: ConstraintId;
  entityA: EntityId;
  entityB: EntityId;
  anchorA: Vec2;
  anchorB: Vec2;
  restLength: number;
  stiffness: number;
  damping: number;
}

export type ComponentData =
  | TransformComponent
  | RigidBodyComponent
  | ColliderComponent
  | MaterialComponent
  | ThermalComponent
  | SpringConstraintComponent;

export type ComponentBag = Partial<Record<ComponentKind, ComponentData>>;
