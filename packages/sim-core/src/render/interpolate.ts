import type { EntityId } from "@flux/shared";
import { ComponentKind, type TransformComponent } from "@flux/shared";
import type { WorldState } from "../world/worldState.js";
import { cloneWorldState } from "../world/worldState.js";

/**
 * Render-only blend between previous and current authoritative states.
 * Simulation never reads this output.
 */
export function interpolateWorldState(
  previous: WorldState,
  current: WorldState,
  alpha: number,
): WorldState {
  const out = cloneWorldState(current);

  for (const [entityId, bag] of out.entities) {
    const prevBag = previous.entities.get(entityId);
    const curTransform = bag[ComponentKind.Transform] as TransformComponent | undefined;
    const prevTransform = prevBag?.[ComponentKind.Transform] as TransformComponent | undefined;
    if (!curTransform || !prevTransform) continue;

    bag[ComponentKind.Transform] = {
      ...curTransform,
      position: {
        x: prevTransform.position.x + (curTransform.position.x - prevTransform.position.x) * alpha,
        y: prevTransform.position.y + (curTransform.position.y - prevTransform.position.y) * alpha,
      },
      rotation:
        prevTransform.rotation +
        (curTransform.rotation - prevTransform.rotation) * alpha,
    };
  }

  return out;
}
