import Matter from "matter-js";
import type {
  BodyShape,
  CollisionDebugPoint,
  EntityKind,
  RopeSnapshot,
  SimBodySnapshot,
  SimulationSnapshot,
  SpringSnapshot,
} from "./types";
import { nextEntityName, resetNameCounters, reserveEntityName } from "./entityNames";
import {
  ROPE_LINK_DAMPING,
  ROPE_LINK_STIFFNESS,
  ROPE_SEGMENT_DENSITY,
  ROPE_SEGMENT_FRICTION,
  ROPE_SEGMENT_RADIUS,
  ROPE_SEGMENT_RESTITUTION,
  ROPE_SEGMENTS_MAX,
  ROPE_SEGMENTS_MIN,
  ROPE_SPACING_TARGET,
} from "./ropeDefaults";
import {
  DEFAULT_SPRING_DAMPING,
  DEFAULT_SPRING_STIFFNESS,
  SPRING_CONSTRAINT_ITERATIONS,
} from "./springDefaults";
import { FLUX_WORLD } from "./worldSpace";
import { COLLISION_BOX_DEFAULT_SIZE, COLLISION_FRAME_WALL_THICKNESS } from "./physicsConstants";

export { COLLISION_BOX_DEFAULT_SIZE, COLLISION_FRAME_WALL_THICKNESS } from "./physicsConstants";

export interface MatterEngineOptions {
  worldWidth?: number;
  worldHeight?: number;
  gravityY?: number;
}

interface HiddenBodyState {
  velocity: Matter.Vector;
  angularVelocity: number;
}

interface InternalBody {
  id: string;
  shape: BodyShape;
  entityKind: EntityKind;
  displayName: string;
  visible: boolean;
  body: Matter.Body;
  width: number;
  height: number;
  hiddenState?: HiddenBodyState;
}

interface InternalSpring {
  id: string;
  displayName: string;
  visible: boolean;
  constraint: Matter.Constraint;
  bodyA: string;
  bodyB: string;
}

interface InternalRope {
  id: string;
  displayName: string;
  visible: boolean;
  bodyA: string;
  bodyB: string;
  segmentCount: number;
  linkStiffness: number;
  linkDamping: number;
  collisionGroup: number;
  segmentIds: string[];
  constraints: Matter.Constraint[];
}

interface InternalBound {
  id: string;
  displayName: string;
  visible: boolean;
  body: Matter.Body;
}

export interface BodyPropsPatch {
  mass?: number;
  density?: number;
  restitution?: number;
  friction?: number;
  frictionStatic?: number;
  frictionAir?: number;
  isStatic?: boolean;
  gravityScale?: number;
  sleepThreshold?: number;
  velocityX?: number;
  velocityY?: number;
  angularVelocity?: number;
  angle?: number;
}

/**
 * Mechanics sandbox — Matter.js isolated from React UI.
 */
export class MatterSimulationEngine {
  readonly engine: Matter.Engine;
  readonly world: Matter.World;
  readonly worldWidth: number;
  readonly worldHeight: number;
  private bodies = new Map<string, InternalBody>();
  private springs = new Map<string, InternalSpring>();
  private ropes = new Map<string, InternalRope>();
  private ropeGroupSeq = 0;
  private bounds: InternalBound[] = [];
  private idCounter = 0;
  private gravityEnabled = true;
  private gravityScale = 1;
  private lastCollisions: CollisionDebugPoint[] = [];
  private dragBodyId: string | null = null;
  private dragOffset = { x: 0, y: 0 };
  private dragPosition = { x: 0, y: 0 };
  private dragSleepThreshold: number | null = null;
  tick = 0;

  constructor(options: MatterEngineOptions = {}) {
    this.worldWidth = options.worldWidth ?? FLUX_WORLD.WIDTH;
    this.worldHeight = options.worldHeight ?? FLUX_WORLD.HEIGHT;
    this.engine = Matter.Engine.create({
      enableSleeping: true,
      positionIterations: 8,
      velocityIterations: 6,
      constraintIterations: SPRING_CONSTRAINT_ITERATIONS,
    });
    this.world = this.engine.world;
    this.engine.gravity.y = options.gravityY ?? 1;
    this.engine.gravity.scale = 0.001 * this.gravityScale;
    this.createBounds(this.worldWidth, this.worldHeight);
  }

  /** Viewport size changes do not alter world bounds; camera handles view. */
  resize(_width: number, _height: number): void {}

