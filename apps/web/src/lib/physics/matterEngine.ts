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
  ROPE_GRAVITY_SCALE,
  ROPE_LINK_DAMPING,
  ROPE_LINK_STIFFNESS,
  ROPE_VERLET_SUBSTEPS,
} from "./ropeDefaults";
import { anchorCollisionRadius, anchorSurfaceWorld } from "./ropeGeometry";
import { computeRopeParticleLayout } from "./ropeLayout";
import { SCENE_BODY_COLLISION_FILTER } from "./ropeCollisionFilters";
import {
  createVerletRope,
  reinitializeVerletRope,
  stepVerletRope,
  type RopeSimContext,
  type VerletRope,
} from "./ropeVerlet";
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
  anchorA: { x: number; y: number };
  anchorB: { x: number; y: number };
}

interface InternalRope {
  id: string;
  displayName: string;
  visible: boolean;
  bodyA: string;
  bodyB: string;
  anchorA: { x: number; y: number };
  anchorB: { x: number; y: number };
  segmentCount: number;
  linkStiffness: number;
  linkDamping: number;
  verlet: VerletRope;
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
  private sceneCollidersCache: Matter.Body[] | null = null;
  private bounds: InternalBound[] = [];
  private idCounter = 0;
  private gravityEnabled = true;
  private gravityScale = 1;
  private lastCollisions: CollisionDebugPoint[] = [];
  private dragBodyId: string | null = null;
  private dragOffset = { x: 0, y: 0 };
  private dragPosition = { x: 0, y: 0 };
  private dragSleepThreshold: number | null = null;
  /** Linear / angular velocity before drag — restored on {@link endDrag}. */
  private dragSavedMotion: { vx: number; vy: number; av: number } | null = null;
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

  private getSceneColliders(): Matter.Body[] {
    if (this.sceneCollidersCache) return this.sceneCollidersCache;
    const colliders: Matter.Body[] = [];
    for (const bound of this.bounds) {
      if (bound.visible) colliders.push(bound.body);
    }
    for (const ent of this.bodies.values()) {
      if (!ent.visible || ent.entityKind === "ropeSegment") continue;
      colliders.push(ent.body);
    }
    this.sceneCollidersCache = colliders;
    return colliders;
  }

  private invalidateColliderCache(): void {
    this.sceneCollidersCache = null;
  }

  /** Rope tension uses applyForce; must be cleared when paused or before each step. */
  clearBodyForces(): void {
    for (const ent of this.bodies.values()) {
      if (!ent.visible) continue;
      Matter.Body.set(ent.body, {
        force: { x: 0, y: 0 },
        torque: 0,
      });
    }
  }

  private simulateVerletRopes(dtSec: number): void {
    const g = this.engine.gravity;
    const gravityY = this.gravityEnabled ? (g.y ?? 0) * (g.scale ?? 0.001) * 1000 * ROPE_GRAVITY_SCALE : 0;
    const baseColliders = this.getSceneColliders();
    const subDt = dtSec / ROPE_VERLET_SUBSTEPS;
    const lastSub = ROPE_VERLET_SUBSTEPS - 1;

    for (let sub = 0; sub < ROPE_VERLET_SUBSTEPS; sub++) {
      for (const rope of this.ropes.values()) {
        if (!rope.visible) continue;
        const entA = this.bodies.get(rope.bodyA);
        const entB = this.bodies.get(rope.bodyB);
        if (!entA?.visible || !entB?.visible) continue;

        const surfA = this.localPointToWorld(entA.body, rope.anchorA.x, rope.anchorA.y);
        const surfB = this.localPointToWorld(entB.body, rope.anchorB.x, rope.anchorB.y);
        const labelA = entA.body.label ?? rope.bodyA;
        const labelB = entB.body.label ?? rope.bodyB;
        const exclude = new Set([labelA, labelB]);

        const ctx: RopeSimContext = {
          gravityX: (g.x ?? 0) * (g.scale ?? 0.001) * 1000 * ROPE_GRAVITY_SCALE,
          gravityY,
          colliders: baseColliders,
          excludeLabels: exclude,
        };

        const { forceA, forceB } = stepVerletRope(
          rope.verlet,
          surfA,
          surfB,
          entA.body.velocity,
          entB.body.velocity,
          ctx,
          subDt,
        );

        if (sub !== lastSub) continue;

        if (!entA.body.isStatic) {
          Matter.Body.applyForce(entA.body, surfA, {
            x: forceA.x * entA.body.mass,
            y: forceA.y * entA.body.mass,
          });
        }
        if (!entB.body.isStatic) {
          Matter.Body.applyForce(entB.body, surfB, {
            x: forceB.x * entB.body.mass,
            y: forceB.y * entB.body.mass,
          });
        }
      }
    }
  }

