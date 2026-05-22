"use client";

import type { ReactNode } from "react";
import type { SimBodySnapshot } from "@/lib/physics/types";
import type { InspectForceNnRow } from "@/lib/physics/forceInspect";
import { formatForceNMagnitudeAdaptive } from "@/lib/physics/units";

const VW = 260;
const VH = 216;
const BODY_CAP = 130;

interface Props {
  body: Pick<SimBodySnapshot, "shape" | "width" | "height">;
  rows: InspectForceNnRow[];
}

export function BodyFreeBodyDiagram({ body, rows }: Props) {
  const valid = rows.filter((r) => Math.hypot(r.fxNn, r.fyNn) > 1e-14);
  if (valid.length === 0) return null;

  const bm = Math.max(body.width, body.height, 8);
  const bodyScale = Math.min(BODY_CAP / bm, 1);

  let bodyEl: ReactNode;
  if (body.shape === "circle") {
    const rr = Math.max(bodyScale * (body.width / 2), 6);
    bodyEl = (
      <circle cx={0} cy={0} r={rr} fill="rgba(245,243,247,0.08)" stroke="rgba(255,255,255,0.22)" strokeWidth={1} />
    );
  } else {
    const hw = Math.max(bodyScale * (body.width / 2), 6);
    const hh = Math.max(bodyScale * (body.height / 2), 6);
    bodyEl = (
      <rect
        x={-hw}
        y={-hh}
        width={hw * 2}
        height={hh * 2}
        rx={2}
        fill="rgba(245,243,247,0.08)"
        stroke="rgba(255, 255, 255, 0.26)"
        strokeWidth={1}
      />
    );
  }

  const silhouetteR =
    body.shape === "circle"
      ? Math.max(bodyScale * (body.width / 2), 6)
      : Math.max((bodyScale * Math.hypot(body.width, body.height)) / 2, 8);

  const maxF = Math.max(...valid.map((r) => Math.hypot(r.fxNn, r.fyNn)), 1e-9);
  const maxArrow = Math.min(VW / 2, VH / 2) - 22 - silhouetteR;
  const pxPerN = Math.max(0.4, Math.min(maxArrow / maxF, 120));

  return (
    <div className="sticky bottom-0 z-10 mt-2 rounded-md border border-flux-border/80 bg-[#09090c] px-2 py-2 shadow-[0_-12px_32px_rgba(0,0,0,0.75)]">
      <p className="mb-1 text-[8px] font-semibold uppercase tracking-widest text-flux-muted">
        Free-body analysis (preview)
      </p>
      <p className="mb-2 font-mono text-[9px] leading-snug text-flux-muted/85">
        CoM centered · world +y down · arrows scale together ({pxPerN.toFixed(1)} px/N; strongest{" "}
        {formatForceNMagnitudeAdaptive(maxF)})
      </p>
      <svg
        width="100%"
        viewBox={`${-VW / 2} ${-VH / 2} ${VW} ${VH}`}
        className="max-h-[190px]"
        aria-label="Free-body diagram for selection"
      >
        <circle cx={0} cy={0} r={1.5} fill="rgba(255,255,255,0.45)" />
        <line x1={-VW / 2} y1={0} x2={VW / 2} y2={0} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
        <line x1={0} y1={-VH / 2} x2={0} y2={VH / 2} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
        {bodyEl}
        {valid.map((r) => {
          let vx = r.fxNn * pxPerN;
          let vy = r.fyNn * pxPerN;
          let mag = Math.hypot(vx, vy);
          if (mag < 1e-9) return null;
          if (mag < 2.8) {
            const s = 2.8 / mag;
            vx *= s;
            vy *= s;
            mag = 2.8;
          }
          const ux = vx / mag;
          const uy = vy / mag;
          const head = 10;
          const hx = vx - ux * head;
          const hy = vy - uy * head;
          const px = uy * 3.8;
          const py = -ux * 3.8;

          return (
            <g key={r.key}>
              <line x1={0} y1={0} x2={hx} y2={hy} stroke={r.stroke} strokeWidth={2.25} strokeLinecap="round" />
              <polygon
                points={`${vx},${vy} ${hx + px},${hy + py} ${hx - px},${hy - py}`}
                fill={r.fill}
                stroke="rgba(0,0,0,0.3)"
                strokeWidth={0.5}
              />
              <text
                x={ux * 14 + vx * 0.4}
                y={uy * 14 + vy * 0.4}
                fill={r.fill}
                fontSize="10"
                fontWeight={600}
                style={{ paintOrder: "stroke", stroke: "rgba(6,8,12,0.9)", strokeWidth: 4 }}
              >
                {`${r.tag} ${formatForceNMagnitudeAdaptive(r.magNn)}`}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
