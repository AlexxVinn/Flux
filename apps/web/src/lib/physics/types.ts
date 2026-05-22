export type BodyShape = "circle" | "rectangle";

export type SpawnTool =
  | "select"
  | "circle"
  | "rectangle"
  | "spring"
  | "rigidBar"
  | "rope"
  | "collisionBox"
  | "force"
  | "measure";

export type ForceApplicationMode = "impulse" | "sustained";

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
  /** When true, excluded from marquee/group select; direct canvas/layer click still selects. */
  locked?: boolean;
  /** When true, canvas draws the playback path up to the current timeline review frame. */
  showTrajectory?: boolean;
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
  /** Hooke’s law stiffness \(k\) used for overlays and pedagogical \|F\| ≈ \|kΔL\| (N/m). */
  elasticConstantNnPerM: number;
  stiffness: number;
  damping: number;
  /** Rest length in px (Matter constraint length). */
  length: number;
  visible: boolean;
  locked?: boolean;
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
  locked?: boolean;
  anchorA?: { x: number; y: number };
  anchorB?: { x: number; y: number };
  /** World-space simulated points (endpoints + interior), updated each tick. */
  particles?: { x: number; y: number }[];
  segmentLength?: number;
}

export type SceneMarkupKind = "arrow" | "text" | "measure";

/** Scene markup — arrow, label, or ruler; persisted with the simulation document. */
export interface SceneMarkupSnapshot {
  id: string;
  displayName: string;
  kind: SceneMarkupKind;
  /** World-space points: two for arrow/ruler, one for text anchor. */
  points: { x: number; y: number }[];
  text?: string;
  visible: boolean;
  locked?: boolean;
  /** Ruler readout unit (`measure` kind only). */
  measureUnit?: "m" | "cm";
}

export interface SimulationSnapshot {
  bodies: SimBodySnapshot[];
  springs: SpringSnapshot[];
  ropes: RopeSnapshot[];
  /** Authoring overlays (not simulated by Matter). */
  markups?: SceneMarkupSnapshot[];
  tick: number;
}

export type LayerEntity =
  | { type: "body"; data: SimBodySnapshot }
  | { type: "spring"; data: SpringSnapshot }
  | { type: "rope"; data: RopeSnapshot }
  | { type: "markup"; data: SceneMarkupSnapshot };

export interface CollisionDebugPoint {
  x: number;
  y: number;
  nx: number;
  ny: number;
  /** Flux body ids for this Matter pair (parent label for compounds). */
  bodyA?: string;
  bodyB?: string;
  /** Mixed friction from Matter.Pair for this overlap. */
  frictionMixed?: number;
  frictionStaticMixed?: number;
}
