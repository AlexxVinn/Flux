/**
 * Rope links use stiff constraints (high stiffness, moderate damping) — they sag under
 * gravity like cable, unlike low-stiffness springs.
 */

export const ROPE_SEGMENT_RADIUS = 9;

/** Target arc length per link in world px (more spacing → fewer links). */
export const ROPE_SPACING_TARGET = 68;

export const ROPE_SEGMENTS_MIN = 4;

export const ROPE_SEGMENTS_MAX = 16;

/** Stiff link — nearly fixed length, still settles under load. */
export const ROPE_LINK_STIFFNESS = 0.94;

export const ROPE_LINK_DAMPING = 0.07;

export const ROPE_SEGMENT_DENSITY = 0.0012;

export const ROPE_SEGMENT_FRICTION = 0.35;

export const ROPE_SEGMENT_RESTITUTION = 0.08;
