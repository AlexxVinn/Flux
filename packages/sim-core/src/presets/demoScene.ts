import { entityId, generateId, rigidBodyDefaults, actionId } from "@flux/shared";
import { ComponentKind } from "@flux/shared";
import type { SimulationOrchestrator } from "../orchestrator/simulationOrchestrator.js";

/** Seeds a minimal MVP scene: floor, dynamic box with thermal properties. */
export function seedDemoScene(orchestrator: SimulationOrchestrator): void {
  const floorId = entityId(generateId("ent"));
  const boxId = entityId(generateId("ent"));

  orchestrator.enqueueAction({
    type: "createEntity",
    actionId: actionId(generateId("act")),
    entityId: floorId,
    components: {
      [ComponentKind.Transform]: {
        kind: ComponentKind.Transform,
        position: { x: 400, y: 520 },
        rotation: 0,
      },
      [ComponentKind.RigidBody]: rigidBodyDefaults({ mass: 0, isStatic: true }),
      [ComponentKind.Collider]: {
        kind: ComponentKind.Collider,
        shape: "aabb",
        width: 800,
        height: 40,
        restitution: 0.2,
        friction: 0.6,
      },
    },
  });

  orchestrator.enqueueAction({
    type: "createEntity",
    actionId: actionId(generateId("act")),
    entityId: boxId,
    components: {
      [ComponentKind.Transform]: {
        kind: ComponentKind.Transform,
        position: { x: 400, y: 120 },
        rotation: 0,
      },
      [ComponentKind.RigidBody]: rigidBodyDefaults({ mass: 2, isStatic: false }),
      [ComponentKind.Collider]: {
        kind: ComponentKind.Collider,
        shape: "aabb",
        width: 48,
        height: 48,
        restitution: 0.35,
        friction: 0.85,
      },
      [ComponentKind.Material]: {
        kind: ComponentKind.Material,
        density: 7800,
        specificHeat: 500,
      },
      [ComponentKind.Thermal]: {
        kind: ComponentKind.Thermal,
        temperature: 293.15,
        thermalMass: 2 * 500,
      },
    },
  });
}
