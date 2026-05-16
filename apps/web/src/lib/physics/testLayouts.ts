import type { SimBodySnapshot, SimulationSnapshot, SpringSnapshot } from "./types";
import {
  DEFAULT_SPRING_DAMPING,
  DEFAULT_SPRING_STIFFNESS,
  LINK_SPRING_DAMPING,
  LINK_SPRING_STIFFNESS,
} from "./springDefaults";

export type TestLayoutId =
  | "newton-cradle"
  | "chaos-pendulum"
  | "domino-wave"
  | "bouncy-tower"
  | "spring-trampoline"
  | "collision-gauntlet"
  | "zero-g-swarm"
  | "inclined-plane"
  | "atwood-twin"
  | "ballistics-gallery";

export interface TestLayout {
  id: TestLayoutId;
  title: string;
  description: string;
  tests: string;
  accent: string;
  build: (width: number, height: number) => SimulationSnapshot;
}

const BODY_DEFAULT: Omit<
  SimBodySnapshot,
  "id" | "displayName" | "label" | "shape" | "entityKind" | "x" | "y" | "width" | "height"
> = {
  angle: 0,
  velocityX: 0,
  velocityY: 0,
  angularVelocity: 0,
  mass: 1,
  density: 0.002,
  restitution: 0.35,
  friction: 0.42,
  frictionStatic: 0.48,
  frictionAir: 0.012,
  sleepThreshold: 60,
  isStatic: false,
  visible: true,
  gravityScale: 1,
  isSleeping: false,
};

function circle(
  id: string,
  name: string,
  x: number,
  y: number,
  radius: number,
  patch: Partial<SimBodySnapshot> = {},
): SimBodySnapshot {
  const d = radius * 2;
  return {
    ...BODY_DEFAULT,
    id,
    displayName: name,
    label: name,
    shape: "circle",
    entityKind: "circle",
    x,
    y,
    width: d,
    height: d,
    ...patch,
  };
}

function box(
  id: string,
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
  patch: Partial<SimBodySnapshot> = {},
): SimBodySnapshot {
  return {
    ...BODY_DEFAULT,
    id,
    displayName: name,
    label: name,
    shape: "rectangle",
    entityKind: patch.entityKind ?? "rectangle",
    x,
    y,
    width: w,
    height: h,
    ...patch,
  };
}

function spring(
  id: string,
  bodyA: string,
  bodyB: string,
  stiffness: number,
  damping: number,
  length = 0,
): SpringSnapshot {
  return {
    id,
    displayName: `Spring-${id.split("_").pop() ?? id}`,
    bodyA,
    bodyB,
    stiffness,
    damping,
    length,
    visible: true,
  };
}

/* -------------------------------------------------------------------------- */
/* Hostile / bench scenes                                                     */
/* -------------------------------------------------------------------------- */

export function buildNewtonCradle(w: number, h: number): SimulationSnapshot {
  const cy = h * 0.36;
  const anchorY = h * 0.14;
  const spacing = Math.min(50, w * 0.045);
  const startX = w * 0.5 - spacing * 2;
  const bodies: SimBodySnapshot[] = [];
  const springs: SpringSnapshot[] = [];
  const n = 5;

  for (let i = 0; i < n; i++) {
    const x = startX + i * spacing;
    const anchorId = `nc_anchor_${i}`;
    const ballId = `nc_ball_${i}`;
    bodies.push(
      circle(anchorId, `Anchor-${i + 1}`, x, anchorY, 4, {
        isStatic: true,
        friction: 0.95,
        restitution: 0,
      }),
    );
    bodies.push(
      circle(ballId, `Sphere-${i + 1}`, x, cy, 19, {
        restitution: 0.97,
        friction: 0.015,
        mass: 2.4,
      }),
    );
    springs.push(
      spring(`nc_s_${i}`, anchorId, ballId, DEFAULT_SPRING_STIFFNESS * 1.05, DEFAULT_SPRING_DAMPING),
    );
  }

  const lead = bodies.find((b) => b.id === "nc_ball_0");
  if (lead) {
    lead.x -= 42;
    lead.velocityX = -10;
    lead.velocityY = -1.2;
  }

  return { bodies, springs, tick: 0 };
}

