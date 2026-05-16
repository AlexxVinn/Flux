import type { ClientAction, EntityId } from "@flux/shared";
import type { StateDelta } from "@flux/shared";
import type { Vec2 } from "@flux/shared";
import type { WorldState } from "../world/worldState.js";
import {
  createWorldState,
  cloneWorldState,
  setComponent,
  getComponent,
} from "../world/worldState.js";
import { ComponentKind } from "@flux/shared";
import type { TransformComponent, RigidBodyComponent } from "@flux/shared";
import { applyClientAction } from "../world/actionApplier.js";
import { validateClientAction } from "../world/actionValidator.js";
import type { SimulationEngine } from "../engines/types.js";
import type { StepDebugFrame } from "../engines/types.js";
import { MechanicsEngine } from "../engines/mechanicsEngine.js";
import { ThermalEngine } from "../engines/thermalEngine.js";
import { PortBus } from "../ports/portBus.js";
import { SnapshotStore } from "../timeline/snapshotStore.js";
import { computeStateDelta } from "../network/stateDelta.js";
import {
  FIXED_DT,
  createAccumulator,
  advanceAccumulator,
  interpolationAlpha,
} from "../simulation/fixedTimestep.js";
import { interpolateWorldState } from "../render/interpolate.js";

export interface OrchestratorConfig {
  fixedTimestep?: number;
  engines?: SimulationEngine[];
}

export interface StepResult {
  delta: StateDelta;
}

/**
 * Central simulation coordinator: actions → engines → snapshots → deltas.
 */
export class SimulationOrchestrator {
  readonly world: WorldState;
  readonly snapshots: SnapshotStore;

  private engines: SimulationEngine[];
  private ports = new PortBus();
  private fixedDt: number;
  private accumulator = createAccumulator();
  private previousState: WorldState;
  private lastBroadcastState: WorldState;
  private kinematicPositions = new Map<EntityId, Vec2>();
  private lastDebugFrame: StepDebugFrame = { contacts: [] };

  constructor(config?: Partial<OrchestratorConfig>) {
    this.fixedDt = config?.fixedTimestep ?? FIXED_DT;
    this.world = createWorldState();
    this.previousState = cloneWorldState(this.world);
    this.lastBroadcastState = cloneWorldState(this.world);
    this.snapshots = new SnapshotStore();
    this.engines = config?.engines ?? [new MechanicsEngine(), new ThermalEngine()];
    this.snapshots.append(this.world);
  }

  registerEngine(engine: SimulationEngine): void {
    this.engines.push(engine);
  }

  /** Validate then apply action (authoritative pipeline). */
  submitAction(
    action: ClientAction,
    options?: { ownerEntityIds?: ReadonlySet<string> },
  ): { accepted: boolean; reason?: string } {
    const validation = validateClientAction(this.world, action, options?.ownerEntityIds);
    if (!validation.valid) {
      return {
        accepted: false,
        ...(validation.reason !== undefined ? { reason: validation.reason } : {}),
      };
    }
    return applyClientAction(this.world, action);
  }

  enqueueAction(
    action: ClientAction,
    options?: { ownerEntityIds?: ReadonlySet<string> },
  ): { accepted: boolean; reason?: string } {
    return this.submitAction(action, options);
  }

  setKinematicPosition(entityId: EntityId, position: Vec2): void {
    this.kinematicPositions.set(entityId, { x: position.x, y: position.y });
  }

  clearKinematic(entityId: EntityId): void {
    this.kinematicPositions.delete(entityId);
  }

  clearAllKinematic(): void {
    this.kinematicPositions.clear();
  }

  getDebugFrame(): StepDebugFrame {
    return this.lastDebugFrame;
  }

  getInterpolationAlpha(): number {
    return interpolationAlpha(this.accumulator.accumulator, this.fixedDt);
  }

  /** State for rendering (interpolated between ticks). */
  getRenderState(): WorldState {
    const alpha = this.getInterpolationAlpha();
    if (alpha <= 0 || alpha >= 1) return this.world;
    return interpolateWorldState(this.previousState, this.world, alpha);
  }

  /** Advance simulation by real-time dt (fixed substeps). */
  simulate(frameDt: number): StepResult[] {
    const steps = advanceAccumulator(this.accumulator, frameDt, this.fixedDt);
    const results: StepResult[] = [];

    for (let i = 0; i < steps; i++) {
      results.push(this.fixedStep());
    }

    return results;
  }

  fixedStep(): StepResult {
    this.applyKinematicTransforms();
    this.ports.clear();
    this.lastDebugFrame = { contacts: [] };

    const ctx = {
      world: this.world,
      dt: this.fixedDt,
      ports: this.ports,
      kinematicIds: new Set(this.kinematicPositions.keys()),
      debug: this.lastDebugFrame,
    };

    this.previousState = cloneWorldState(this.world);

    for (const engine of this.engines) {
      engine.step(ctx);
    }

    this.world.tick += 1;
    this.world.time += this.fixedDt;

    this.snapshots.append(this.world);

    const delta = computeStateDelta(this.lastBroadcastState, this.world);
    this.lastBroadcastState = cloneWorldState(this.world);

    return { delta };
  }

  private applyKinematicTransforms(): void {
    for (const [entityId, position] of this.kinematicPositions) {
      const transform = getComponent(
        this.world,
        entityId,
        ComponentKind.Transform,
      ) as TransformComponent | undefined;
      const body = getComponent(
        this.world,
        entityId,
        ComponentKind.RigidBody,
      ) as RigidBodyComponent | undefined;
      if (!transform) continue;
      setComponent(this.world, entityId, { ...transform, position });
      if (body) {
        setComponent(this.world, entityId, {
          ...body,
          velocity: { x: 0, y: 0 },
          isSleeping: false,
          sleepTimer: 0,
          force: { x: 0, y: 0 },
        });
      }
    }
  }

  getState(): WorldState {
    return this.world;
  }

  scrubToTick(tick: number): WorldState | null {
    const restored = this.snapshots.rewindTo(tick);
    if (!restored) return null;
    Object.assign(this.world, {
      schemaVersion: restored.schemaVersion,
      tick: restored.tick,
      time: restored.time,
      metadata: restored.metadata,
    });
    this.world.entities = restored.entities;
    this.previousState = cloneWorldState(this.world);
    this.lastBroadcastState = cloneWorldState(this.world);
    return this.world;
  }
}
