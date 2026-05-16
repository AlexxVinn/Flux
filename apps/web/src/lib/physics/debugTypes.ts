/** Debug overlay toggles — isolated from simulation state. */
export interface DebugFlags {
  grid: boolean;
  velocityVectors: boolean;
  forceVectors: boolean;
  gravityVectors: boolean;
  collisionContacts: boolean;
  collisionNormals: boolean;
  centerOfMass: boolean;
  aabbBounds: boolean;
  sleepingBodies: boolean;
  springTension: boolean;
  springLinks: boolean;
}

export const DEFAULT_DEBUG_FLAGS: DebugFlags = {
  grid: true,
  velocityVectors: true,
  forceVectors: false,
  gravityVectors: true,
  collisionContacts: false,
  collisionNormals: false,
  centerOfMass: false,
  aabbBounds: false,
  sleepingBodies: false,
  springTension: true,
  springLinks: true,
};
