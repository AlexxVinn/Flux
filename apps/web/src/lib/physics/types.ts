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
  /** @deprecated Legacy Matter beads; Verlet ropes do not create bodies. */
  ropeId?: string;
  /** @deprecated */
  ropeSegIndex?: number;
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
  /** Local-space anchor on bodyA (default center). */
  anchorA?: { x: number; y: number };
  /** Local-space anchor on bodyB (default center). */
  anchorB?: { x: number; y: number };
}

/** First endpoint chosen while placing a spring or rope. */
export interface SpringPendingAnchor {
  bodyId: string;
  localX: number;
  localY: number;
  worldX: number;
  worldY: number;
}

export type RopePendingAnchor = SpringPendingAnchor;

/** Logical rope: Verlet particle chain between two anchor bodies. */
export interface RopeSnapshot {
  id: string;
  displayName: string;
  bodyA: string;
  bodyB: string;
  /** Interior particles (excluding both anchor endpoints). */
  segmentCount: number;
  linkStiffness: number;
  linkDamping: number;
  visible: boolean;
  anchorA?: { x: number; y: number };
  anchorB?: { x: number; y: number };
  /** World-space simulated points (endpoints + interior), updated each tick. */
  particles?: { x: number; y: number }[];
  segmentLength?: number;
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
