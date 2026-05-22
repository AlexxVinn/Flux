/** Physics integrator fidelity — Standard / High / Max (fixed timestep + render interpolation). */
export type SimulationQualityMode = "standard" | "high" | "max";

export interface SimulationQualityPreset {
  substeps: number;
  positionIterations: number;
  velocityIterations: number;
  /** When set, the store advances physics with this fixed Δt (ms) instead of raw RAF Δt. */
  fixedTimestepMs: number | null;
  maxFixedStepsPerFrame: number;
  positionSlop: number;
  positionCorrection: number;
  enableSleeping: boolean;
  /** Lerp prev → current snapshot between fixed steps (Max only). */
  useRenderInterpolation: boolean;
}

export const SIMULATION_QUALITY_PRESETS: Record<SimulationQualityMode, SimulationQualityPreset> = {
  standard: {
    substeps: 1,
    positionIterations: 8,
    velocityIterations: 6,
    fixedTimestepMs: null,
    maxFixedStepsPerFrame: 0,
    positionSlop: 0.05,
    positionCorrection: 1,
    enableSleeping: true,
    useRenderInterpolation: false,
  },
  high: {
    substeps: 2,
    positionIterations: 14,
    velocityIterations: 11,
    fixedTimestepMs: null,
    maxFixedStepsPerFrame: 0,
    positionSlop: 0.04,
    positionCorrection: 0.95,
    enableSleeping: true,
    useRenderInterpolation: false,
  },
  max: {
    substeps: 4,
    positionIterations: 22,
    velocityIterations: 16,
    fixedTimestepMs: 1000 / 120,
    maxFixedStepsPerFrame: 8,
    positionSlop: 0.015,
    positionCorrection: 0.82,
    enableSleeping: false,
    useRenderInterpolation: true,
  },
};

export function getSimulationQualityPreset(mode: SimulationQualityMode): SimulationQualityPreset {
  return SIMULATION_QUALITY_PRESETS[mode];
}
