import Matter from "matter-js";
import {
  ROPE_ANCHOR_FORCE_SCALE,
  ROPE_COLLISION_ITERATIONS,
  ROPE_COLLISION_SKIN,
  ROPE_COLLISION_SWEEP_SAMPLES_MAX,
  ROPE_CONSTRAINT_ITERATIONS,
  ROPE_PARTICLE_RADIUS,
  ROPE_VERLET_DAMPING,
} from "./ropeDefaults";

export interface VerletParticle {
  x: number;
  y: number;
  px: number;
  py: number;
  pinned: boolean;
}

export interface VerletRope {
  particles: VerletParticle[];
  segmentLength: number;
  radius: number;
}

export interface RopeSimContext {
  gravityX: number;
  gravityY: number;
  colliders: Matter.Body[];
  /** Matter body labels to ignore (anchor bodies of this rope only). */
  excludeLabels: Set<string>;
}

export function createVerletRope(
  anchorA: { x: number; y: number },
  anchorB: { x: number; y: number },
  pointCount: number,
  segmentLength: number,
  radius = ROPE_PARTICLE_RADIUS,
): VerletRope {
  const n = Math.max(3, pointCount);
  const particles: VerletParticle[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const x = anchorA.x + (anchorB.x - anchorA.x) * t;
    const y = anchorA.y + (anchorB.y - anchorA.y) * t;
    particles.push({
      x,
      y,
      px: x,
      py: y,
      pinned: i === 0 || i === n - 1,
    });
  }
  return { particles, segmentLength, radius };
}

/** Reset an existing rope to a straight chord (e.g. after timeline scrub). */
export function reinitializeVerletRope(
  rope: VerletRope,
  anchorA: { x: number; y: number },
  anchorB: { x: number; y: number },
): void {
  const n = rope.particles.length;
  if (n < 2) return;
  const span = Math.hypot(anchorB.x - anchorA.x, anchorB.y - anchorA.y);
  if (span > 1e-3) rope.segmentLength = span / (n - 1);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const x = anchorA.x + (anchorB.x - anchorA.x) * t;
    const y = anchorA.y + (anchorB.y - anchorA.y) * t;
    const p = rope.particles[i]!;
    p.x = x;
    p.y = y;
    p.px = x;
    p.py = y;
    p.pinned = i === 0 || i === n - 1;
  }
}

function pinEndpoint(
  p: VerletParticle,
  wx: number,
  wy: number,
  vx: number,
  vy: number,
  dt: number,
): void {
  p.x = wx;
  p.y = wy;
  p.px = wx - vx * dt;
  p.py = wy - vy * dt;
}

function verletIntegrate(
  particles: VerletParticle[],
  gx: number,
  gy: number,
  dt: number,
  damping: number,
): void {
  const dt2 = dt * dt;
  for (const p of particles) {
    if (p.pinned) continue;
    const vx = (p.x - p.px) * damping;
    const vy = (p.y - p.py) * damping;
    p.px = p.x;
    p.py = p.y;
    p.x += vx + gx * dt2;
    p.y += vy + gy * dt2;
  }
}

/** Single relaxation pass along the chain. */
function satisfyDistanceConstraintsOnce(
  particles: VerletParticle[],
  restLen: number,
): void {
  const n = particles.length;
  if (n < 2) return;

  for (let i = 0; i < n - 1; i++) {
    const a = particles[i]!;
    const b = particles[i + 1]!;
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 1e-8) continue;

    const diff = (dist - restLen) / dist;
    const ox = dx * diff * 0.5;
    const oy = dy * diff * 0.5;

    if (!a.pinned) {
      a.x += ox;
      a.y += oy;
    }
    if (!b.pinned) {
      b.x -= ox;
      b.y -= oy;
    }
    if (a.pinned && b.pinned) continue;
    if (a.pinned && !b.pinned) {
      b.x = a.x + (dx / dist) * restLen;
      b.y = a.y + (dy / dist) * restLen;
    } else if (!a.pinned && b.pinned) {
      a.x = b.x - (dx / dist) * restLen;
      a.y = b.y - (dy / dist) * restLen;
    }
  }
}

