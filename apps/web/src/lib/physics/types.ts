export type BodyShape = "circle" | "rectangle";

export type SpawnTool = "select" | "circle" | "rectangle" | "spring" | "rope" | "collisionBox";

export type EntityKind =
  | "circle"
  | "rectangle"
  | "spring"
  /** One bead in a rope chain — hidden from layers; parent rope owns UX. */
  | "ropeSegment"
  | "floor"
  | "wall"
  | "body"
  /** Static hollow frame; replaces outer world walls while present. */
  | "collisionBounds";

export interface SimBodySnapshot {
  id: string;
  /** User-facing name (Box-1, Circle-2, …) */
  displayName: string;
  label: string;
  shape: BodyShape;
  entityKind: EntityKind;
  x: number;
  y: number;
  angle: number;
  velocityX: number;
  velocityY: number;
  angularVelocity: number;
  mass: number;
  density: number;
  restitution: number;
  friction: number;
  frictionStatic: number;
  frictionAir: number;
  sleepThreshold: number;
  isStatic: boolean;
  visible: boolean;
  gravityScale: number;
  isSleeping: boolean;
  width: number;
  height: number;
  /** Set on `ropeSegment` bodies — parent {@link RopeSnapshot.id}. */
  ropeId?: string;
}

export interface SpringSnapshot {
  id: string;
  displayName: string;
  bodyA: string;
  bodyB: string;
  stiffness: number;
  damping: number;
  /** Rest length in px (Matter constraint length). */
  length: number;
  visible: boolean;
}

/** Logical rope: chain of dynamic links between two bodies (segments are engine-only beads). */
export interface RopeSnapshot {
  id: string;
  displayName: string;
  bodyA: string;
  bodyB: string;
  segmentCount: number;
  linkStiffness: number;
  linkDamping: number;
  visible: boolean;
}

export interface SimulationSnapshot {
  bodies: SimBodySnapshot[];
  springs: SpringSnapshot[];
  ropes: RopeSnapshot[];
  tick: number;
}

export type LayerEntity =
  | { type: "body"; data: SimBodySnapshot }
  | { type: "spring"; data: SpringSnapshot }
  | { type: "rope"; data: RopeSnapshot };

export interface CollisionDebugPoint {
  x: number;
  y: number;
  nx: number;
  ny: number;
}
