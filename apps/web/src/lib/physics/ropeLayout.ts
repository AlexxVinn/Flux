import {
  ROPE_INTERIOR_MAX,
  ROPE_INTERIOR_MIN,
  ROPE_PARTICLE_RADIUS,
  ROPE_PARTICLE_SPACING,
} from "./ropeDefaults";

export interface RopeParticleLayout {
  /** Total points including both anchor endpoints. */
  pointCount: number;
  /** Interior particle count (pointCount - 2). */
  interiorCount: number;
  segmentLength: number;
  radius: number;
}

export function computeRopeParticleLayout(
  span: number,
  requestedInterior?: number,
): RopeParticleLayout {
  const s = Math.max(16, span);
  let interior =
    requestedInterior ?? Math.max(ROPE_INTERIOR_MIN, Math.round(s / ROPE_PARTICLE_SPACING));
  interior = Math.max(ROPE_INTERIOR_MIN, Math.min(ROPE_INTERIOR_MAX, interior));
  const pointCount = interior + 2;
  const segmentLength = s / (pointCount - 1);
  const radius = Math.min(ROPE_PARTICLE_RADIUS, segmentLength * 0.38);
  return { pointCount, interiorCount: interior, segmentLength, radius };
}
