import type { CollisionDebugPoint, SimulationSnapshot } from "./types";
import { attachWorldFromLocal } from "./bodyAttachPoint";
import {
  approximateNewtonSiFromMatterAppliedForceComponent,
  formatForceComponentsNn,
  formatForceNMagnitudeAdaptive,
} from "./units";
import { effectiveElasticForceNnOnSelfTowardOther } from "./springElastic";
import { inferElasticKnFromMatterConstraintStiffness } from "./springDefaults";
import { estimateContactFrictionNn } from "./contactFrictionEstimate";

/** Canvas palette — mirrored for inspector readouts only. */
export const INSPECT_FORCE_STYLES = {
  weight: { tag: "G", stroke: "#c4b5fd", fill: "#a78bfa", label: "Gravity" },
  applied: { tag: "F", stroke: "#fdba74", fill: "#fb923c", label: "Applied" },
  elastic: { tag: "Fs", stroke: "#5eead4", fill: "#2dd4bf", label: "Spring" },
  preview: { tag: "F", stroke: "#fde68a", fill: "#fbbf24", label: "Draft force" },
  /** Contact normal pushes body out of the surface (~perpendicular arrow). */
  normal: { tag: "Fn", stroke: "#7dd3fc", fill: "#38bdf8", label: "Normal (estimate)" },
  /** Friction along the surface — opposes sliding or impending slip along tangent. */
  friction: { tag: "Ff", stroke: "#fb923c", fill: "#ea580c", label: "Friction (estimate)" },
} as const;

function elasticKnFromSnap(spring: SimulationSnapshot["springs"][number]): number {
  return typeof spring.elasticConstantNnPerM === "number" && Number.isFinite(spring.elasticConstantNnPerM)
    ? spring.elasticConstantNnPerM
    : inferElasticKnFromMatterConstraintStiffness(spring.stiffness);
}

export interface InspectForceNnRow {
  key: string;
  tag: string;
  stroke: string;
  fill: string;
  headline: string;
  magNn: number;
  detailLine: string;
  /** Free-body vectors; world coords with +y downward (Flux screen space). */
  fxNn: number;
  fyNn: number;
}

function weightNnAtCoM(
  snapshot: SimulationSnapshot,
  bodyId: string,
  gravityForBody: (id: string) => { x: number; y: number },
): { fx: number; fy: number } {
  const body = snapshot.bodies.find((b) => b.id === bodyId);
  if (!body?.visible || body.isStatic) return { fx: 0, fy: 0 };
  const g = gravityForBody(bodyId);
  return {
    fx: approximateNewtonSiFromMatterAppliedForceComponent(g.x, body.mass),
    fy: approximateNewtonSiFromMatterAppliedForceComponent(g.y, body.mass),
  };
}

/** Net spring-induced elastic forces on `bodyId` at its attachment(s), summed in newtons at CoM-equivalent pathway. */
export function sumSpringElasticForcesNnOnBody(
  snapshot: SimulationSnapshot,
  bodyId: string,
  gravityForBody: (id: string) => { x: number; y: number },
): { fx: number; fy: number } {
  let fx = 0;
  let fy = 0;

  for (const spring of snapshot.springs) {
    if (!spring.visible) continue;
    const ia = snapshot.bodies.find((x) => x.id === spring.bodyA);
    const ib = snapshot.bodies.find((x) => x.id === spring.bodyB);
    if (!ia?.visible || !ib?.visible) continue;

    const atA = spring.bodyA === bodyId;
    const atB = spring.bodyB === bodyId;
    if (!atA && !atB) continue;

    const aw = attachWorldFromLocal(ia, spring.anchorA?.x ?? 0, spring.anchorA?.y ?? 0);
    const bw = attachWorldFromLocal(ib, spring.anchorB?.x ?? 0, spring.anchorB?.y ?? 0);

    let selfX = aw.x;
    let selfY = aw.y;
    let otherX = bw.x;
    let otherY = bw.y;
    if (!atA) {
      selfX = bw.x;
      selfY = bw.y;
      otherX = aw.x;
      otherY = aw.y;
    }

    const wie = weightNnAtCoM(snapshot, bodyId, gravityForBody);
    const kNn = elasticKnFromSnap(spring);
    const el = effectiveElasticForceNnOnSelfTowardOther({
      kNnPerMeter: kNn,
      selfX,
      selfY,
      otherX,
      otherY,
      restLenPx: spring.length,
      weightNn: wie,
    });
    fx += el.fx;
    fy += el.fy;
  }

  return { fx, fy };
}