  private createBounds(width: number, height: number): void {
    const t = 60;
    const walls = [
      { x: width / 2, y: -t / 2, w: width + t * 2, h: t },
      { x: width / 2, y: height + t / 2, w: width + t * 2, h: t },
      { x: -t / 2, y: height / 2, w: t, h: height + t * 2 },
      { x: width + t / 2, y: height / 2, w: t, h: height + t * 2 },
    ];
    for (const wall of walls) {
      const id = this.nextId("wall");
      const body = Matter.Bodies.rectangle(wall.x, wall.y, wall.w, wall.h, {
        isStatic: true,
        friction: 0.8,
        restitution: 0.1,
        label: id,
      });
      const displayName = nextEntityName("wall");
      reserveEntityName(displayName);
      this.bounds.push({ id, displayName, visible: true, body });
      Matter.World.add(this.world, body);
    }
  }

  /** Remove the four outer world perimeter walls (used while a collision frame is active). */
  private removeOuterWalls(): void {
    for (const bound of this.bounds) {
      if (bound.visible) Matter.World.remove(this.world, bound.body);
    }
    this.bounds = [];
  }

  /** Restore outer perimeter walls when no collision frame remains. */
  private recreateOuterWalls(): void {
    if (this.bounds.length > 0) return;
    this.createBounds(this.worldWidth, this.worldHeight);
  }

  private hasCollisionBounds(): boolean {
    for (const b of this.bodies.values()) {
      if (b.entityKind === "collisionBounds") return true;
    }
    return false;
  }

  private buildCollisionCompound(
    cx: number,
    cy: number,
    innerW: number,
    innerH: number,
    labelId: string,
  ): Matter.Body {
    const t = COLLISION_FRAME_WALL_THICKNESS;
    const opts = {
      isStatic: true,
      friction: 0.78,
      restitution: 0.12,
    };
    const top = Matter.Bodies.rectangle(cx, cy - innerH / 2 - t / 2, innerW + 2 * t, t, opts);
    const bottom = Matter.Bodies.rectangle(cx, cy + innerH / 2 + t / 2, innerW + 2 * t, t, opts);
    const left = Matter.Bodies.rectangle(cx - innerW / 2 - t / 2, cy, t, innerH, opts);
    const right = Matter.Bodies.rectangle(cx + innerW / 2 + t / 2, cy, t, innerH, opts);
    const compound = Matter.Body.create({
      parts: [top, bottom, left, right],
      isStatic: true,
      friction: 0.78,
      restitution: 0.12,
      label: labelId,
    });
    Matter.Body.setAngle(compound, 0);
    Matter.Sleeping.set(compound, false);
    return compound;
  }

  /**
   * Places a static hollow frame; `width`/`height` are the **inner** playable size.
   * Removes world edge walls until this frame is deleted. At most one frame at a time.
   */
  spawnCollisionBounds(
    cx: number,
    cy: number,
    innerW = COLLISION_BOX_DEFAULT_SIZE,
    innerH = COLLISION_BOX_DEFAULT_SIZE,
    presetId?: string,
    displayName?: string,
  ): string {
    for (const [bid, e] of [...this.bodies.entries()]) {
      if (e.entityKind !== "collisionBounds") continue;
      for (const [sid, spring] of [...this.springs.entries()]) {
        if (spring.bodyA === bid || spring.bodyB === bid) {
          Matter.World.remove(this.world, spring.constraint);
          this.springs.delete(sid);
        }
      }
      for (const [rid, rope] of [...this.ropes.entries()]) {
        if (rope.bodyA === bid || rope.bodyB === bid) {
          this.removeRope(rid);
        }
      }
      if (e.visible) Matter.World.remove(this.world, e.body);
      this.bodies.delete(bid);
    }

    this.removeOuterWalls();

    const id =
      typeof presetId === "string" && presetId.length > 0 ? presetId : crypto.randomUUID();
    if (presetId && presetId.length > 0) this.bumpCounterIfNumericSuffix(presetId);
    const name = displayName ?? nextEntityName("collisionBounds");
    if (displayName) reserveEntityName(displayName);

    const min = 64;
    const w = Math.max(min, innerW);
    const h = Math.max(min, innerH);
    const body = this.buildCollisionCompound(cx, cy, w, h, id);
    this.registerBody(id, "rectangle", "collisionBounds", name, body, w, h);
    return id;
  }

  private rebuildCollisionBounds(id: string, innerW: number, innerH: number): void {
    const entry = this.bodies.get(id);
    if (!entry || entry.entityKind !== "collisionBounds") return;
    const min = 64;
    const w = Math.max(min, innerW);
    const h = Math.max(min, innerH);
    if (w === entry.width && h === entry.height) return;
    const cx = entry.body.position.x;
    const cy = entry.body.position.y;
    const displayName = entry.displayName;
    if (entry.visible) Matter.World.remove(this.world, entry.body);
    const body = this.buildCollisionCompound(cx, cy, w, h, id);
    entry.body = body;
    entry.width = w;
    entry.height = h;
    entry.displayName = displayName;
    if (entry.visible) Matter.World.add(this.world, body);
  }

  private nextId(prefix: string): string {
    this.idCounter += 1;
    return `${prefix}_${this.idCounter}`;
  }

