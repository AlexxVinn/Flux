/** Fixed simulation rate — framerate-independent stepping. */
export const FIXED_HZ = 60;
export const FIXED_DT = 1 / FIXED_HZ;
export const MAX_FRAME_DT = 0.25;

export interface AccumulatorState {
  accumulator: number;
}

export function createAccumulator(): AccumulatorState {
  return { accumulator: 0 };
}

/** Clamp frame delta and advance fixed substeps. Returns substeps count. */
export function advanceAccumulator(
  state: AccumulatorState,
  frameDt: number,
  fixedDt: number = FIXED_DT,
): number {
  const clamped = Math.min(Math.max(frameDt, 0), MAX_FRAME_DT);
  state.accumulator += clamped;
  let steps = 0;
  while (state.accumulator >= fixedDt) {
    state.accumulator -= fixedDt;
    steps += 1;
  }
  return steps;
}

export function interpolationAlpha(
  accumulator: number,
  fixedDt: number = FIXED_DT,
): number {
  if (fixedDt <= 0) return 0;
  return Math.max(0, Math.min(1, accumulator / fixedDt));
}
