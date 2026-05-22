/** Debug overlay toggles — isolated from simulation state. */
export interface DebugFlags {
  grid: boolean;
  velocityVectors: boolean;
  forceVectors: boolean;
  appliedForces: boolean;
  gravityVectors: boolean;
  collisionContacts: boolean;
  collisionNormals: boolean;
  centerOfMass: boolean;
  aabbBounds: boolean;
  sleepingBodies: boolean;
  springElasticAmbient: boolean;
  springTension: boolean;
  springLinks: boolean;
  /** Text badges on arrows (e.g. G 3 N) and spring midpoint readouts. */
  forceLabels: boolean;
}

export const DEFAULT_DEBUG_FLAGS: DebugFlags = {
  grid: true,
  velocityVectors: true,
  forceVectors: true,
  appliedForces: true,
  gravityVectors: true,
  collisionContacts: false,
  collisionNormals: false,
  centerOfMass: false,
  aabbBounds: false,
  sleepingBodies: false,
  springElasticAmbient: false,
  springTension: false,
  springLinks: true,
  forceLabels: true,
};
