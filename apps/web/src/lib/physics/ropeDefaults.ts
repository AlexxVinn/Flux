/**
 * Verlet rope — particle chain with distance constraints (PBD-style).
 * Endpoints are pinned to Matter anchor bodies; interior particles collide with the scene.
 */

/** Target rest length between consecutive particles (world px). */
export const ROPE_PARTICLE_SPACING = 14;

export const ROPE_INTERIOR_MIN = 2;

export const ROPE_INTERIOR_MAX = 40;

/** Collision radius for interior particles (world px). */
export const ROPE_PARTICLE_RADIUS = 5;

/** Verlet substeps per engine step when ropes are active. */
export const ROPE_VERLET_SUBSTEPS = 3;

/** Distance-constraint relaxation iterations per Verlet substep. */
export const ROPE_CONSTRAINT_ITERATIONS = 8;

/** Gravity scale applied to rope particles (matches Matter gravity feel). */
export const ROPE_GRAVITY_SCALE = 1;

/** Velocity damping per substep (0–1, lower = more damping). */
export const ROPE_VERLET_DAMPING = 0.998;

/** Collision separation skin (px). */
export const ROPE_COLLISION_SKIN = 0.5;

/** Extra collision-only passes after constraints (prevents tunneling). */
export const ROPE_COLLISION_ITERATIONS = 4;

/** Swept circle samples per particle per collision pass. */
export const ROPE_COLLISION_SWEEP_SAMPLES_MAX = 8;

/** Force scale from rope tension onto anchor bodies. */
export const ROPE_ANCHOR_FORCE_SCALE = 0.00045;

/** Legacy snapshot fields — not used by Verlet solver. */
export const ROPE_LINK_STIFFNESS = 1;
export const ROPE_LINK_DAMPING = 0.2;