/** Normal + friction from contacts — shared heuristic in {@link estimateContactFrictionNn}. */
function contactFrictionNormalInspectRows(
  snapshot: SimulationSnapshot,
  bodyId: string,
  contacts: CollisionDebugPoint[],
  FxN: number,
  FyN: number,
  vxPx: number,
  vyPx: number,
): InspectForceNnRow[] {
  const est = estimateContactFrictionNn(snapshot, bodyId, contacts, FxN, FyN, vxPx, vyPx);
  if (!est) return [];

  const { fnFx, fnFy, ffFx, ffFy, normalMagNn, frictionMagNn, isKinetic, muK, muS } = est;
  const out: InspectForceNnRow[] = [];
  const nSt = INSPECT_FORCE_STYLES.normal;
  out.push({
    key: `Fn-${bodyId}`,
    tag: nSt.tag,
    stroke: nSt.stroke,
    fill: nSt.fill,
    headline: `${nSt.label}`,
    magNn: normalMagNn,
    detailLine: `${formatForceNMagnitudeAdaptive(normalMagNn)} (${formatForceComponentsNn(fnFx, fnFy)})`,
    fxNn: fnFx,
    fyNn: fnFy,
  });

  if (Math.hypot(ffFx, ffFy) > 1e-14) {
    const fSt = INSPECT_FORCE_STYLES.friction;
    out.push({
      key: `Ff-${bodyId}`,
      tag: fSt.tag,
      stroke: fSt.stroke,
      fill: fSt.fill,
      headline: `${fSt.label} · ${isKinetic ? "kinetic (opposes sliding)" : "static (balanced up to mu_s*N)"}`,
      magNn: Math.hypot(ffFx, ffFy),
      detailLine: `${formatForceNMagnitudeAdaptive(frictionMagNn)} (${formatForceComponentsNn(ffFx, ffFy)}) · ${
        isKinetic ? `mu_k=${muK.toFixed(2)}` : `mu_s=${muS.toFixed(2)}`
      }`,
      fxNn: ffFx,
      fyNn: ffFy,
    });
  }

  return out;
}

