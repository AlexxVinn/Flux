/**
 * Springs: SI elastic constant \(k\) in N/m for pedagogy/overlays/Hooke’s law \(F=k\Delta L\).
 * Matter.js constraint `stiffness`/`damping` are simulator tuning (0–1); derive them from \(k\) for stable demos.
 */


/** Default user-placed spring — soft classroom band (~ΔL≈2 cm ⇒ ~3 N typical). */
export const DEFAULT_SPRING_K_N_PER_M = 160;

/** Slightly tauter linkage (pendulums, articulated chains). */
export const LINK_SPRING_K_N_PER_M = 240;

/** Trampoline/support mesh — moderately stiff. */
export const SUPPORT_SPRING_K_N_PER_M = 520;

/** Hard mesh / hanger lines in bench scenes. */
export const STIFF_SPRING_K_N_PER_M = 980;

/** Reasonable clamps for deriving Matter params from SI \(k\) (avoid solver blow-up). */
export const SPRING_ELASTIC_MIN_N_PER_M = 12;
export const SPRING_ELASTIC_MAX_N_PER_M = 5200;

/** Rigid bar links — effectively zero compliance in the Matter solver. */
export const RIGID_BAR_K_N_PER_M = SPRING_ELASTIC_MAX_N_PER_M;
export const RIGID_BAR_MATTER_STIFFNESS = 1;
export const RIGID_BAR_MATTER_DAMPING = 0.92;

export function isRigidBarSpring(spring: {
  stiffness?: number;
  displayName?: string;
}): boolean {
  if ((spring.stiffness ?? 0) >= 0.98) return true;
  return /^Bar-\d+$/.test(spring.displayName ?? "");
}

/** Extra solver iterations — soft-ish constraints settle better. */
export const SPRING_CONSTRAINT_ITERATIONS = 8;

const MIN_MATTER_CONSTRAINT_STIFFNESS = 0.016;
const MAX_MATTER_CONSTRAINT_STIFFNESS = 0.86;

/**
 * Monotone map Matter.js constraint stiffness \(0\,{:}\,1\) ← SI \(k\) (empirically tuned for 100 px = 1 m mass scale).
 */
export function matterConstraintStiffnessFromElasticKn(kNnPerMeter: number): number {
  const kk = clamp(kNnPerMeter, SPRING_ELASTIC_MIN_N_PER_M, SPRING_ELASTIC_MAX_N_PER_M);
  const u =
    Math.log(kk / SPRING_ELASTIC_MIN_N_PER_M) /
    Math.log(SPRING_ELASTIC_MAX_N_PER_M / SPRING_ELASTIC_MIN_N_PER_M);
  return MIN_MATTER_CONSTRAINT_STIFFNESS + u * (MAX_MATTER_CONSTRAINT_STIFFNESS - MIN_MATTER_CONSTRAINT_STIFFNESS);
}

/** Approximate inverse of {@link matterConstraintStiffnessFromElasticKn} for legacy stiffness-only snapshots. */
export function inferElasticKnFromMatterConstraintStiffness(matterStiffness: number): number {
  const s = clamp(
    matterStiffness,
    MIN_MATTER_CONSTRAINT_STIFFNESS,
    MAX_MATTER_CONSTRAINT_STIFFNESS,
  );
  const denom = MAX_MATTER_CONSTRAINT_STIFFNESS - MIN_MATTER_CONSTRAINT_STIFFNESS;
  const u = denom > 0 ? (s - MIN_MATTER_CONSTRAINT_STIFFNESS) / denom : 0;
  const ratio =
    SPRING_ELASTIC_MAX_N_PER_M / SPRING_ELASTIC_MIN_N_PER_M;
  return clamp(SPRING_ELASTIC_MIN_N_PER_M * ratio ** clamp(u, 0, 1), SPRING_ELASTIC_MIN_N_PER_M, SPRING_ELASTIC_MAX_N_PER_M);
}

/**
 * Lightweight damping coupling (Matter damping 0–1). Targets mild energy loss without collapsing soft springs.
 */
export function matterConstraintDampingFromElasticKn(
  elasticKnPerMeter: number,
  matterStiffness: number,
): number {
  void elasticKnPerMeter;
  const s = clamp(matterStiffness, 0.015, MAX_MATTER_CONSTRAINT_STIFFNESS);
  return clamp(0.028 + Math.sqrt(Math.max(s, MIN_MATTER_CONSTRAINT_STIFFNESS)) * 0.22, 0.012, 0.098);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** @deprecated Prefer {@link DEFAULT_SPRING_K_N_PER_M} — kept for callers that compare relative scalars. */
export const DEFAULT_SPRING_STIFFNESS = matterConstraintStiffnessFromElasticKn(DEFAULT_SPRING_K_N_PER_M);
/** @deprecated */
export const DEFAULT_SPRING_DAMPING = matterConstraintDampingFromElasticKn(
  DEFAULT_SPRING_K_N_PER_M,
  DEFAULT_SPRING_STIFFNESS,
);

/** @deprecated */
export const LINK_SPRING_STIFFNESS = matterConstraintStiffnessFromElasticKn(LINK_SPRING_K_N_PER_M);
/** @deprecated */
export const LINK_SPRING_DAMPING = matterConstraintDampingFromElasticKn(
  LINK_SPRING_K_N_PER_M,
  LINK_SPRING_STIFFNESS,
);

/** @deprecated */
export const SUPPORT_SPRING_STIFFNESS = matterConstraintStiffnessFromElasticKn(SUPPORT_SPRING_K_N_PER_M);
/** @deprecated */
export const SUPPORT_SPRING_DAMPING = matterConstraintDampingFromElasticKn(
  SUPPORT_SPRING_K_N_PER_M,
  SUPPORT_SPRING_STIFFNESS,
);