export function buildChaosPendulum(w: number, h: number): SimulationSnapshot {
  const cx = w * 0.48;
  const y0 = h * 0.12;
  const bodies: SimBodySnapshot[] = [
    circle("cp_pivot", "Pivot", cx, y0, 9, { isStatic: true, friction: 0.9 }),
    box("cp_link1", "Rod-1", cx, h * 0.28, 12, 68, {
      mass: 1.1,
      frictionAir: 0.004,
      restitution: 0.08,
    }),
    box("cp_link2", "Rod-2", cx + 6, h * 0.44, 15, 80, {
      mass: 1.9,
      frictionAir: 0.003,
      restitution: 0.06,
    }),
    box("cp_link3", "Rod-3", cx - 8, h * 0.62, 17, 56, {
      mass: 2.2,
      frictionAir: 0.002,
      angularVelocity: 0.55,
      velocityX: 3.2,
    }),
  ];
  return {
    bodies,
    springs: [
      spring("cp_s0", "cp_pivot", "cp_link1", LINK_SPRING_STIFFNESS * 1.1, LINK_SPRING_DAMPING),
      spring("cp_s1", "cp_link1", "cp_link2", DEFAULT_SPRING_STIFFNESS * 1.2, DEFAULT_SPRING_DAMPING),
      spring("cp_s2", "cp_link2", "cp_link3", DEFAULT_SPRING_STIFFNESS * 1.15, DEFAULT_SPRING_DAMPING),
    ],
    tick: 0,
  };
}

export function buildDominoWave(w: number, h: number): SimulationSnapshot {
  const floorY = h - 88;
  const bodies: SimBodySnapshot[] = [
    circle("dm_striker", "Striker", w * 0.1, floorY - 140, 22, {
      restitution: 0.22,
      velocityX: 11,
      velocityY: 2,
      mass: 3.2,
      friction: 0.25,
    }),
  ];
  const count = Math.min(18, Math.floor((w * 0.62) / 34));
  const arcCx = w * 0.38;
  const arcR = Math.min(420, w * 0.2);
  for (let i = 0; i < count; i++) {
    const t = (i / Math.max(1, count - 1)) * 1.05;
    const ang = -0.55 + t * 1.1;
    const x = arcCx + Math.cos(ang + Math.PI * 0.08) * arcR * 0.85;
    const y = floorY - 26 - Math.sin(ang + Math.PI * 0.08) * arcR * 0.22;
    bodies.push(
      box(`dm_${i}`, `Domino-${i + 1}`, x, y, 11, 50, {
        angle: ang * 0.95 + 0.08,
        friction: 0.38,
        restitution: 0.04,
        mass: 0.62,
      }),
    );
  }
  return { bodies, springs: [], tick: 0 };
}

export function buildBouncyTower(w: number, h: number): SimulationSnapshot {
  const baseX = w * 0.55;
  const baseY = h - 110;
  const bodies: SimBodySnapshot[] = [];
  const rows = 6;
  for (let r = 0; r < rows; r++) {
    const inRow = rows - r;
    const bw = 46 - r * 3;
    const bh = 42 - r * 2;
    for (let c = 0; c < inRow; c++) {
      const ox = (c - (inRow - 1) / 2) * (bw * 0.92);
      const y = baseY - r * (bh * 0.55) - bh / 2;
      bodies.push(
        box(`bt_${r}_${c}`, `Cell-${r}-${c}`, baseX + ox, y, bw, bh, {
          restitution: 0.82 + (r % 3) * 0.03,
          friction: 0.22,
          mass: 0.55 + r * 0.07,
        }),
      );
    }
  }
  bodies.push(
    circle("bt_drop", "Drop-sphere", baseX + w * 0.12, h * 0.16, 24, {
      restitution: 0.78,
      mass: 2.6,
      friction: 0.18,
    }),
  );
  return { bodies, springs: [], tick: 0 };
}

export function buildSpringTrampoline(w: number, h: number): SimulationSnapshot {
  const cx = w * 0.5;
  const cy = h * 0.58;
  const pw = Math.min(190, w * 0.3);
  const spread = pw * 0.52;
  const anchorY = h * 0.26;
  const lowY = cy + 62;
  return {
    bodies: [
      box("st_a1", "Tie-TL", cx - spread, anchorY, 11, 11, { isStatic: true }),
      box("st_a2", "Tie-TR", cx + spread, anchorY, 11, 11, { isStatic: true }),
      box("st_a3", "Tie-BL", cx - spread, lowY, 11, 11, { isStatic: true }),
      box("st_a4", "Tie-BR", cx + spread, lowY, 11, 11, { isStatic: true }),
      box("st_deck", "Deck", cx, cy, pw, 20, { mass: 3.2, restitution: 0.52, friction: 0.42 }),
      circle("st_jump", "Actor", cx, h * 0.15, 21, { mass: 2.1, restitution: 0.68 }),
    ],
    springs: [
      spring("st_s1", "st_a1", "st_deck", 0.11, 0.048),
      spring("st_s2", "st_a2", "st_deck", 0.11, 0.048),
      spring("st_s3", "st_a3", "st_deck", 0.09, 0.055),
      spring("st_s4", "st_a4", "st_deck", 0.09, 0.055),
    ],
    tick: 0,
  };
}

