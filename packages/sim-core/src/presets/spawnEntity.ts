import {
  entityId,
  generateId,
  actionId,
  rigidBodyDefaults,
} from "@flux/shared";
import { ComponentKind } from "@flux/shared";
import type { SimulationOrchestrator } from "../orchestrator/simulationOrchestrator.js";
import type { EntityId } from "@flux/shared";
import type { Vec2 } from "@flux/shared";

export function spawnDynamicBox(
  orchestrator: SimulationOrchestrator,
  position: Vec2,
  size = 48,
  mass = 2,
): EntityId {
  const id = entityId(generateId("ent"));
  orchestrator.enqueueAction({
    type: "createEntity",
    actionId: actionId(generateId("act")),
    entityId: id,
    components: {
      [ComponentKind.Transform]: {
        kind: ComponentKind.Transform,
        position,
        rotation: 0,
      },
      [ComponentKind.RigidBody]: rigidBodyDefaults({ mass, isStatic: false }),
      [ComponentKind.Collider]: {
        kind: ComponentKind.Collider,
        shape: "aabb",
        width: size,
        height: size,
        restitution: 0.3,
        friction: 0.7,
      },
      [ComponentKind.Material]: {
        kind: ComponentKind.Material,
        density: 1000,
        specificHeat: 500,
      },
      [ComponentKind.Thermal]: {
        kind: ComponentKind.Thermal,
        temperature: 293.15,
        thermalMass: mass * 500,
      },
    },
  });
  return id;
}
