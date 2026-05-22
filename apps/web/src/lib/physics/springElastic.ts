import { METERS_PER_PIXEL } from "./units";

/**
 * Hooke-law elastic force magnitude (SI) along the spring axis.
 * Stretch (L > L₀): pulls each endpoint toward the other; compressed: pushes apart.
 */
export function elasticSpringForceNn(
  elasticConstantNnPerMeter: number,
  currentLenPx: number,
  restLengthPx: number,
): number {
  if (!Number.isFinite(elasticConstantNnPerMeter) || elasticConstantNnPerMeter <= 0) return 0;
  if (
    !Number.isFinite(currentLenPx) ||
    !Number.isFinite(restLengthPx) ||
    currentLenPx < 1e-9 ||
    restLengthPx < 0
  ) {
    return 0;
  }
  const deltaM = (currentLenPx - restLengthPx) * METERS_PER_PIXEL;
  return elasticConstantNnPerMeter * deltaM;
}

/** Endpoint A at (ax,ay), endpoint B at (bx,by) — force on A toward B when stretched (+x dir when B right of A). */
export function elasticForceVectorNnOnAttachmentA(params: {
  kNnPerMeter: number;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  restLenPx: number;
}): { fx: number; fy: number; magNn: number } {
  const { kNnPerMeter, ax, ay, bx, by, restLenPx } = params;
  const dx = bx - ax;
  const dy = by - ay;
  const L = Math.hypot(dx, dy);
  if (L < 1e-9) return { fx: 0, fy: 0, magNn: 0 };
  const magNn = elasticSpringForceNn(kNnPerMeter, L, restLenPx);
  const ux = dx / L;
  const uy = dy / L;
  return {
    fx: magNn * ux,
    fy: magNn * uy,
    magNn: Math.abs(magNn),
  };
}

/**
 * Same axis as {@link elasticForceVectorNnOnAttachmentA}, but raises near-zero |kΔL| from stiff
 * Matter.js constraints toward a minimum tension consistent with gravity projected on the rope axis
 * (pedagogy / “what holds this body up?”), without pretending multi-spring statics are solved.
 *
 * Weight is gravity at CoM (N); use zeros for static anchors.
 */
export function effectiveElasticForceNnOnSelfTowardOther(params: {
  kNnPerMeter: number;
  selfX: number;
  selfY: number;
  otherX: number;
  otherY: number;
  restLenPx: number;
  weightNn: { fx: number; fy: number };
}): { fx: number; fy: number; magNn: number; geoMagNn: number } {
  const { kNnPerMeter, selfX, selfY, otherX, otherY, restLenPx, weightNn } = params;
  const dx = otherX - selfX;
  const dy = otherY - selfY;
  const L = Math.hypot(dx, dy);
  if (L < 1e-9) return { fx: 0, fy: 0, magNn: 0, geoMagNn: 0 };
  const ux = dx / L;
  const uy = dy / L;

  const geoSigned = elasticSpringForceNn(kNnPerMeter, L, restLenPx);
  const geoMag = Math.abs(geoSigned);
  let dirSign =
    geoSigned !== 0 && Number.isFinite(geoSigned)
      ? Math.sign(geoSigned)
      : Math.sign(L - restLenPx);
  if (dirSign === 0 || !Number.isFinite(dirSign)) dirSign = 1;

  const wMag = Math.hypot(weightNn.fx, weightNn.fy);
  const axialW = weightNn.fx * ux + weightNn.fy * uy;
  const floorNn = Number.isFinite(wMag) ? Math.min(wMag, Math.abs(axialW)) : 0;
  const magNn = Math.max(geoMag, floorNn);

  /** Rope/spring supports weight even when geometric kΔL is tiny or “compressed”; keep tension toward anchor. */
  if (floorNn >= geoMag) dirSign = 1;

  return {
    fx: dirSign * magNn * ux,
    fy: dirSign * magNn * uy,
    magNn,
    geoMagNn: geoMag,
  };
}