  /** Keep auto-increment ids monotonic when loading preset ids like `body_12` from the server snapshot. */
  private bumpCounterIfNumericSuffix(id: string): void {
    const m = /^[a-zA-Z]+_(\d+)$/.exec(id);
    if (m) this.idCounter = Math.max(this.idCounter, Number(m[1]));
  }

  spawnCircle(x: number, y: number, radius = 24, presetId?: string): string {
    const id =
      typeof presetId === "string" && presetId.length > 0 ? presetId : crypto.randomUUID();
    if (presetId && presetId.length > 0) this.bumpCounterIfNumericSuffix(presetId);
    const d = radius * 2;
    const displayName = nextEntityName("circle");
    const body = Matter.Bodies.circle(x, y, radius, {
      restitution: 0.35,
      friction: 0.45,
      frictionStatic: 0.5,
      frictionAir: 0.01,
      density: 0.002,
      label: id,
    });
    this.registerBody(id, "circle", "circle", displayName, body, d, d);
    return id;
  }

  spawnRectangle(
    x: number,
    y: number,
    w = 48,
    h = 48,
    entityKind: EntityKind = "rectangle",
    displayName?: string,
    presetId?: string,
  ): string {
    const id =
      typeof presetId === "string" && presetId.length > 0 ? presetId : crypto.randomUUID();
    if (presetId && presetId.length > 0) this.bumpCounterIfNumericSuffix(presetId);
    const name = displayName ?? nextEntityName(entityKind === "floor" ? "floor" : "box");
    if (displayName) reserveEntityName(displayName);
    const body = Matter.Bodies.rectangle(x, y, w, h, {
      restitution: 0.3,
      friction: 0.55,
      frictionStatic: 0.6,
      frictionAir: 0.01,
      density: 0.002,
      label: id,
    });
    this.registerBody(id, "rectangle", entityKind, name, body, w, h);
    return id;
  }

  private registerBody(
    id: string,
    shape: BodyShape,
    entityKind: EntityKind,
    displayName: string,
    body: Matter.Body,
    width: number,
    height: number,
  ): void {
    this.bodies.set(id, {
      id,
      shape,
      entityKind,
      displayName,
      visible: true,
      body,
      width,
      height,
    });
    Matter.World.add(this.world, body);
  }

  connectSpring(
    bodyAId: string,
    bodyBId: string,
    options?: { length?: number; stiffness?: number; damping?: number; id?: string },
  ): string | null {
    const a = this.bodies.get(bodyAId);
    const b = this.bodies.get(bodyBId);
    if (!a || !b || !a.visible || !b.visible) return null;
    const dist =
      options?.length ??
      Matter.Vector.magnitude(
        Matter.Vector.sub(b.body.position, a.body.position),
      );
    const id =
      typeof options?.id === "string" && options.id.length > 0
        ? options.id
        : crypto.randomUUID();
    if (options?.id && options.id.length > 0) this.bumpCounterIfNumericSuffix(options.id);
    const displayName = nextEntityName("spring");
    const constraint = Matter.Constraint.create({
      bodyA: a.body,
      bodyB: b.body,
      length: Math.max(dist, 20),
      stiffness: options?.stiffness ?? DEFAULT_SPRING_STIFFNESS,
      damping: options?.damping ?? DEFAULT_SPRING_DAMPING,
    });
    this.springs.set(id, {
      id,
      displayName,
      visible: true,
      constraint,
      bodyA: bodyAId,
      bodyB: bodyBId,
    });
    Matter.World.add(this.world, constraint);
    return id;
  }

  connectRope(
    bodyAId: string,
    bodyBId: string,
    options?: {
      id?: string;
      displayName?: string;
      segmentCount?: number;
      linkStiffness?: number;
      linkDamping?: number;
    },
  ): string | null {
    const a = this.bodies.get(bodyAId);
    const b = this.bodies.get(bodyBId);
    if (!a || !b || !a.visible || !b.visible) return null;
    if (a.entityKind === "ropeSegment" || b.entityKind === "ropeSegment") return null;

    const pa = a.body.position;
    const pb = b.body.position;
    const dx = pb.x - pa.x;
    const dy = pb.y - pa.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 1e-3) return null;

    let nSeg =
      options?.segmentCount ?? Math.max(1, Math.round(dist / ROPE_SPACING_TARGET));
    nSeg = Math.max(ROPE_SEGMENTS_MIN, Math.min(ROPE_SEGMENTS_MAX, nSeg));

    const id =
      typeof options?.id === "string" && options.id.length > 0
        ? options.id
        : crypto.randomUUID();
    if (options?.id && options.id.length > 0) this.bumpCounterIfNumericSuffix(options.id);
    const displayName = options?.displayName ?? nextEntityName("rope");
    if (options?.displayName) reserveEntityName(options.displayName);

