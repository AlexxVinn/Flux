import type { SimulationSnapshot } from "./types";
import { COLLISION_FRAME_WALL_THICKNESS } from "./physicsConstants";

/** Fixed authoring space: physics + persisted scene coords live in this rectangle (pixels / world units). */

export const FLUX_WORLD = {
  WIDTH: 3000,
  HEIGHT: 2000,
} as const;

export const FLUX_WORLD_CENTER = {
  x: FLUX_WORLD.WIDTH / 2,
  y: FLUX_WORLD.HEIGHT / 2,
} as const;

export type SceneCamera = {
  /** World point that maps to the viewport center (px). */
  centerX: number;
  centerY: number;
  /** Screen pixels per world unit (zoom in = larger value). */
  zoom: number;
};

/** ~1200 world units across the shorter viewport axis; centered on world center. */
export function initialCameraForViewport(viewportWidth: number, viewportHeight: number): SceneCamera {
  const targetWorld = 1200;
  const zoom = Math.min(viewportWidth, viewportHeight) / targetWorld;
  return {
    centerX: FLUX_WORLD_CENTER.x,
    centerY: FLUX_WORLD_CENTER.y,
    zoom,
  };
}

/** Fit camera to visible authoring bodies (excludes floor/wall); falls back to world center. */
export function cameraFittingAuthoringBodies(
  bodies: SimulationSnapshot["bodies"],
  viewportWidth: number,
  viewportHeight: number,
): SceneCamera {
  const focus = bodies.filter(
    (b) =>
      b.visible !== false &&
      b.entityKind !== "wall" &&
      b.entityKind !== "floor",
  );
  if (focus.length === 0) {
    return initialCameraForViewport(viewportWidth, viewportHeight);
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of focus) {
    const rim =
      b.entityKind === "collisionBounds" ? COLLISION_FRAME_WALL_THICKNESS : 0;
    const hw = b.width / 2 + rim;
    const hh = b.height / 2 + rim;
    minX = Math.min(minX, b.x - hw);
    maxX = Math.max(maxX, b.x + hw);
    minY = Math.min(minY, b.y - hh);
    maxY = Math.max(maxY, b.y + hh);
  }

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const bw = Math.max(maxX - minX, 140);
  const bh = Math.max(maxY - minY, 140);
  const pad = 1.2;
  const zoom = Math.min(viewportWidth / (bw * pad), viewportHeight / (bh * pad));

  const margin = 400;
  return {
    centerX: Math.min(FLUX_WORLD.WIDTH - margin, Math.max(margin, cx)),
    centerY: Math.min(FLUX_WORLD.HEIGHT - margin, Math.max(margin, cy)),
    zoom: clampCameraZoom(zoom),
  };
}

export function clampCameraZoom(zoom: number): number {
  return Math.min(8, Math.max(0.012, zoom));
}

export function screenToWorld(
  screenX: number,
  screenY: number,
  viewportWidth: number,
  viewportHeight: number,
  camera: SceneCamera,
): { x: number; y: number } {
  return {
    x: camera.centerX + (screenX - viewportWidth / 2) / camera.zoom,
    y: camera.centerY + (screenY - viewportHeight / 2) / camera.zoom,
  };
}

export function worldToScreen(
  worldX: number,
  worldY: number,
  viewportWidth: number,
  viewportHeight: number,
  camera: SceneCamera,
): { x: number; y: number } {
  return {
    x: viewportWidth / 2 + (worldX - camera.centerX) * camera.zoom,
    y: viewportHeight / 2 + (worldY - camera.centerY) * camera.zoom,
  };
}

/** Zoom toward a screen-space point; keeps that world location under the cursor. */
export function zoomCameraAtScreen(
  camera: SceneCamera,
  viewportWidth: number,
  viewportHeight: number,
  screenX: number,
  screenY: number,
  factor: number,
): SceneCamera {
  const z0 = camera.zoom;
  const z1 = clampCameraZoom(z0 * factor);
  if (z1 === z0) return camera;
  const wx = camera.centerX + (screenX - viewportWidth / 2) / z0;
  const wy = camera.centerY + (screenY - viewportHeight / 2) / z0;
  return {
    centerX: wx - (screenX - viewportWidth / 2) / z1,
    centerY: wy - (screenY - viewportHeight / 2) / z1,
    zoom: z1,
  };
}