let ghostProbe: Matter.Body | null = null;

function getGhostProbe(radius: number): Matter.Body {
  if (!ghostProbe || Math.abs((ghostProbe.circleRadius ?? 0) - radius) > 0.01) {
    ghostProbe = Matter.Bodies.circle(0, 0, radius, { isSensor: true, isStatic: true });
  }
  return ghostProbe;
}

/** World-space separation for a circle at (wx, wy). Probe is bodyA in Query.collides. */
function collisionCorrectionAt(
  wx: number,
  wy: number,
  radius: number,
  probe: Matter.Body,
  ctx: RopeSimContext,
): { x: number; y: number } | null {
  Matter.Body.setPosition(probe, { x: wx, y: wy });
  let cx = 0;
  let cy = 0;
  let hit = false;

  for (const col of Matter.Query.collides(probe, ctx.colliders)) {
    const other = col.bodyA === probe ? col.bodyB : col.bodyA;
    if (!other || other.isSensor) continue;
    const label = other.label ?? "";
    if (ctx.excludeLabels.has(label)) continue;

    const depth = col.depth;
    if (depth <= 1e-6) continue;

    const nx = col.normal.x;
    const ny = col.normal.y;
    const push = depth + ROPE_COLLISION_SKIN;
    cx -= nx * push;
    cy -= ny * push;
    hit = true;
  }

  return hit ? { x: cx, y: cy } : null;
}

function resolveParticleAt(
  p: VerletParticle,
  wx: number,
  wy: number,
  radius: number,
  probe: Matter.Body,
  ctx: RopeSimContext,
): void {
  for (let pass = 0; pass < 3; pass++) {
    const corr = collisionCorrectionAt(wx, wy, radius, probe, ctx);
    if (!corr) break;
    p.x = wx + corr.x;
    p.y = wy + corr.y;
    wx = p.x;
    wy = p.y;
    const len = Math.hypot(corr.x, corr.y);
    if (len > 1e-6) {
      const nx = corr.x / len;
      const ny = corr.y / len;
      const vx = p.x - p.px;
      const vy = p.y - p.py;
      const vn = vx * nx + vy * ny;
      if (vn > 0) {
        p.px = p.x - (vx - vn * nx);
        p.py = p.y - (vy - vn * ny);
      }
    }
  }
}

function resolveSegmentCollisions(
  particles: VerletParticle[],
  radius: number,
  probe: Matter.Body,
  ctx: RopeSimContext,
): void {
  const n = particles.length;
  for (let i = 0; i < n - 1; i++) {
    const a = particles[i]!;
    const b = particles[i + 1]!;
    const ax = a.x;
    const ay = a.y;
    const bx = b.x;
    const by = b.y;
    const segLen = Math.hypot(bx - ax, by - ay);
    if (segLen < 1e-6) continue;

    const steps = Math.min(
      ROPE_COLLISION_SWEEP_SAMPLES_MAX,
      Math.max(2, Math.ceil(segLen / (radius * 0.35))),
    );

    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const wx = ax + (bx - ax) * t;
      const wy = ay + (by - ay) * t;
      const corr = collisionCorrectionAt(wx, wy, radius, probe, ctx);
      if (!corr) continue;

      const wA = a.pinned ? 0 : 1 - t;
      const wB = b.pinned ? 0 : t;
      const wSum = wA + wB;
      if (wSum < 1e-6) continue;

      if (!a.pinned) {
        a.x += (corr.x * wA) / wSum;
        a.y += (corr.y * wA) / wSum;
      }
      if (!b.pinned) {
        b.x += (corr.x * wB) / wSum;
        b.y += (corr.y * wB) / wSum;
      }
    }
  }
}

