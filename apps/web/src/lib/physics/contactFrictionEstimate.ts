/**
 * Estimated normal reaction (Fn) and friction (Ff) at contacts for a dynamic body,
 * matching the heuristic used by the inspector (gravity + applied only feed the reaction basis).
 */

import type { CollisionDebugPoint, SimulationSnapshot } from "./types";

export interface ContactFrictionNnEstimate {
  /** Normal force pushing the surface into the body (world N, Flux +y downward). */
  fnFx: number;
  fnFy: number;
  /** Friction tangent force (world N); may be zero magnitude. */
  ffFx: number;
  ffFy: number;
  /** Display magnitude of normal (caps against driving basis magnitude). */
  normalMagNn: number;
  /** Coulomb capped magnitude feeding Ff. */
  frictionMagNn: number;
  isKinetic: boolean;
  muK: number;
  muS: number;
}

/** Alias for callers that only need vectors (canvas, telemetry resultant). */
export type ContactFrictionNnVectors = Omit<
  ContactFrictionNnEstimate,
  "normalMagNn" | "frictionMagNn" | "isKinetic" | "muK" | "muS"
>;

/** Treat as zero Coulomb coefficient (inspector + estimates). */
const FRICTION_COEFF_EPS = 1e-12;

/** Matter friction is nominally <=1; clamp for stable estimates. */
function clampFrictionDisplayed(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(2.5, Math.max(0, v));
}

/**
 * Estimate aggregate Fn/Ff from collision debug contacts for `bodyId`.
 * @param fxReactionBasisN  Non-contact planar driving force at COM (typically G + sustained applied).
 * @param fyReactionBasisN Same.
 */
export function estimateContactFrictionNn(
  snapshot: SimulationSnapshot,
  bodyId: string,
  contacts: CollisionDebugPoint[],
  fxReactionBasisN: number,
  fyReactionBasisN: number,
  vxPx: number,
  vyPx: number,
): ContactFrictionNnEstimate | null {
  const body = snapshot.bodies.find((b) => b.id === bodyId);
  if (!body?.visible || body.isStatic) return null;

  const rel = contacts.filter((c) => c.bodyA === bodyId || c.bodyB === bodyId);
  if (rel.length === 0) return null;

  let anx = 0;
  let any = 0;
  let muKSum = 0;
  let muSSum = 0;
  let muN = 0;
  for (const c of rel) {
    anx += c.nx;
    any += c.ny;
    const muKmix =
      typeof c.frictionMixed === "number" && Number.isFinite(c.frictionMixed) ? c.frictionMixed : NaN;
    const muSmixRaw =
      typeof c.frictionStaticMixed === "number" && Number.isFinite(c.frictionStaticMixed)
        ? c.frictionStaticMixed
        : muKmix;
    if (Number.isFinite(muKmix)) {
      muKSum += clampFrictionDisplayed(muKmix);
      muSSum += clampFrictionDisplayed(muSmixRaw);
      muN++;
    }
  }

  let nhX = anx / rel.length;
  let nhY = any / rel.length;
  let nhLen = Math.hypot(nhX, nhY);
  if (nhLen < 1e-12) return null;
  nhX /= nhLen;
  nhY /= nhLen;

  let N_est = -(fxReactionBasisN * nhX + fyReactionBasisN * nhY);
  if (!Number.isFinite(N_est)) return null;
  if (N_est < 0.01) {
    nhX *= -1;
    nhY *= -1;
    N_est = -(fxReactionBasisN * nhX + fyReactionBasisN * nhY);
  }
  N_est = Math.max(0, N_est);

  const wCap = Math.hypot(fxReactionBasisN, fyReactionBasisN);
  const N_display = Number.isFinite(wCap) ? Math.min(N_est, wCap + 1e-6) : N_est;

  const muBodyK = clampFrictionDisplayed(body.friction);
  const muBodyS = clampFrictionDisplayed(body.frictionStatic);

  /** Pair-averaged μ from contacts; body's own coeffs gate whether friction exists at all. */
  const muKFromPairAvg = muN ? muKSum / muN : muBodyK;
  const muSRawFromPairAvg = muN ? muSSum / muN : muBodyS;

  const muK = muBodyK <= FRICTION_COEFF_EPS ? 0 : muKFromPairAvg;
  const muSRaw = muBodyS <= FRICTION_COEFF_EPS ? 0 : muSRawFromPairAvg;
  const muS = Math.max(muSRaw, muK);

  const tauX = -nhY;
  const tauY = nhX;

  const vSlip = vxPx * tauX + vyPx * tauY;
  const kineticThresholdPxPerSec = 12;

  const dotFn = fxReactionBasisN * nhX + fyReactionBasisN * nhY;
  const FxPar = fxReactionBasisN - nhX * dotFn;
  const FyPar = fyReactionBasisN - nhY * dotFn;
  const slipDriveMag = Math.hypot(FxPar, FyPar);

  let frictionMagNn = 0;
  let isKinetic = false;
  if (Math.abs(vSlip) > kineticThresholdPxPerSec) {
    isKinetic = true;
    frictionMagNn = muK * N_display;
  } else {
    frictionMagNn = slipDriveMag > 1e-14 ? Math.min(muS * N_display, slipDriveMag) : 0;
  }

  let ffx = 0;
  let ffy = 0;
  if (frictionMagNn > 1e-14) {
    if (isKinetic) {
      const sgn = Math.sign(vSlip) || 1;
      ffx = -sgn * tauX * frictionMagNn;
      ffy = -sgn * tauY * frictionMagNn;
    } else if (slipDriveMag > 1e-14) {
      const ux = FxPar / slipDriveMag;
      const uy = FyPar / slipDriveMag;
      ffx = -ux * frictionMagNn;
      ffy = -uy * frictionMagNn;
    }
  }

  return {
    fnFx: nhX * N_display,
    fnFy: nhY * N_display,
    ffFx: ffx,
    ffFy: ffy,
    normalMagNn: N_display,
    frictionMagNn,
    isKinetic,
    muK,
    muS,
  };
}