export function collectBodyForceInspectNn(
  snapshot: SimulationSnapshot,
  bodyId: string,
  deps: {
    gravityForBody: (id: string) => { x: number; y: number };
    appliedNn: Map<string, { x: number; y: number }>;
    draftNn?: { fx: number; fy: number };
    contacts?: CollisionDebugPoint[];
  },
): InspectForceNnRow[] {
  const rows: InspectForceNnRow[] = [];
  const b = snapshot.bodies.find((x) => x.id === bodyId);
  if (!b?.visible || b.entityKind === "ropeSegment") return rows;

  if (!b.isStatic) {
    const wgt = weightNnAtCoM(snapshot, bodyId, deps.gravityForBody);
    const wMag = Math.hypot(wgt.fx, wgt.fy);
    if (wMag > 1e-14) {
      const st = INSPECT_FORCE_STYLES.weight;
      rows.push({
        key: `G-${bodyId}`,
        tag: st.tag,
        stroke: st.stroke,
        fill: st.fill,
        headline: st.label,
        magNn: wMag,
        detailLine: `${formatForceNMagnitudeAdaptive(wMag)} (${formatForceComponentsNn(wgt.fx, wgt.fy)})`,
        fxNn: wgt.fx,
        fyNn: wgt.fy,
      });
    }
  }

  if (!b.isStatic) {
    const f = deps.appliedNn.get(bodyId);
    if (f && Math.hypot(f.x, f.y) > 1e-14) {
      const st = INSPECT_FORCE_STYLES.applied;
      rows.push({
        key: `F-${bodyId}`,
        tag: st.tag,
        stroke: st.stroke,
        fill: st.fill,
        headline: st.label,
        magNn: Math.hypot(f.x, f.y),
        detailLine: `${formatForceNMagnitudeAdaptive(Math.hypot(f.x, f.y))} (${formatForceComponentsNn(f.x, f.y)})`,
        fxNn: f.x,
        fyNn: f.y,
      });
    }
  }

  if (!b.isStatic && deps.draftNn) {
    const { fx, fy } = deps.draftNn;
    const mag = Math.hypot(fx, fy);
    if (mag > 1e-14) {
      const st = INSPECT_FORCE_STYLES.preview;
      rows.push({
        key: `draft-${bodyId}`,
        tag: st.tag,
        stroke: st.stroke,
        fill: st.fill,
        headline: `${st.label} (tool)`,
        magNn: mag,
        detailLine: `${formatForceNMagnitudeAdaptive(mag)} (${formatForceComponentsNn(fx, fy)})`,
        fxNn: fx,
        fyNn: fy,
      });
    }
  }

  for (const spring of snapshot.springs) {
    if (!spring.visible) continue;
    const ia = snapshot.bodies.find((x) => x.id === spring.bodyA);
    const ib = snapshot.bodies.find((x) => x.id === spring.bodyB);
    if (!ia?.visible || !ib?.visible) continue;

    const atA = spring.bodyA === bodyId;
    const atB = spring.bodyB === bodyId;
    if (!atA && !atB) continue;

    const aw = attachWorldFromLocal(ia, spring.anchorA?.x ?? 0, spring.anchorA?.y ?? 0);
    const bw = attachWorldFromLocal(ib, spring.anchorB?.x ?? 0, spring.anchorB?.y ?? 0);

    let selfX = aw.x;
    let selfY = aw.y;
    let otherX = bw.x;
    let otherY = bw.y;
    if (!atA) {
      selfX = bw.x;
      selfY = bw.y;
      otherX = aw.x;
      otherY = aw.y;
    }

    const wie = weightNnAtCoM(snapshot, bodyId, deps.gravityForBody);
    const kNn = elasticKnFromSnap(spring);
    const el = effectiveElasticForceNnOnSelfTowardOther({
      kNnPerMeter: kNn,
      selfX,
      selfY,
      otherX,
      otherY,
      restLenPx: spring.length,
      weightNn: wie,
    });
    const springMag = Math.hypot(el.fx, el.fy);
    if (springMag <= 1e-14) continue;

    const st = INSPECT_FORCE_STYLES.elastic;
    rows.push({
      key: `Fs-${spring.id}-${bodyId}`,
      tag: st.tag,
      stroke: st.stroke,
      fill: st.fill,
      headline: `${st.label}: ${spring.displayName}`,
      magNn: springMag,
      detailLine: `${formatForceNMagnitudeAdaptive(springMag)} (${formatForceComponentsNn(el.fx, el.fy)})`,
      fxNn: el.fx,
      fyNn: el.fy,
    });
  }

  if (!b.isStatic && deps.contacts && deps.contacts.length > 0) {
    const wsum = weightNnAtCoM(snapshot, bodyId, deps.gravityForBody);
    const apl = deps.appliedNn.get(bodyId);
    const FxCoM = wsum.fx + (apl?.x ?? 0);
    const FyCoM = wsum.fy + (apl?.y ?? 0);
    rows.push(
      ...contactFrictionNormalInspectRows(snapshot, bodyId, deps.contacts, FxCoM, FyCoM, b.velocityX, b.velocityY),
    );
  }

  return rows;
}