export function buildCollisionGauntlet(w: number, h: number): SimulationSnapshot {
  const bodies: SimBodySnapshot[] = [
    circle("cg_pivot", "Mount", w * 0.2, h * 0.18, 11, { isStatic: true }),
    circle("cg_weight", "Pendulum", w * 0.2, h * 0.52, 30, { mass: 7.5, restitution: 0.12, friction: 0.2 }),
  ];
  const originX = w * 0.58;
  const originY = h - 120;
  for (let row = 0; row < 7; row++) {
    const wrow = 7 - Math.floor(row / 2);
    for (let col = 0; col < wrow; col++) {
      bodies.push(
        box(`cg_b_${row}_${col}`, `Brick-${row}-${col}`, originX + col * 38, originY - row * 36, 34, 32, {
          restitution: 0.18,
          mass: 0.95,
          friction: 0.45,
        }),
      );
    }
  }
  return {
    bodies,
    springs: [spring("cg_rod", "cg_pivot", "cg_weight", LINK_SPRING_STIFFNESS * 1.05, LINK_SPRING_DAMPING)],
    tick: 0,
  };
}

export function buildZeroGSwarm(w: number, h: number): SimulationSnapshot {
  const bodies: SimBodySnapshot[] = [];
  const cx = w * 0.5;
  const cy = h * 0.48;
  const rings = 3;
  let idx = 0;
  for (let r = 0; r < rings; r++) {
    const rad = 140 + r * 110;
    const count = 5 + r * 2;
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2 + r * 0.4;
      const px = cx + Math.cos(ang) * rad;
      const py = cy + Math.sin(ang) * rad * 0.72;
      const tang = ang + Math.PI / 2;
      const spd = 1.8 + r * 0.9 + (i % 3) * 0.35;
      bodies.push(
        circle(`zg_${idx}`, `Orb-${idx + 1}`, px, py, 13 + (idx % 4) * 3, {
          gravityScale: 0,
          frictionAir: 0,
          restitution: 0.93,
          velocityX: Math.cos(tang) * spd,
          velocityY: Math.sin(tang) * spd,
          mass: 0.75 + (idx % 5) * 0.15,
        }),
      );
      idx += 1;
    }
  }
  return { bodies, springs: [], tick: 0 };
}

export function buildInclinedPlane(w: number, h: number): SimulationSnapshot {
  const rampLong = w * 0.5;
  const rampH = 20;
  const rampX = w * 0.44;
  const rampY = h * 0.55;
  return {
    bodies: [
      box("ip_ramp1", "Ramp-A", rampX - rampLong * 0.12, rampY, rampLong, rampH, {
        isStatic: true,
        angle: -0.38,
        friction: 0.32,
        restitution: 0.08,
      }),
      box("ip_ramp2", "Ramp-B", rampX + rampLong * 0.48, rampY + 180, rampLong * 0.78, rampH, {
        isStatic: true,
        angle: 0.3,
        friction: 0.28,
        restitution: 0.1,
      }),
      circle("ip_m1", "Marker-1", rampX - rampLong * 0.35, h * 0.2, 16, { restitution: 0.42, friction: 0.2 }),
      circle("ip_m2", "Marker-2", rampX - rampLong * 0.22, h * 0.17, 19, { restitution: 0.4, mass: 1.8 }),
      circle("ip_m3", "Marker-3", rampX - rampLong * 0.08, h * 0.22, 14, { restitution: 0.46 }),
    ],
    springs: [],
    tick: 0,
  };
}

/** Unequal hanging masses linked through a stiff vertical “string” segment — textbook Atwood flavor. */
export function buildAtwoodTwin(w: number, h: number): SimulationSnapshot {
  const cx = w * 0.5;
  const yPulley = h * 0.2;
  const xL = cx - 120;
  const xR = cx + 120;
  return {
    bodies: [
      circle("aw_pulley", "Sheave", cx, yPulley, 14, { isStatic: true, friction: 0.85 }),
      box("aw_heavy", "Mass-A", xL, yPulley + 280, 48, 48, { mass: 4.2, friction: 0.35, restitution: 0.05 }),
      box("aw_light", "Mass-B", xR, yPulley + 220, 38, 38, { mass: 1.4, friction: 0.35, restitution: 0.05 }),
    ],
    springs: [
      spring("aw_sL", "aw_pulley", "aw_heavy", LINK_SPRING_STIFFNESS * 1.25, LINK_SPRING_DAMPING),
      spring("aw_sR", "aw_pulley", "aw_light", LINK_SPRING_STIFFNESS * 1.25, LINK_SPRING_DAMPING),
    ],
    tick: 0,
  };
}

