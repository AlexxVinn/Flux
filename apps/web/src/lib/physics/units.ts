/**
 * Flux world coordinates are pixels. SI display uses a fixed scale for the 2D lab.
 *
 * Default: 100 px = 1 m → FLUX_WORLD (3000×2000 px) ≈ 30 m × 20 m.
 * Matter.js `body.mass` is density × area in px². We relate it to kilograms consistently
 * via {@link KG_PER_MATTER_MASS_UNIT}.
 *
 * **Force (Matter timestep = ms):** one update gives displacement Δx ≈ (F/m)·Δt_ms², so for
 * constant acceleration use F = m·a_px_s2 / Δt_ms² (= m·a / 1000²).
 * Newton display: {@link approximateNewtonSiFromMatterAppliedForceComponent}.
 *
 * **Impulses** use {@link Matter.Body.setVelocity/getVelocity}; do not reuse
 * {@link newtonComponentToMatterForce} for instant kicks.
 */

/** World pixels → meters. */
export const METERS_PER_PIXEL = 0.01;

export const PIXELS_PER_METER = 1 / METERS_PER_PIXEL;

/** Standard gravitational acceleration magnitude (SI), for weight F = mg. */
export const STANDARD_GRAVITY_MPS2 = 9.80665;

/**
 * Calibrates Matter.js ``mass px²´´ to SI kilograms (`m_px² → kg`).
 * Derived so default circle density behaves sensibly alongside {@link STANDARD_GRAVITY_MPS2}.
 */
export const KG_PER_MATTER_MASS_UNIT = 1000;

/** Matter uses millisecond deltas; Δx ≈ (F/m)·Δt_ms² — pair with px/s² via division by this. */
export const MATTER_APPLY_FORCE_DELTA_MS_SQ = 1000 * 1000;

/** Map a sustained Newton-sized force to Matter’s force buffer (`F = m · a_px_s2 / Δt_ms²`). */
export function newtonComponentToMatterForce(fn: number): number {
  const k =
    KG_PER_MATTER_MASS_UNIT * METERS_PER_PIXEL ** 3 * MATTER_APPLY_FORCE_DELTA_MS_SQ;
  return k !== 0 ? fn / k : 0;
}

/** Gravity / sustained forces: Matter internal magnitude for accel in px/s² (`F_internal = mass · a_px / Δt_ms²`). */
export function matterForceFromAccelPxPerSecSquared(matterMass: number, accelPxPerSec2: number): number {
  if (!Number.isFinite(matterMass) || matterMass <= 0 || !Number.isFinite(accelPxPerSec2)) {
    return 0;
  }
  return (matterMass * accelPxPerSec2) / MATTER_APPLY_FORCE_DELTA_MS_SQ;
}

export function pxToM(px: number): number {
  return px * METERS_PER_PIXEL;
}

export function mToPx(m: number): number {
  return m / METERS_PER_PIXEL;
}

export function pxPerSecToMPerSec(vPxPerSec: number): number {
  return vPxPerSec * METERS_PER_PIXEL;
}

export function mPerSecToPxPerSec(vMs: number): number {
  return vMs / METERS_PER_PIXEL;
}

export function matterMassToKg(matterMass: number): number {
  return matterMass * METERS_PER_PIXEL ** 2 * KG_PER_MATTER_MASS_UNIT;
}

/**
 * Matter `body.force` component for one timestep → SI newtons equivalent (m_kg · a derived from Δt_ms² coupling).
 */
export function approximateNewtonSiFromMatterAppliedForceComponent(
  internalComponent: number,
  matterMass: number,
): number {
  if (
    !Number.isFinite(internalComponent) ||
    !Number.isFinite(matterMass) ||
    matterMass <= 0 ||
    matterMass === Infinity
  ) {
    return 0;
  }
  const accelPxPerSecSquared =
    (internalComponent / matterMass) * MATTER_APPLY_FORCE_DELTA_MS_SQ;
  const accelMPerSecSquared = accelPxPerSecSquared * METERS_PER_PIXEL;
  return matterMassToKg(matterMass) * accelMPerSecSquared;
}

export function kgToMatterMass(kg: number): number {
  return kg / (METERS_PER_PIXEL ** 2 * KG_PER_MATTER_MASS_UNIT);
}

export function matterDensityToKgM2(matterDensity: number): number {
  return matterDensity * KG_PER_MATTER_MASS_UNIT;
}

export function kgM2ToMatterDensity(kgM2: number): number {
  return kgM2 / KG_PER_MATTER_MASS_UNIT;
}

/** Translational kinetic energy from mass (kg) and velocity components (m/s). */
export function kineticEnergyJ(massKg: number, vxMs: number, vyMs: number): number {
  if (!Number.isFinite(massKg) || massKg <= 0 || !Number.isFinite(vxMs) || !Number.isFinite(vyMs)) {
    return 0;
  }
  return 0.5 * massKg * (vxMs * vxMs + vyMs * vyMs);
}

/** Mass (Matter px²-equivalent units) × gravity → weight in newtons (`W = mg`, global + per-body scale). */
export function weightNewtonFromSiGravity(
  matterMass: number,
  globalStrength: number,
  bodyGravityScale: number,
): number {
  const mKg = matterMassToKg(matterMass);
  return mKg * STANDARD_GRAVITY_MPS2 * globalStrength * bodyGravityScale;
}

export function formatLengthM(m: number, decimals = 2): string {
  if (!Number.isFinite(m)) return "—";
  if (Math.abs(m) >= 10) return `${m.toFixed(decimals === 2 ? 1 : decimals)} m`;
  return `${m.toFixed(decimals)} m`;
}

export function formatSpeedMs(v: number, decimals = 2): string {
  if (!Number.isFinite(v)) return "—";
  return `${v.toFixed(decimals)} m/s`;
}

export function formatForceN(f: number, decimals = 1): string {
  if (!Number.isFinite(f)) return "—";
  return `${f.toFixed(decimals)} N`;
}

/** Total magnitude formatter that doesn’t erase sub-centinewton values on canvas / tables. */
export function formatForceNMagnitudeAdaptive(f: number): string {
  if (!Number.isFinite(f)) return "—";
  const a = Math.abs(f);
  if (a === 0) return "0 N";
  if (a >= 10) return `${f.toFixed(1)} N`;
  if (a >= 1) return `${f.toFixed(2)} N`;
  if (a >= 0.05) return `${f.toFixed(3)} N`;
  return `${f.toFixed(4)} N`;
}

/** Inspector / detail lines — same precision policy as adaptive magnitude. */
export function formatForceComponentsNn(fx: number, fy: number): string {
  const fmt = (v: number) => {
    const a = Math.abs(v);
    if (a >= 100) return v.toFixed(0);
    if (a >= 10) return v.toFixed(1);
    if (a >= 1) return v.toFixed(2);
    if (a >= 0.05) return v.toFixed(3);
    return v.toFixed(4);
  };
  return `Fx ${fmt(fx)} · Fy ${fmt(fy)} N`;
}
export const UNIT_SCALE_LABEL = `100 px = 1 m`;
