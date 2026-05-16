import type { EntityId } from "@flux/shared";
import { ComponentKind, type ThermalComponent } from "@flux/shared";
import type { SimulationEngine, EngineContext } from "./types.js";
import { PortKind, type FrictionHeatMessage } from "../ports/portBus.js";
import { getComponent, setComponent } from "../world/worldState.js";

function applyHeat(ctx: EngineContext, entityId: EntityId, energyJoules: number): void {
  const thermal = getComponent(ctx.world, entityId, ComponentKind.Thermal) as
    | ThermalComponent
    | undefined;
  if (!thermal || thermal.thermalMass <= 0) return;
  const deltaT = energyJoules / thermal.thermalMass;
  setComponent(ctx.world, entityId, {
    ...thermal,
    temperature: thermal.temperature + deltaT,
  });
}

/**
 * Thermodynamics: consumes friction heat port messages, updates entity temperatures.
 */
export class ThermalEngine implements SimulationEngine {
  readonly id = "thermal";
  readonly reads = [ComponentKind.Thermal] as const;
  readonly writes = [ComponentKind.Thermal] as const;

  step(ctx: EngineContext): void {
    const messages = ctx.ports.drain(PortKind.FrictionHeat) as FrictionHeatMessage[];

    for (const msg of messages) {
      applyHeat(ctx, msg.entityId as EntityId, msg.energyJoules);
      if (msg.partnerEntityId) {
        applyHeat(ctx, msg.partnerEntityId as EntityId, msg.energyJoules * 0.25);
      }
    }

    const ambient = 293.15;
    const coolingRate = 0.5;
    for (const [entityId, bag] of ctx.world.entities) {
      const thermal = bag[ComponentKind.Thermal] as ThermalComponent | undefined;
      if (!thermal) continue;
      const diff = thermal.temperature - ambient;
      const cooled = thermal.temperature - diff * coolingRate * ctx.dt;
      setComponent(ctx.world, entityId, { ...thermal, temperature: cooled });
    }
  }
}