/** Angled channel launches a dense striker into a masonry gallery. */
export function buildBallisticsGallery(w: number, h: number): SimulationSnapshot {
  const bodies: SimBodySnapshot[] = [
    box("bg_barrel", "Barrel", w * 0.16, h * 0.48, 160, 22, {
      isStatic: true,
      angle: -0.22,
      friction: 0.35,
    }),
    circle("bg_slug", "Slug", w * 0.1, h * 0.42, 17, {
      mass: 3.8,
      restitution: 0.12,
      friction: 0.22,
      velocityX: 26,
      velocityY: -1.5,
    }),
  ];
  const ox = w * 0.46;
  const oy = h - 130;
  for (let row = 0; row < 5; row++) {
    const n = 8 - row;
    for (let i = 0; i < n; i++) {
      bodies.push(
        box(`bg_t_${row}_${i}`, `Tile-${row}-${i}`, ox + i * 42 + row * 12, oy - row * 38, 36, 34, {
          mass: 0.65,
          restitution: 0.2,
          friction: 0.5,
        }),
      );
    }
  }
  return { bodies, springs: [], tick: 0 };
}

/* -------------------------------------------------------------------------- */
/* Catalog starter labs (pedagogical, lighter than benches)                  */
/* -------------------------------------------------------------------------- */

/** Mixed primitives: platform, pair of circles, one horizontal spring link. */
export function buildCatalogStarterMixed(w: number, h: number): SimulationSnapshot {
  const y = h - 200;
  return {
    bodies: [
      box("cat_plank", "Platform", w * 0.5, y, w * 0.36, 28, { isStatic: true, friction: 0.55 }),
      circle("cat_a", "Body-A", w * 0.42, y - 120, 22, { mass: 1.2, restitution: 0.45 }),
      circle("cat_b", "Body-B", w * 0.56, y - 190, 18, { mass: 0.75, restitution: 0.55 }),
      box("cat_anchor", "Anchor", w * 0.3, y - 260, 14, 14, { isStatic: true }),
    ],
    springs: [spring("cat_s1", "cat_anchor", "cat_a", DEFAULT_SPRING_STIFFNESS * 1.4, DEFAULT_SPRING_DAMPING)],
    tick: 0,
  };
}

export function buildCatalogFreeFall(w: number, h: number): SimulationSnapshot {
  const y = h - 160;
  return {
    bodies: [
      box("cf_ledge", "Ledge", w * 0.5, y, w * 0.4, 24, { isStatic: true }),
      circle("cf_heavy", "Heavy", w * 0.46, y - 220, 26, { mass: 3.5, restitution: 0.12 }),
      circle("cf_light", "Light", w * 0.54, y - 220, 20, { mass: 0.9, restitution: 0.15 }),
    ],
    springs: [],
    tick: 0,
  };
}

export function buildCatalogCollisionIntro(w: number, h: number): SimulationSnapshot {
  const floor = h - 96;
  return {
    bodies: [
      circle("ci_mover", "Glider", w * 0.22, floor - 80, 20, { velocityX: 14, mass: 1.8, restitution: 0.75 }),
      box("ci_target", "Target", w * 0.62, floor - 40, 80, 44, { mass: 1.2, restitution: 0.85, friction: 0.25 }),
      box("ci_wall", "Backstop", w * 0.78, floor - 120, 28, 160, {
        isStatic: true,
        restitution: 0.35,
      }),
    ],
    springs: [],
    tick: 0,
  };
}

export function buildCatalogSpringIntro(w: number, h: number): SimulationSnapshot {
  const cy = h * 0.42;
  return {
    bodies: [
      box("cs_post", "Post", w * 0.34, cy, 16, 120, { isStatic: true }),
      circle("cs_wt", "Weight", w * 0.58, cy + 40, 24, { mass: 2.4 }),
    ],
    springs: [spring("cs_main", "cs_post", "cs_wt", DEFAULT_SPRING_STIFFNESS * 1.1, DEFAULT_SPRING_DAMPING * 0.85)],
    tick: 0,
  };
}

/* -------------------------------------------------------------------------- */

const ACCENT = "#9aa8bc";