function resolveParticleCollisions(
  particles: VerletParticle[],
  radius: number,
  ctx: RopeSimContext,
): void {
  if (ctx.colliders.length === 0) return;
  const probe = getGhostProbe(radius);

  for (const p of particles) {
    if (p.pinned) continue;

    const ox = p.px;
    const oy = p.py;
    const endX = p.x;
    const endY = p.y;
    const dx = endX - ox;
    const dy = endY - oy;
    const travel = Math.hypot(dx, dy);
    const steps = Math.min(
      ROPE_COLLISION_SWEEP_SAMPLES_MAX,
      Math.max(1, Math.ceil(travel / (radius * 0.45))),
    );

    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      p.x = ox + dx * t;
      p.y = oy + dy * t;
      resolveParticleAt(p, p.x, p.y, radius, probe, ctx);
    }
    resolveParticleAt(p, endX, endY, radius, probe, ctx);
  }

  resolveSegmentCollisions(particles, radius, probe, ctx);
}

function computeAnchorForces(
  particles: VerletParticle[],
  restLen: number,
): { ax: number; ay: number; bx: number; by: number } {
  const n = particles.length;
  if (n < 2) return { ax: 0, ay: 0, bx: 0, by: 0 };

  const p0 = particles[0]!;
  const p1 = particles[1]!;
  const dxA = p1.x - p0.x;
  const dyA = p1.y - p0.y;
  const distA = Math.hypot(dxA, dyA);
  let fax = 0;
  let fay = 0;
  if (distA > 1e-6 && distA > restLen) {
    const s = ((distA - restLen) / distA) * ROPE_ANCHOR_FORCE_SCALE;
    fax = dxA * s;
    fay = dyA * s;
  }

  const pN = particles[n - 1]!;
  const pNm1 = particles[n - 2]!;
  const dxB = pNm1.x - pN.x;
  const dyB = pNm1.y - pN.y;
  const distB = Math.hypot(dxB, dyB);
  let fbx = 0;
  let fby = 0;
  if (distB > 1e-6 && distB > restLen) {
    const s = ((distB - restLen) / distB) * ROPE_ANCHOR_FORCE_SCALE;
    fbx = dxB * s;
    fby = dyB * s;
  }

  return { ax: fax, ay: fay, bx: fbx, by: fby };
}

/** One Verlet substep for a single rope. */
export function stepVerletRope(
  rope: VerletRope,
  anchorA: { x: number; y: number },
  anchorB: { x: number; y: number },
  velA: { x: number; y: number },
  velB: { x: number; y: number },
  ctx: RopeSimContext,
  dt: number,
  constraintIters = ROPE_CONSTRAINT_ITERATIONS,
): { forceA: { x: number; y: number }; forceB: { x: number; y: number } } {
  const pts = rope.particles;
  const n = pts.length;
  if (n < 2) return { forceA: { x: 0, y: 0 }, forceB: { x: 0, y: 0 } };

  pinEndpoint(pts[0]!, anchorA.x, anchorA.y, velA.x, velA.y, dt);
  pinEndpoint(pts[n - 1]!, anchorB.x, anchorB.y, velB.x, velB.y, dt);

  verletIntegrate(pts, ctx.gravityX, ctx.gravityY, dt, ROPE_VERLET_DAMPING);

  const collisionIters = ROPE_COLLISION_ITERATIONS;
  for (let i = 0; i < constraintIters; i++) {
    satisfyDistanceConstraintsOnce(pts, rope.segmentLength);
    if (i % Math.max(1, Math.floor(constraintIters / collisionIters)) === 0) {
      resolveParticleCollisions(pts, rope.radius, ctx);
    }
  }
  for (let c = 0; c < collisionIters; c++) {
    resolveParticleCollisions(pts, rope.radius, ctx);
    satisfyDistanceConstraintsOnce(pts, rope.segmentLength);
  }

  pinEndpoint(pts[0]!, anchorA.x, anchorA.y, velA.x, velA.y, dt);
  pinEndpoint(pts[n - 1]!, anchorB.x, anchorB.y, velB.x, velB.y, dt);

  const f = computeAnchorForces(pts, rope.segmentLength);
  return {
    forceA: { x: f.ax, y: f.ay },
    forceB: { x: f.bx, y: f.by },
  };
}

export function verletRopeWorldPoints(rope: VerletRope): { x: number; y: number }[] {
  return rope.particles.map((p) => ({ x: p.x, y: p.y }));
}