    const stiffness = options?.linkStiffness ?? ROPE_LINK_STIFFNESS;
    const damping = options?.linkDamping ?? ROPE_LINK_DAMPING;
    const collisionGroup = -(++this.ropeGroupSeq);
    const linkLen = dist / (nSeg + 1);

    const segmentIds: string[] = [];
    for (let i = 0; i < nSeg; i++) {
      const t = (i + 1) / (nSeg + 1);
      const sx = pa.x + dx * t;
      const sy = pa.y + dy * t;
      const segId = this.nextId("ropeSeg");
      const segBody = Matter.Bodies.circle(sx, sy, ROPE_SEGMENT_RADIUS, {
        label: segId,
        friction: ROPE_SEGMENT_FRICTION,
        frictionStatic: ROPE_SEGMENT_FRICTION,
        restitution: ROPE_SEGMENT_RESTITUTION,
        frictionAir: 0.02,
        density: ROPE_SEGMENT_DENSITY,
        collisionFilter: { group: collisionGroup },
      });
      segBody.plugin = { ...(segBody.plugin ?? {}), fluxRopeId: id };
      this.registerBody(
        segId,
        "circle",
        "ropeSegment",
        `${displayName}·${i + 1}`,
        segBody,
        ROPE_SEGMENT_RADIUS * 2,
        ROPE_SEGMENT_RADIUS * 2,
      );
      segmentIds.push(segId);
    }

    const chainBodies: Matter.Body[] = [
      a.body,
      ...segmentIds.map((sid) => this.bodies.get(sid)!.body),
      b.body,
    ];
    const constraints: Matter.Constraint[] = [];
    for (let i = 0; i < chainBodies.length - 1; i++) {
      const c = Matter.Constraint.create({
        bodyA: chainBodies[i]!,
        bodyB: chainBodies[i + 1]!,
        length: linkLen,
        stiffness,
        damping,
      });
      constraints.push(c);
      Matter.World.add(this.world, c);
    }

    this.ropes.set(id, {
      id,
      displayName,
      visible: true,
      bodyA: bodyAId,
      bodyB: bodyBId,
      segmentCount: nSeg,
      linkStiffness: stiffness,
      linkDamping: damping,
      collisionGroup,
      segmentIds,
      constraints,
    });