export const TEST_LAYOUTS: TestLayout[] = [
  {
    id: "newton-cradle",
    title: "Newton cradle",
    description:
      "Five tuned pendulums—impulse travels through contact; play with restitution and spacing.",
    tests: "Elastic collisions · impulse chains",
    accent: ACCENT,
    build: buildNewtonCradle,
  },
  {
    id: "chaos-pendulum",
    title: "Triple compound pendulum",
    description: "Three coupled rods with stiff links—trajectories explode from tiny nudges.",
    tests: "Sensitivity · rotation joints",
    accent: ACCENT,
    build: buildChaosPendulum,
  },
  {
    id: "domino-wave",
    title: "Curtain domino run",
    description: "A striker lifts into an arcing line of leaning tiles—timing and friction rule the wave.",
    tests: "Topple chains · curved layout",
    accent: ACCENT,
    build: buildDominoWave,
  },
  {
    id: "bouncy-tower",
    title: "Pyramid crush test",
    description: "Soft pyramid of cells and a free sphere—watch energy bleed through bouncy stacks.",
    tests: "Stacking · multi-body impact",
    accent: ACCENT,
    build: buildBouncyTower,
  },
  {
    id: "spring-trampoline",
    title: "Four-point suspension deck",
    description: "Corner ties let the platform breathe; dial gravity off/on to see weight transfer.",
    tests: "Parallel springs · damping",
    accent: ACCENT,
    build: buildSpringTrampoline,
  },
  {
    id: "collision-gauntlet",
    title: "Brick gallery & pendulum",
    description: "Heavy bob on a short constraint sweeps through staggered masonry.",
    tests: "Large KE · sequential impacts",
    accent: ACCENT,
    build: buildCollisionGauntlet,
  },
  {
    id: "zero-g-swarm",
    title: "Vortex swarm",
    description: "Three rings of neutral-buoyancy orbs on tangential velocity—pure collision ballet.",
    tests: "gravityScale · conservation feel",
    accent: ACCENT,
    build: buildZeroGSwarm,
  },
  {
    id: "inclined-plane",
    title: "Dual ramp race",
    description: "Two static ramps, three markers—compare paths as they pick up roll and slide.",
    tests: "Static geometry · friction",
    accent: ACCENT,
    build: buildInclinedPlane,
  },
  {
    id: "atwood-twin",
    title: "Paired hoist",
    description: "Two masses hang from a central sheave through stiff links—classic unequal acceleration read.",
    tests: "Constraints · net force",
    accent: ACCENT,
    build: buildAtwoodTwin,
  },
  {
    id: "ballistics-gallery",
    title: "Ballistics lane",
    description: "Barrel aim baked in; slug launches into stepped targets—good for momentum intuition.",
    tests: "High-speed impact · debris",
    accent: ACCENT,
    build: buildBallisticsGallery,
  },
];

const LAYOUT_BY_ID = new Map(TEST_LAYOUTS.map((l) => [l.id, l]));

export function getTestLayout(id: string): TestLayout | undefined {
  return LAYOUT_BY_ID.get(id as TestLayoutId);
}

/** Query param on workspace URLs — survives React Strict Mode remounts (unlike sessionStorage). */
export const BENCH_QUERY_PARAM = "bench";

export const PENDING_JOIN_CODE_KEY = "flux_pending_join_code";
export const PENDING_JOIN_ANONYMOUS_KEY = "flux_pending_join_anonymous";

export function buildWorkspacePath(
  module: string,
  slug: string,
  benchId?: TestLayoutId | null,
): string {
  const base = `/workspace/${module}/${slug}`;
  if (!benchId) return base;
  return `${base}?${BENCH_QUERY_PARAM}=${encodeURIComponent(benchId)}`;
}

export function readBenchFromSearch(search: string): TestLayoutId | null {
  const id = new URLSearchParams(search).get(BENCH_QUERY_PARAM);
  if (!id || !LAYOUT_BY_ID.has(id as TestLayoutId)) return null;
  return id as TestLayoutId;
}

/** Survives navigation + persist rehydration so the workspace can re-join the room. */
export function stashPendingRoomJoin(
  membership: { joinCode: string },
  anonymous: boolean,
): void {
  sessionStorage.setItem(PENDING_JOIN_CODE_KEY, membership.joinCode);
  if (anonymous) {
    sessionStorage.setItem(PENDING_JOIN_ANONYMOUS_KEY, "1");
  } else {
    sessionStorage.removeItem(PENDING_JOIN_ANONYMOUS_KEY);
  }
}

export function clearPendingRoomJoin(): void {
  sessionStorage.removeItem(PENDING_JOIN_CODE_KEY);
  sessionStorage.removeItem(PENDING_JOIN_ANONYMOUS_KEY);
}