  /** Viewport size changes do not alter world bounds; camera handles view. */
  resize(_width: number, _height: number): void {}

  private worldPointToBodyLocal(body: Matter.Body, wx: number, wy: number): Matter.Vector {
    const dx = wx - body.position.x;
    const dy = wy - body.position.y;
    return Matter.Vector.rotate({ x: dx, y: dy }, -body.angle);
  }

  private localPointToWorld(
    body: Matter.Body,
    lx: number,
    ly: number,
  ): { x: number; y: number } {
    const rotated = Matter.Vector.rotate({ x: lx, y: ly }, body.angle);
    return { x: body.position.x + rotated.x, y: body.position.y + rotated.y };
  }

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
        collisionFilter: SCENE_BODY_COLLISION_FILTER,
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
    compound.collisionFilter = {
      ...compound.collisionFilter,
      ...SCENE_BODY_COLLISION_FILTER,
    };
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
    if (entityKind !== "ropeSegment") {
      body.collisionFilter = {
        ...body.collisionFilter,
        ...SCENE_BODY_COLLISION_FILTER,
      };
    }
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
    this.invalidateColliderCache();
  }

  connectSpring(
    bodyAId: string,
    bodyBId: string,
    options?: {
      length?: number;
      stiffness?: number;
      damping?: number;
      id?: string;
      pointA?: { x: number; y: number };
      pointB?: { x: number; y: number };
    },
  ): string | null {
    const a = this.bodies.get(bodyAId);
    const b = this.bodies.get(bodyBId);
    if (!a || !b || !a.visible || !b.visible) return null;

    const pointA = options?.pointA ?? { x: 0, y: 0 };
    const pointB = options?.pointB ?? { x: 0, y: 0 };
    const wA = this.localPointToWorld(a.body, pointA.x, pointA.y);
    const wB = this.localPointToWorld(b.body, pointB.x, pointB.y);
    const dist =
      options?.length ?? Math.max(20, Math.hypot(wB.x - wA.x, wB.y - wA.y));

    const id =
      typeof options?.id === "string" && options.id.length > 0
        ? options.id
        : crypto.randomUUID();
    if (options?.id && options.id.length > 0) this.bumpCounterIfNumericSuffix(options.id);
    const displayName = nextEntityName("spring");
    const constraint = Matter.Constraint.create({
      bodyA: a.body,
      bodyB: b.body,
      pointA,
      pointB,
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
      anchorA: { ...pointA },
      anchorB: { ...pointB },
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
      pointA?: { x: number; y: number };
      pointB?: { x: number; y: number };
    },
  ): string | null {
    const a = this.bodies.get(bodyAId);
    const b = this.bodies.get(bodyBId);
    if (!a || !b || !a.visible || !b.visible) return null;
    if (a.entityKind === "ropeSegment" || b.entityKind === "ropeSegment") return null;

    const ra = anchorCollisionRadius(a.width, a.height, a.shape);
    const rb = anchorCollisionRadius(b.width, b.height, b.shape);

    let pointA: { x: number; y: number };
    let pointB: { x: number; y: number };
    let surfA: { x: number; y: number };
    let surfB: { x: number; y: number };
    let span: number;

    if (options?.pointA && options?.pointB) {
      pointA = { ...options.pointA };
      pointB = { ...options.pointB };
      surfA = this.localPointToWorld(a.body, pointA.x, pointA.y);
      surfB = this.localPointToWorld(b.body, pointB.x, pointB.y);
      span = Math.hypot(surfB.x - surfA.x, surfB.y - surfA.y);
    } else {
      const pa = a.body.position;
      const pb = b.body.position;
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 1e-3) return null;
      const ux = dx / dist;
      const uy = dy / dist;
      surfA = anchorSurfaceWorld(pa.x, pa.y, ux, uy, ra, true);
      surfB = anchorSurfaceWorld(pb.x, pb.y, ux, uy, rb, false);
      pointA = this.worldPointToBodyLocal(a.body, surfA.x, surfA.y);
      pointB = this.worldPointToBodyLocal(b.body, surfB.x, surfB.y);
      span = Math.hypot(surfB.x - surfA.x, surfB.y - surfA.y);
    }

    if (span < 1e-3) return null;

    const layout = computeRopeParticleLayout(span, options?.segmentCount);
    const verlet = createVerletRope(
      surfA,
      surfB,
      layout.pointCount,
      layout.segmentLength,
      layout.radius,
    );

    const id =
      typeof options?.id === "string" && options.id.length > 0
        ? options.id
        : crypto.randomUUID();
    if (options?.id && options.id.length > 0) this.bumpCounterIfNumericSuffix(options.id);
    const displayName = options?.displayName ?? nextEntityName("rope");
    if (options?.displayName) reserveEntityName(options.displayName);

    this.ropes.set(id, {
      id,
      displayName,
      visible: true,
      bodyA: bodyAId,
      bodyB: bodyBId,
      anchorA: { ...pointA },
      anchorB: { ...pointB },
      segmentCount: layout.interiorCount,
      linkStiffness: options?.linkStiffness ?? ROPE_LINK_STIFFNESS,
      linkDamping: options?.linkDamping ?? ROPE_LINK_DAMPING,
      verlet,
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
    this.ropes.delete(id);
  }

  /** @deprecated Verlet ropes have no Matter segment bodies. */
  ropeIdForSegmentBody(_bodyId: string): string | null {
    return null;
  }

  renameEntity(id: string, displayName: string): boolean {
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
    rope.visible = visible;
  }

  setBoundVisible(id: string, visible: boolean): void {
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

  private syncRopesForBody(_bodyId: string, _visible: boolean): void {
    /* Verlet ropes have no Matter bodies — visibility is logical only. */
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

  setBodyPosition(
    id: string,
    x: number,
    y: number,
    opts?: { zeroVelocity?: boolean },
  ): void {
    const entry = this.bodies.get(id);
    if (!entry || !entry.visible) return;
    if (entry.body.isStatic && entry.entityKind !== "collisionBounds") return;
    Matter.Body.setPosition(entry.body, { x, y });
    if (opts?.zeroVelocity) {
      Matter.Body.setVelocity(entry.body, { x: 0, y: 0 });
      Matter.Body.setAngularVelocity(entry.body, 0);
    }
    Matter.Sleeping.set(entry.body, false);
  }

  setBodyMotion(id: string, vx: number, vy: number, av: number): void {
    const entry = this.bodies.get(id);
    if (!entry || !entry.visible) return;
    if (entry.body.isStatic && entry.entityKind !== "collisionBounds") return;
    Matter.Body.setVelocity(entry.body, { x: vx, y: vy });
    Matter.Body.setAngularVelocity(entry.body, av);
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
    this.dragSavedMotion = {
      vx: entry.body.velocity.x,
      vy: entry.body.velocity.y,
      av: entry.body.angularVelocity,
    };
    Matter.Sleeping.set(entry.body, false);
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
      if (entry) {
        if (this.dragSleepThreshold !== null) {
          entry.body.sleepThreshold = this.dragSleepThreshold;
        }
        if (this.dragSavedMotion) {
          Matter.Body.setVelocity(entry.body, {
            x: this.dragSavedMotion.vx,
            y: this.dragSavedMotion.vy,
          });
          Matter.Body.setAngularVelocity(entry.body, this.dragSavedMotion.av);
          Matter.Sleeping.set(entry.body, false);
        }
      }
    }
    this.dragBodyId = null;
    this.dragSleepThreshold = null;
    this.dragSavedMotion = null;
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

  updateRopeProps(
    id: string,
    props: { linkStiffness?: number; linkDamping?: number },
  ): void {
    const rope = this.ropes.get(id);
    if (!rope || !rope.visible) return;
    if (props.linkStiffness !== undefined) rope.linkStiffness = props.linkStiffness;
    if (props.linkDamping !== undefined) rope.linkDamping = props.linkDamping;
    const a = this.bodies.get(rope.bodyA);
    const b = this.bodies.get(rope.bodyB);
    if (a?.visible) Matter.Sleeping.set(a.body, false);
    if (b?.visible) Matter.Sleeping.set(b.body, false);
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
    const scaledDt = dtMs * timeScale;
    const hasRopes = this.ropes.size > 0;

    this.engine.constraintIterations = SPRING_CONSTRAINT_ITERATIONS;
    this.engine.positionIterations = 8;
    this.engine.velocityIterations = 6;

    const stepMs = scaledDt;
    const dtSec = stepMs / 1000;

    this.clearBodyForces();
    if (hasRopes) {
      this.simulateVerletRopes(dtSec);
    }
    Matter.Engine.update(this.engine, stepMs);

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

  private ropeAnchorWorld(rope: InternalRope): {
    surfA: { x: number; y: number };
    surfB: { x: number; y: number };
  } {
    const entA = this.bodies.get(rope.bodyA);
    const entB = this.bodies.get(rope.bodyB);
    const surfA = entA
      ? this.localPointToWorld(entA.body, rope.anchorA.x, rope.anchorA.y)
      : { x: 0, y: 0 };
    const surfB = entB
      ? this.localPointToWorld(entB.body, rope.anchorB.x, rope.anchorB.y)
      : { x: 0, y: 0 };
    return { surfA, surfB };
  }

  /** Straight chord between anchors — used when history has no rope particle state. */
  resetAllVerletRopes(): void {
    for (const rope of this.ropes.values()) {
      if (!rope.visible) continue;
      const { surfA, surfB } = this.ropeAnchorWorld(rope);
      reinitializeVerletRope(rope.verlet, surfA, surfB);
    }
    this.clearBodyForces();
  }

  /** Re-chord ropes tied to a body (after setup drag / inspector move). */
  reinitializeRopesAttachedTo(bodyId: string): void {
    for (const rope of this.ropes.values()) {
      if (!rope.visible) continue;
      if (rope.bodyA !== bodyId && rope.bodyB !== bodyId) continue;
      const { surfA, surfB } = this.ropeAnchorWorld(rope);
      reinitializeVerletRope(rope.verlet, surfA, surfB);
    }
  }

  /** Restore Verlet particles from a snapshot (timeline keyframes). */
  restoreRopeParticles(ropes: RopeSnapshot[]): void {
    const restored = new Set<string>();
    for (const rs of ropes) {
      const internal = this.ropes.get(rs.id);
      if (!internal?.visible) continue;
      const pts = rs.particles;
      const live = internal.verlet.particles;
      if (pts && pts.length === live.length) {
        for (let i = 0; i < live.length; i++) {
          const p = live[i]!;
          const s = pts[i]!;
          p.x = s.x;
          p.y = s.y;
          p.px = s.x;
          p.py = s.y;
          p.pinned = i === 0 || i === live.length - 1;
        }
        restored.add(rs.id);
      }
    }
    for (const rope of this.ropes.values()) {
      if (!restored.has(rope.id)) {
        const { surfA, surfB } = this.ropeAnchorWorld(rope);
        reinitializeVerletRope(rope.verlet, surfA, surfB);
      }
    }
  }

  reset(width: number, height: number): void {
    Matter.World.clear(this.world, false);
    this.bodies.clear();
    this.springs.clear();
    this.ropes.clear();
    this.invalidateColliderCache();
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
    const plugin = b.plugin as {
      fluxGravityScale?: number;
      fluxRopeId?: string;
      fluxSegIndex?: number;
    } | undefined;
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
      ropeId: plugin?.fluxRopeId,
      ropeSegIndex: plugin?.fluxSegIndex,
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
      anchorA: { ...s.anchorA },
      anchorB: { ...s.anchorB },
    }));
    const ropes: RopeSnapshot[] = [...this.ropes.values()].map((r) => ({
      id: r.id,
      displayName: r.displayName,
      bodyA: r.bodyA,
      bodyB: r.bodyB,
      anchorA: { ...r.anchorA },
      anchorB: { ...r.anchorB },
      segmentCount: r.segmentCount,
      linkStiffness: r.linkStiffness,
      linkDamping: r.linkDamping,
      visible: r.visible,
      particles: r.verlet.particles.map((p) => ({ x: p.x, y: p.y })),
      segmentLength: r.verlet.segmentLength,
    }));
    return { bodies, springs, ropes, tick: this.tick };
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

  /**
   * Restore setup / frame-0 content from a snapshot: removes current ropes, springs, and
   * dynamic bodies, then re-imports. Walls and floor are preserved.
   */
  replaceAuthoringContent(snap: SimulationSnapshot): void {
    for (const id of [...this.ropes.keys()]) this.removeRope(id);
    for (const id of [...this.springs.keys()]) this.removeSpring(id);

    for (const [id, ent] of [...this.bodies.entries()]) {
      if (ent.entityKind === "wall" || ent.entityKind === "floor") continue;
      this.removeBody(id);
    }

    this.invalidateColliderCache();
    this.importScenario(snap);
    this.clearBodyForces();
    this.resetAllVerletRopes();
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
        pointA: s.anchorA ?? { x: 0, y: 0 },
        pointB: s.anchorB ?? { x: 0, y: 0 },
      });
      if (s.visible === false) this.setSpringVisible(s.id, false);
    }

    const ropes = snap.ropes ?? [];
    for (const r of ropes) {
      if (!r.id || !r.bodyA || !r.bodyB) continue;
      if (!this.bodies.has(r.bodyA) || !this.bodies.has(r.bodyB)) continue;
      this.connectRope(r.bodyA, r.bodyB, {
        id: r.id,
        displayName: r.displayName,
        segmentCount: r.segmentCount,
        linkStiffness: r.linkStiffness,
        linkDamping: r.linkDamping,
        pointA: r.anchorA,
        pointB: r.anchorB,
      });
      if (r.visible === false) this.setRopeVisible(r.id, false);
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
    for (const r of this.ropes.values()) ids.push(r.id);
    return ids;
  }
}