    return id;
  }

  removeSpring(id: string): void {
    const s = this.springs.get(id);
    if (!s) return;
    Matter.World.remove(this.world, s.constraint);
    this.springs.delete(id);
  }

  removeRope(id: string): void {
    const rope = this.ropes.get(id);
    if (!rope) return;
    for (const c of rope.constraints) {
      Matter.World.remove(this.world, c);
    }
    for (const segId of rope.segmentIds) {
      const ent = this.bodies.get(segId);
      if (ent?.visible) Matter.World.remove(this.world, ent.body);
      this.bodies.delete(segId);
    }
    this.ropes.delete(id);
  }

  /** Resolve parent rope when picking a segment body. */
  ropeIdForSegmentBody(bodyId: string): string | null {
    const e = this.bodies.get(bodyId);
    if (!e || e.entityKind !== "ropeSegment") return null;
    const p = e.body.plugin as { fluxRopeId?: string } | undefined;
    return p?.fluxRopeId ?? null;
  }
    const body = this.bodies.get(id);
    if (body) {
      reserveEntityName(displayName);
      body.displayName = displayName;
      return true;
    }
    const spring = this.springs.get(id);
    if (spring) {
      reserveEntityName(displayName);
      spring.displayName = displayName;
      return true;
    }
    const rope = this.ropes.get(id);
    if (rope) {
      reserveEntityName(displayName);
      rope.displayName = displayName;
      return true;
    }
    const bound = this.bounds.find((b) => b.id === id);
    if (bound) {
      reserveEntityName(displayName);
      bound.displayName = displayName;
      return true;
    }
    return false;
  }

  setBodyVisible(id: string, visible: boolean): void {
    const entry = this.bodies.get(id);
    if (!entry || entry.visible === visible) return;

    if (!visible) {
      entry.hiddenState = {
        velocity: { ...entry.body.velocity },
        angularVelocity: entry.body.angularVelocity,
      };
      Matter.World.remove(this.world, entry.body);
      this.syncSpringsForBody(id, false);
      this.syncRopesForBody(id, false);
    } else {
      Matter.World.add(this.world, entry.body);
      if (entry.hiddenState) {
        Matter.Body.setVelocity(entry.body, entry.hiddenState.velocity);
        Matter.Body.setAngularVelocity(entry.body, entry.hiddenState.angularVelocity);
        entry.hiddenState = undefined;
      }
      Matter.Sleeping.set(entry.body, false);
      this.syncSpringsForBody(id, true);
      this.syncRopesForBody(id, true);
    }
    entry.visible = visible;
  }

  setSpringVisible(id: string, visible: boolean): void {
    const spring = this.springs.get(id);
    if (!spring || spring.visible === visible) return;
    const a = this.bodies.get(spring.bodyA);
    const b = this.bodies.get(spring.bodyB);
    if (!visible) {
      Matter.World.remove(this.world, spring.constraint);
    } else if (a?.visible && b?.visible) {
      Matter.World.add(this.world, spring.constraint);
    }
    spring.visible = visible;
  }

  setRopeVisible(id: string, visible: boolean): void {
    const rope = this.ropes.get(id);
    if (!rope || rope.visible === visible) return;
    const a = this.bodies.get(rope.bodyA);
    const b = this.bodies.get(rope.bodyB);
    const endpointsVisible = a?.visible && b?.visible;
    if (!visible) {
      for (const c of rope.constraints) Matter.World.remove(this.world, c);
      for (const segId of rope.segmentIds) {
        const s = this.bodies.get(segId);
        if (s?.visible) Matter.World.remove(this.world, s.body);
      }
    } else if (endpointsVisible) {
      for (const c of rope.constraints) Matter.World.add(this.world, c);
      for (const segId of rope.segmentIds) {
        const s = this.bodies.get(segId);
        if (s?.visible) Matter.World.add(this.world, s.body);
      }
    }
    rope.visible = visible;
  }
    const bound = this.bounds.find((b) => b.id === id);
    if (!bound || bound.visible === visible) return;
    if (!visible) Matter.World.remove(this.world, bound.body);
    else Matter.World.add(this.world, bound.body);
    bound.visible = visible;
  }

  setEntityVisible(id: string, visible: boolean): void {
    if (this.bodies.has(id)) this.setBodyVisible(id, visible);
    else if (this.springs.has(id)) this.setSpringVisible(id, visible);
    else if (this.ropes.has(id)) this.setRopeVisible(id, visible);
    else this.setBoundVisible(id, visible);
  }

  isEntityVisible(id: string): boolean {
    const b = this.bodies.get(id);
    if (b) return b.visible;
    const s = this.springs.get(id);
    if (s) return s.visible;
    const r = this.ropes.get(id);
    if (r) return r.visible;
    return this.bounds.find((x) => x.id === id)?.visible ?? true;
  }

  private syncSpringsForBody(bodyId: string, visible: boolean): void {
    for (const spring of this.springs.values()) {
      if (spring.bodyA !== bodyId && spring.bodyB !== bodyId) continue;
      const a = this.bodies.get(spring.bodyA);
      const b = this.bodies.get(spring.bodyB);
      const bothVisible = a?.visible && b?.visible;
      if (!bothVisible) {
        Matter.World.remove(this.world, spring.constraint);
      } else if (visible && spring.visible) {
        Matter.World.add(this.world, spring.constraint);
      }
    }
  }

  private syncRopesForBody(bodyId: string, visible: boolean): void {
    for (const rope of this.ropes.values()) {
      if (rope.bodyA !== bodyId && rope.bodyB !== bodyId) continue;
      const a = this.bodies.get(rope.bodyA);
      const b = this.bodies.get(rope.bodyB);
      const bothVisible = a?.visible && b?.visible;
      if (!bothVisible) {
        for (const c of rope.constraints) Matter.World.remove(this.world, c);
        for (const segId of rope.segmentIds) {
          const s = this.bodies.get(segId);
          if (s?.visible) Matter.World.remove(this.world, s.body);
        }
      } else if (visible && rope.visible) {
        for (const c of rope.constraints) Matter.World.add(this.world, c);
        for (const segId of rope.segmentIds) {
          const s = this.bodies.get(segId);
          if (s?.visible) Matter.World.add(this.world, s.body);
        }
      }
    }
  }

  removeBody(id: string): void {
    const entry = this.bodies.get(id);
    if (entry?.entityKind === "ropeSegment") {
      const rid = this.ropeIdForSegmentBody(id);
      if (rid) this.removeRope(rid);
      return;
    }
    const wasCollision = entry?.entityKind === "collisionBounds";
    if (!entry) return;
    for (const [sid, spring] of this.springs) {
      if (spring.bodyA === id || spring.bodyB === id) {
        Matter.World.remove(this.world, spring.constraint);
        this.springs.delete(sid);
      }
    }
    for (const [rid, rope] of this.ropes) {
      if (rope.bodyA === id || rope.bodyB === id) {
        this.removeRope(rid);
      }
    }
    if (entry.visible) Matter.World.remove(this.world, entry.body);
    this.bodies.delete(id);
    if (wasCollision && !this.hasCollisionBounds()) {
      this.recreateOuterWalls();
    }
  }

  setBodyPosition(id: string, x: number, y: number): void {
    const entry = this.bodies.get(id);
    if (!entry || !entry.visible) return;
    if (entry.body.isStatic && entry.entityKind !== "collisionBounds") return;
    Matter.Body.setPosition(entry.body, { x, y });
    Matter.Body.setVelocity(entry.body, { x: 0, y: 0 });
    Matter.Body.setAngularVelocity(entry.body, 0);
    Matter.Sleeping.set(entry.body, false);
  }

  /** Resize dynamic shapes (boxes/circles). Circles use diameter = max(width, height). */
  setBodyDimensions(id: string, width: number, height: number): void {
    const entry = this.bodies.get(id);
    if (!entry || !entry.visible) return;
    if (entry.entityKind === "wall" || entry.entityKind === "floor") return;

    if (entry.entityKind === "collisionBounds") {
      this.rebuildCollisionBounds(id, width, height);
      return;
    }

    const min = 8;
    let w = Math.max(min, width);
    let h = Math.max(min, height);

    if (entry.shape === "circle") {
      const diameter = Math.max(w, h);
      w = h = diameter;
    }

    const sx = w / entry.width;
    const sy = h / entry.height;
    if (Math.abs(sx - 1) < 1e-6 && Math.abs(sy - 1) < 1e-6) return;

    const b = entry.body;
    const center = { x: b.position.x, y: b.position.y };
    Matter.Body.scale(b, sx, sy, center);
    entry.width = w;
    entry.height = h;
    Matter.Sleeping.set(b, false);
  }

  beginDrag(id: string, pointerX: number, pointerY: number): void {
    const entry = this.bodies.get(id);
    if (!entry || !entry.visible) return;
    if (entry.entityKind === "ropeSegment") return;
    if (entry.body.isStatic && entry.entityKind !== "collisionBounds") return;
    const { x, y } = entry.body.position;
    this.dragBodyId = id;
    this.dragOffset = { x: pointerX - x, y: pointerY - y };
    this.dragPosition = { x, y };
    this.dragSleepThreshold = entry.body.sleepThreshold;
    entry.body.sleepThreshold = Infinity;
    Matter.Sleeping.set(entry.body, false);
    this.applyDragPin();
  }

  dragTo(id: string, pointerX: number, pointerY: number): void {
    if (this.dragBodyId !== id) return;
    this.dragPosition = {
      x: pointerX - this.dragOffset.x,
      y: pointerY - this.dragOffset.y,
    };
    this.applyDragPin();
  }

  endDrag(): void {
    if (this.dragBodyId) {
      const entry = this.bodies.get(this.dragBodyId);
      if (entry && this.dragSleepThreshold !== null) {
        entry.body.sleepThreshold = this.dragSleepThreshold;
      }
    }
    this.dragBodyId = null;
    this.dragSleepThreshold = null;
  }

  isDragging(id?: string): boolean {
    if (!this.dragBodyId) return false;
    return id === undefined || this.dragBodyId === id;
  }

  private applyDragPin(): void {
    const id = this.dragBodyId;
    if (!id) return;
    const entry = this.bodies.get(id);
    if (!entry || !entry.visible) return;
    const { x, y } = this.dragPosition;
    Matter.Body.setPosition(entry.body, { x, y });
    Matter.Body.setVelocity(entry.body, { x: 0, y: 0 });
    Matter.Body.setAngularVelocity(entry.body, 0);
    Matter.Sleeping.set(entry.body, false);
  }

  updateSpringProps(
    id: string,
    props: { stiffness?: number; damping?: number; length?: number },
  ): void {
    const spring = this.springs.get(id);
    if (!spring || !spring.visible) return;
    const c = spring.constraint;
    if (props.stiffness !== undefined) c.stiffness = props.stiffness;
    if (props.damping !== undefined) c.damping = props.damping;
    if (props.length !== undefined) c.length = Math.max(props.length, 20);
    const a = this.bodies.get(spring.bodyA);
    const b = this.bodies.get(spring.bodyB);
    if (a?.visible) Matter.Sleeping.set(a.body, false);
    if (b?.visible) Matter.Sleeping.set(b.body, false);
  }

  updateBodyProps(id: string, props: BodyPropsPatch): void {
    const entry = this.bodies.get(id);
    if (!entry) return;
    const b = entry.body;
    if (entry.entityKind === "collisionBounds") {
      if (props.isStatic === false) Matter.Body.setStatic(b, true);
      if (props.angle !== undefined) Matter.Body.setAngle(b, 0);
      return;
    }
    if (props.isStatic !== undefined) Matter.Body.setStatic(b, props.isStatic);
    if (props.restitution !== undefined) b.restitution = props.restitution;
    if (props.friction !== undefined) b.friction = props.friction;
    if (props.frictionStatic !== undefined) b.frictionStatic = props.frictionStatic;
    if (props.frictionAir !== undefined) b.frictionAir = props.frictionAir;
    if (props.sleepThreshold !== undefined) {
      b.sleepThreshold = props.sleepThreshold;
    }
    if (props.density !== undefined && !b.isStatic) {
      Matter.Body.setDensity(b, props.density);
    }
    if (props.mass !== undefined && !b.isStatic) {
      Matter.Body.setMass(b, props.mass);
    }
    if (props.velocityX !== undefined || props.velocityY !== undefined) {
      Matter.Body.setVelocity(b, {
        x: props.velocityX ?? b.velocity.x,
        y: props.velocityY ?? b.velocity.y,
      });
    }
    if (props.angularVelocity !== undefined) {
      Matter.Body.setAngularVelocity(b, props.angularVelocity);
    }
    if (props.angle !== undefined) {
      Matter.Body.setAngle(b, props.angle);
    }
    if (props.gravityScale !== undefined) {
      b.plugin = { ...b.plugin, fluxGravityScale: props.gravityScale };
    }
  }

  getBodyGravityScale(id: string): number {
    const entry = this.bodies.get(id);
    if (!entry) return 1;
    const plugin = entry.body.plugin as { fluxGravityScale?: number } | undefined;
    return plugin?.fluxGravityScale ?? 1;
  }

  setGravity(enabled: boolean, scale = 1): void {
    this.gravityEnabled = enabled;
    this.gravityScale = scale;
    this.engine.gravity.y = enabled ? 1 : 0;
    this.engine.gravity.scale = enabled ? 0.001 * scale : 0;
  }

  isGravityEnabled(): boolean {
    return this.gravityEnabled;
  }

  getGravityForceOnBody(id: string): { x: number; y: number } {
    const entry = this.bodies.get(id);
    if (!entry || !this.gravityEnabled || entry.body.isStatic || !entry.visible) {
      return { x: 0, y: 0 };
    }
    const g = this.engine.gravity;
    const scale = g.scale ?? 0.001;
    const bodyScale = this.getBodyGravityScale(id);
    return {
      x: entry.body.mass * (g.x ?? 0) * scale * 1000 * bodyScale,
      y: entry.body.mass * (g.y ?? 0) * scale * 1000 * bodyScale,
    };
  }

  private collectCollisions(): void {
    const pts: CollisionDebugPoint[] = [];
    const pairs = this.engine.pairs.list;
    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i]!;
      if (!pair.isActive || pair.contactCount === 0) continue;

      const collision = pair.collision;
      const normal = collision?.normal;
      const nx = normal?.x ?? 0;
      const ny = normal?.y ?? 0;

      for (let j = 0; j < pair.contactCount; j++) {
        const vertex = pair.contacts[j]?.vertex;
        if (!vertex) continue;
        pts.push({
          x: vertex.x,
          y: vertex.y,
          nx,
          ny,
        });
      }
    }
    this.lastCollisions = pts;
  }

  getCollisionDebugPoints(): CollisionDebugPoint[] {
    return this.lastCollisions;
  }

  step(dtMs: number, timeScale = 1): void {
    Matter.Engine.update(this.engine, dtMs * timeScale);
    if (this.dragBodyId) this.applyDragPin();
    this.collectCollisions();
    this.tick += 1;
  }

  stepOnce(dtMs = 16.667, timeScale = 1): void {
    this.step(dtMs, timeScale);
  }

  setTick(tick: number): void {
    this.tick = tick;
  }

  restoreCompact(
    states: Array<{
      id: string;
      x: number;
      y: number;
      angle: number;
      velocityX: number;
      velocityY: number;
    }>,
  ): void {
    for (const s of states) {
      const entry = this.bodies.get(s.id);
      if (!entry || !entry.visible) continue;
      const b = entry.body;
      Matter.Body.setPosition(b, { x: s.x, y: s.y });
      Matter.Body.setAngle(b, s.angle);
      Matter.Body.setVelocity(b, { x: s.velocityX, y: s.velocityY });
      Matter.Body.setAngularVelocity(b, 0);
      Matter.Sleeping.set(b, false);
    }
  }

  reset(width: number, height: number): void {
    Matter.World.clear(this.world, false);
    this.bodies.clear();
    this.springs.clear();
    this.bounds = [];
    this.tick = 0;
    resetNameCounters();
    this.createBounds(width, height);
    const floorW = width - 80;
    const floorH = 36;
    this.spawnRectangle(width / 2, height - 40, floorW, floorH, "floor", nextEntityName("floor"));
    const floor = [...this.bodies.values()].find((b) => b.entityKind === "floor");
    if (floor) this.updateBodyProps(floor.id, { isStatic: true, friction: 0.85 });
  }

  private bodyToSnapshot(entry: InternalBody): SimBodySnapshot {
    const b = entry.body;
    const plugin = b.plugin as { fluxGravityScale?: number } | undefined;
    return {
      id: entry.id,
      displayName: entry.displayName,
      label: entry.displayName,
      shape: entry.shape,
      entityKind: entry.entityKind,
      x: b.position.x,
      y: b.position.y,
      angle: entry.entityKind === "collisionBounds" ? 0 : b.angle,
      velocityX: b.velocity.x,
      velocityY: b.velocity.y,
      angularVelocity: b.angularVelocity,
      mass: b.mass,
      density: b.density,
      restitution: b.restitution,
      friction: b.friction,
      frictionStatic: b.frictionStatic,
      frictionAir: b.frictionAir,
      sleepThreshold: b.sleepThreshold,
      isStatic: b.isStatic,
      visible: entry.visible,
      gravityScale: plugin?.fluxGravityScale ?? 1,
      isSleeping: b.isSleeping,
      width: entry.width,
      height: entry.height,
    };
  }

  snapshot(): SimulationSnapshot {
    const bodies: SimBodySnapshot[] = [];
    for (const entry of this.bodies.values()) {
      bodies.push(this.bodyToSnapshot(entry));
    }
    for (const bound of this.bounds) {
      const b = bound.body;
      bodies.push({
        id: bound.id,
        displayName: bound.displayName,
        label: bound.displayName,
        shape: "rectangle",
        entityKind: "wall",
        x: b.position.x,
        y: b.position.y,
        angle: b.angle,
        velocityX: 0,
        velocityY: 0,
        angularVelocity: 0,
        mass: Infinity,
        density: 0,
        restitution: b.restitution,
        friction: b.friction,
        frictionStatic: b.frictionStatic,
        frictionAir: 0,
        sleepThreshold: Infinity,
        isStatic: true,
        visible: bound.visible,
        gravityScale: 0,
        isSleeping: false,
        width: (b.bounds.max.x - b.bounds.min.x),
        height: (b.bounds.max.y - b.bounds.min.y),
      });
    }
    const springs: SpringSnapshot[] = [...this.springs.values()].map((s) => ({
      id: s.id,
      displayName: s.displayName,
      bodyA: s.bodyA,
      bodyB: s.bodyB,
      stiffness: s.constraint.stiffness ?? 0,
      damping: s.constraint.damping ?? 0,
      length: s.constraint.length ?? 0,
      visible: s.visible,
    }));
    return { bodies, springs, tick: this.tick };
  }

  /** Demo bodies near world center (above the floor). */
  seedDemo(): void {
    this.reset(this.worldWidth, this.worldHeight);
    const cx = this.worldWidth / 2;
    const cy = this.worldHeight / 2;
    this.spawnCircle(cx, cy - 900, 22);
    this.spawnRectangle(cx - 80, cy - 400, 40, 40);
    this.spawnRectangle(cx + 80, cy - 400, 56, 32);
  }

  /** Load a authored scenario after {@link reset} (skips walls/floor — bounds come from reset). */
  importScenario(snap: SimulationSnapshot): void {
    for (const b of snap.bodies) {
      if (b.entityKind === "wall" || b.entityKind === "floor") continue;
      if (!b.id) continue;

      if (b.entityKind === "collisionBounds") {
        this.spawnCollisionBounds(b.x, b.y, b.width, b.height, b.id, b.displayName);
      } else if (b.shape === "circle") {
        this.spawnCircle(b.x, b.y, b.width / 2, b.id);
      } else {
        this.spawnRectangle(b.x, b.y, b.width, b.height, b.entityKind, b.displayName, b.id);
      }

      this.updateBodyProps(b.id, {
        isStatic: b.isStatic,
        restitution: b.restitution,
        friction: b.friction,
        frictionStatic: b.frictionStatic,
        frictionAir: b.frictionAir,
        mass: b.isStatic ? undefined : b.mass,
        density: b.isStatic ? undefined : b.density,
        velocityX: b.velocityX,
        velocityY: b.velocityY,
        angularVelocity: b.angularVelocity,
        angle: b.angle,
        gravityScale: b.gravityScale,
      });
      if (b.visible === false) this.setBodyVisible(b.id, false);
    }

    for (const s of snap.springs) {
      if (!s.id || !s.bodyA || !s.bodyB) continue;
      if (!this.bodies.has(s.bodyA) || !this.bodies.has(s.bodyB)) continue;
      this.connectSpring(s.bodyA, s.bodyB, {
        stiffness: s.stiffness,
        damping: s.damping,
        length: s.length > 0 ? s.length : undefined,
        id: s.id,
      });
      if (s.visible === false) this.setSpringVisible(s.id, false);
    }
  }

  seedScenario(snap: SimulationSnapshot): void {
    this.reset(this.worldWidth, this.worldHeight);
    if (snap.bodies.some((b) => b.entityKind === "collisionBounds")) {
      this.removeOuterWalls();
    }
    this.importScenario(snap);
  }

  getOrderedLayerIds(): string[] {
    const ids: string[] = [];
    for (const b of this.bounds) ids.push(b.id);
    for (const b of this.bodies.values()) ids.push(b.id);
    for (const s of this.springs.values()) ids.push(s.id);
    return ids;
  }
}
