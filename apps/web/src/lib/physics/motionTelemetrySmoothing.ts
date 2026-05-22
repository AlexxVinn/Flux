/**
 * Display-only kinematic smoothing for charts / readouts.
 * Matter.js contact resolution injects high-frequency noise into both v and x;
 * physics integration is unchanged.
 */

/** Low-pass time constant for velocity series (ms). ~60–80 ms preserves ramp slopes on slow slides. */
export const TELEMETRY_VELOCITY_SMOOTH_TAU_MS = 72;

/** Half-width of the position window used to estimate v (ms). Total span ≈ 2× when samples exist. */
export const TELEMETRY_KINEMATIC_HALF_WINDOW_MS = 55;

export function windowedKinematicVelocityMs(
  points: readonly { xM: number; yM: number; elapsedMs: number }[],
  index: number,
  halfWindowMs: number = TELEMETRY_KINEMATIC_HALF_WINDOW_MS,
): { vxMs: number; vyMs: number } {
  const cur = points[index]!;
  if (points.length < 2) return { vxMs: 0, vyMs: 0 };

  const tMin = cur.elapsedMs - halfWindowMs;
  const tMax = cur.elapsedMs + halfWindowMs;

  let iL = 0;
  for (let i = 0; i <= index; i++) {
    if (points[i]!.elapsedMs <= tMin) iL = i;
  }
  let iR = points.length - 1;
  for (let i = index; i < points.length; i++) {
    if (points[i]!.elapsedMs >= tMax) {
      iR = i;
      break;
    }
  }

  if (iL === iR && points.length >= 2) {
    iL = Math.max(0, index - 1);
    iR = Math.min(points.length - 1, index + 1);
    if (iL === iR) {
      iR = Math.min(points.length - 1, iL + 1);
    }
  }

  const dtSec = Math.max(1e-4, (points[iR]!.elapsedMs - points[iL]!.elapsedMs) / 1000);
  return {
    vxMs: (points[iR]!.xM - points[iL]!.xM) / dtSec,
    vyMs: (points[iR]!.yM - points[iL]!.yM) / dtSec,
  };
}

function emaSeries(
  values: readonly number[],
  elapsedMs: readonly number[],
  tauMs: number,
  direction: "forward" | "backward",
): number[] {
  const n = values.length;
  if (n === 0) return [];
  const out = new Array<number>(n);
  if (direction === "forward") {
    out[0] = values[0]!;
    for (let i = 1; i < n; i++) {
      const dtMs = Math.max(0, elapsedMs[i]! - elapsedMs[i - 1]!);
      const alpha = dtMs / Math.max(tauMs, dtMs, 1e-6);
      out[i] = out[i - 1]! + alpha * (values[i]! - out[i - 1]!);
    }
  } else {
    out[n - 1] = values[n - 1]!;
    for (let i = n - 2; i >= 0; i--) {
      const dtMs = Math.max(0, elapsedMs[i + 1]! - elapsedMs[i]!);
      const alpha = dtMs / Math.max(tauMs, dtMs, 1e-6);
      out[i] = out[i + 1]! + alpha * (values[i]! - out[i + 1]!);
    }
  }
  return out;
}

/** Zero-phase EMA — smooths without shifting peaks (ok for offline timeline rebuild). */
export function zeroPhaseSmoothVelocitySeries(
  vxRaw: readonly number[],
  vyRaw: readonly number[],
  elapsedMs: readonly number[],
  tauMs: number = TELEMETRY_VELOCITY_SMOOTH_TAU_MS,
): { vxMs: number[]; vyMs: number[] } {
  if (vxRaw.length < 2) {
    return { vxMs: [...vxRaw], vyMs: [...vyRaw] };
  }
  const vxFwd = emaSeries(vxRaw, elapsedMs, tauMs, "forward");
  const vxBwd = emaSeries(vxRaw, elapsedMs, tauMs, "backward");
  const vyFwd = emaSeries(vyRaw, elapsedMs, tauMs, "forward");
  const vyBwd = emaSeries(vyRaw, elapsedMs, tauMs, "backward");
  return {
    vxMs: vxRaw.map((_, i) => (vxFwd[i]! + vxBwd[i]!) * 0.5),
    vyMs: vyRaw.map((_, i) => (vyFwd[i]! + vyBwd[i]!) * 0.5),
  };
}

/** Causal low-pass for live streaming samples (one new point per frame). */
export function causalSmoothVelocityMs(
  vxRaw: number,
  vyRaw: number,
  vxPrev: number,
  vyPrev: number,
  dtMs: number,
  tauMs: number = TELEMETRY_VELOCITY_SMOOTH_TAU_MS,
): { vxMs: number; vyMs: number } {
  const alpha = dtMs / Math.max(tauMs, dtMs, 1e-6);
  return {
    vxMs: vxPrev + alpha * (vxRaw - vxPrev),
    vyMs: vyPrev + alpha * (vyRaw - vyPrev),
  };
}
