import type { ComponentKind, EntityId } from "@flux/shared";
import type { WorldState } from "../world/worldState.js";
import type { PortBus } from "../ports/portBus.js";
import type { DebugContactInfo } from "../physics/contactSolver.js";

export interface StepDebugFrame {
  contacts: DebugContactInfo[];
}

export interface EngineContext {
  world: WorldState;
  dt: number;
  ports: PortBus;
  kinematicIds?: ReadonlySet<EntityId>;
  debug?: StepDebugFrame;
}

export interface SimulationEngine {
  readonly id: string;
  readonly reads: readonly ComponentKind[];
  readonly writes: readonly ComponentKind[];
  step(ctx: EngineContext): void;
}
