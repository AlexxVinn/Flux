import type Matter from "matter-js";

/**
 * Matter.js collision categories — scene bodies and rope beads share masks so they
 * interact, while {@link ropeSegmentCollisionFilter} uses a per-rope negative group
 * so beads in the same cable do not stack (anchors stay on the scene category).
 */

export const COLLISION_CAT_SCENE = 0x0001;

export const COLLISION_CAT_ROPE = 0x0002;

export const COLLISION_MASK_SCENE_AND_ROPE = COLLISION_CAT_SCENE | COLLISION_CAT_ROPE;

/** Default filter for walls, anchors, spawned shapes, bounds. */
export const SCENE_BODY_COLLISION_FILTER: Matter.ICollisionFilter = {
  category: COLLISION_CAT_SCENE,
  mask: COLLISION_MASK_SCENE_AND_ROPE,
};

/** Rope bead — collides with scene + other ropes; same-rope beads share `group`. */
export function ropeSegmentCollisionFilter(ropeGroup: number): Matter.ICollisionFilter {
  return {
    category: COLLISION_CAT_ROPE,
    mask: COLLISION_MASK_SCENE_AND_ROPE,
    group: ropeGroup,
  };
}
