"use client";

import { useId, useMemo, useState } from "react";
import type { MotionTimelineGraphPoint, SelectionTelemetrySample } from "@/store/simulationStore";
import {
  buildMotionTimelineSamplesForSelection,
  composeModeledTelemetrySample,
  useSimulationStore,
} from "@/store/simulationStore";
import { matterMassToKg, UNIT_SCALE_LABEL, formatForceNMagnitudeAdaptive, formatSpeedMs } from "@/lib/physics/units";

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

type GraphMode = "path" | "position" | "velocity" | "accel" | "sigmaF";

interface Props {
  bodyId: string;
  bodyMassMatter: number;
  historyLength: number;
  historyIndex: number;
  elapsedMsReview: number;
  simTick: number;
  isPlaying: boolean;
  playbackHighlight?: boolean;
}

interface RelativeMotionPoint extends MotionTimelineGraphPoint {
  dxM: number;
  dyM: number;
}

function relativeTimeline(timeline: MotionTimelineGraphPoint[]): RelativeMotionPoint[] {
  if (timeline.length === 0) return [];
  const x0 = timeline[0]!.xM;
  const y0 = timeline[0]!.yM;
  return timeline.map((p) => ({
    ...p,
    dxM: p.xM - x0,
    dyM: p.yM - y0,
  }));
}

function ModeChip({
  label,
  hint,
  active,
  live,
  onClick,
}: {
  label: string;
  hint?: string;
  active: boolean;
  live?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={hint}
      className={`rounded-lg px-2 py-2 text-left transition ${
        active
          ? live
            ? "bg-emerald-500/22 text-emerald-100 shadow-[inset_0_0_0_1px_rgba(52,211,153,0.35)]"
            : "bg-white/14 text-flux-text"
          : "bg-black/30 text-flux-muted hover:bg-white/[0.07] hover:text-flux-text/90"
      }`}
    >
      <span className="block text-[10px] font-semibold uppercase tracking-wider">{label}</span>
      {hint ? (
        <span className="mt-0.5 block text-[9px] font-normal lowercase leading-snug opacity-85">
          {hint}
        </span>
      ) : null}
    </button>
  );
}

function timelineFindIndexAt(timeline: MotionTimelineGraphPoint[], tMs: number): number {
  if (timeline.length === 0) return 0;
  let lo = 0;
  let hi = timeline.length - 1;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (timeline[mid]!.elapsedMs <= tMs) lo = mid;
    else hi = mid;
  }
  const dl = Math.abs(timeline[lo]!.elapsedMs - tMs);
  const dr = Math.abs(timeline[hi]!.elapsedMs - tMs);
  return dl <= dr ? lo : hi;
}

function formatElapsedLabel(elapsedMs: number): string {
  return (elapsedMs / 1000).toFixed(2);
}

function prettyAxis(v: number): string {
  const a = Math.abs(v);
  if (a >= 1000 || (a > 0 && a < 0.005)) return v.toExponential(1);
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

function symmetricTicks(span: number, count = 4): number[] {
  const half = Math.max(span, 1e-6);
  const out: number[] = [];
  for (let i = 0; i <= count; i++) {
    out.push(-half + (2 * half * i) / count);
  }
  return out;
}

/** Time-based chart with playhead values and readable axes. */
function TimeSeriesSvg({
  width,
  height,
  timeline,
  highlightElapsedMs,
  series,
  yUnitSuffix,
  yAxisCaption,
}: {
  width: number;
  height: number;
  timeline: MotionTimelineGraphPoint[];
  highlightElapsedMs: number;
  series: readonly { label: string; ys: readonly number[]; stroke: string; dash?: string }[];
  yUnitSuffix: string;
  yAxisCaption: string;
}) {
  const margin = { l: 52, r: 14, top: 14, bot: 42 };
  const innerW = width - margin.l - margin.r;
  const innerH = height - margin.top - margin.bot;
  const t0 = timeline[0]!.elapsedMs;
  const t1 = timeline[timeline.length - 1]!.elapsedMs;
  const spanT = Math.max(t1 - t0, 1e-9);
  const tx = (tMs: number) => clamp((tMs - t0) / spanT, 0, 1);

  let lo = Infinity;
  let hi = -Infinity;
  for (const s of series) {
    for (const y of s.ys) {
      if (!Number.isFinite(y)) continue;
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;

  const rawSpan = hi - lo;
  const pad =
    rawSpan > 1e-12 ? rawSpan * 0.1 : Math.max(Math.abs(lo), Math.abs(hi), 1) * 0.1 || 1;
  const vMin = lo - pad;
  const vMax = hi + pad;
  const vSpan = Math.max(vMax - vMin, 1e-12);
  const yPx = (v: number) => margin.top + innerH * (1 - clamp((Number(v) - vMin) / vSpan, 0, 1));

  const pointsFor = (ys: readonly number[]): string =>
    timeline
      .map((row, i) => {
        const x = margin.l + tx(row.elapsedMs) * innerW;
        const y = yPx(ys[i] ?? 0);
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");

  const phNorm = clamp((highlightElapsedMs - t0) / spanT, 0, 1);
  const phx = margin.l + phNorm * innerW;
  const ti = timelineFindIndexAt(timeline, highlightElapsedMs);

  const yTicks = 4;
  const tickYs: number[] = [];
  for (let i = 0; i <= yTicks; i++) tickYs.push(vMin + (vSpan * i) / yTicks);

  const playheadValues = series
    .map((s) => {
      const v = s.ys[ti];
      if (v === undefined || !Number.isFinite(v)) return null;
      return { label: s.label, stroke: s.stroke, value: v };
    })
    .filter((x): x is { label: string; stroke: string; value: number } => x != null);

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="rounded-lg bg-black/55 outline outline-1 outline-white/[0.08]"
      role="img"
      aria-label={`${yAxisCaption} versus simulation time`}
    >
      {tickYs.map((tv, idx) => {
        const yy = yPx(tv);
        return (
          <line
            key={`yg-${idx}`}
            x1={margin.l}
            y1={yy}
            x2={margin.l + innerW}
            y2={yy}
            stroke="rgba(248,250,252,0.06)"
          />
        );
      })}
      <line
        x1={margin.l}
        y1={margin.top + innerH}
        x2={margin.l + innerW}
        y2={margin.top + innerH}
        stroke="rgba(248,250,252,0.14)"
      />

      {series.map((s, idx) => (
        <polyline
          key={idx}
          fill="none"
          stroke={s.stroke}
          strokeWidth={1.75}
          strokeLinejoin="round"
          strokeLinecap="round"
          strokeDasharray={s.dash}
          points={pointsFor(s.ys)}
        />
      ))}

      <line
        x1={phx}
        y1={margin.top}
        x2={phx}
        y2={margin.top + innerH}
        stroke="rgba(250,250,250,0.5)"
        strokeWidth={1.5}
        strokeDasharray="4 3"
      />

      {tickYs.map((tv, idx) => {
        const yy = yPx(tv);
        return (
          <text
            key={`yl-${idx}`}
            x={margin.l - 8}
            y={yy + 3}
            textAnchor="end"
            fill="rgba(203,213,225,0.72)"
            fontSize="9"
            fontFamily="ui-monospace, monospace"
          >
            {prettyAxis(tv)}
          </text>
        );
      })}
      <text
        x={margin.l}
        y={11}
        fill="rgba(226,232,240,0.88)"
        fontSize="10"
        fontWeight={600}
      >
        {yAxisCaption}
      </text>
      <text x={margin.l + 2} y={22} fill="rgba(203,213,225,0.55)" fontSize="9">
        ({yUnitSuffix})
      </text>

      <text
        x={margin.l}
        y={height - margin.bot + 16}
        fill="rgba(203,213,225,0.65)"
        fontSize="9"
        fontFamily="ui-monospace, monospace"
      >
        t = {formatElapsedLabel(t0)} s
      </text>
      <text
        x={margin.l + innerW / 2}
        y={height - margin.bot + 16}
        textAnchor="middle"
        fill="rgba(226,232,240,0.82)"
        fontSize="9"
      >
        simulation time →
      </text>
      <text
        x={margin.l + innerW}
        y={height - margin.bot + 16}
        textAnchor="end"
        fill="rgba(203,213,225,0.65)"
        fontSize="9"
        fontFamily="ui-monospace, monospace"
      >
        {formatElapsedLabel(t1)} s
      </text>

      {playheadValues.map((pv, idx) => {
        const cy = yPx(pv.value);
        return (
          <g key={pv.label}>
            <circle cx={phx} cy={cy} r={4.5} fill={pv.stroke} stroke="rgba(15,23,42,0.9)" strokeWidth={1} />
            <text
              x={Math.min(phx + 8, margin.l + innerW - 2)}
              y={cy - 6 - idx * 11}
              fill="rgba(248,250,252,0.92)"
              fontSize="9"
              fontFamily="ui-monospace, monospace"
            >
              {pv.label}={prettyAxis(pv.value)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Equal-scale Δx–Δy path; origin = position at recording start (frame 0). */
function RelativePathSvg({
  width,
  height,
  rel,
  highlightElapsedMs,
}: {
  width: number;
  height: number;
  rel: RelativeMotionPoint[];
  highlightElapsedMs: number;
}) {
  const patternUid = useId().replace(/:/g, "");
  const margin = { l: 56, r: 16, top: 44, bot: 52 };
  const innerW = width - margin.l - margin.r;
  const innerH = height - margin.top - margin.bot;

  let maxAbs = 0.04;
  for (const p of rel) {
    maxAbs = Math.max(maxAbs, Math.abs(p.dxM), Math.abs(p.dyM));
  }
  const span = maxAbs * 1.15;

  const cx = (dx: number) => margin.l + innerW / 2 + (dx / span) * (innerW / 2);
  const cy = (dy: number) => margin.top + innerH / 2 + (dy / span) * (innerH / 2);

  const pts = rel.map((p) => `${cx(p.dxM).toFixed(2)},${cy(p.dyM).toFixed(2)}`).join(" ");

  const hiIdx = timelineFindIndexAt(rel, highlightElapsedMs);
  const hp = rel[hiIdx]!;
  const hcx = cx(hp.dxM);
  const hcy = cy(hp.dyM);
  const distM = Math.hypot(hp.dxM, hp.dyM);

  const xTicks = symmetricTicks(span, 4);
  const yTicks = symmetricTicks(span, 4);

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="rounded-lg bg-black/55 outline outline-1 outline-white/[0.08]"
      role="img"
      aria-label="Position relative to start of recording"
    >
      <defs>
        <pattern
          id={`flux-rel-grid-${patternUid}`}
          width="20"
          height="20"
          patternUnits="userSpaceOnUse"
        >
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(248,250,252,0.05)" strokeWidth="1" />
        </pattern>
      </defs>
      <rect
        x={margin.l}
        y={margin.top}
        width={innerW}
        height={innerH}
        fill={`url(#flux-rel-grid-${patternUid})`}
      />

      <text
        x={width / 2}
        y={16}
        textAnchor="middle"
        fill="rgba(248,250,252,0.94)"
        fontSize="12"
        fontWeight={600}
      >
        Displacement from start (frame 0)
      </text>
      <text
        x={width / 2}
        y={30}
        textAnchor="middle"
        fill="rgba(203,213,225,0.62)"
        fontSize="9"
      >
        Equal scale · +y downward ({UNIT_SCALE_LABEL})
      </text>

      {/* Origin axes */}
      <line
        x1={margin.l}
        y1={cy(0)}
        x2={margin.l + innerW}
        y2={cy(0)}
        stroke="rgba(148,163,184,0.35)"
        strokeWidth={1}
      />
      <line
        x1={cx(0)}
        y1={margin.top}
        x2={cx(0)}
        y2={margin.top + innerH}
        stroke="rgba(148,163,184,0.35)"
        strokeWidth={1}
      />

      {xTicks.map((v) => {
        const lx = cx(v);
        if (Math.abs(v) < 1e-9) return null;
        return (
          <g key={`xt-${v}`}>
            <line
              x1={lx}
              y1={margin.top}
              x2={lx}
              y2={margin.top + innerH}
              stroke="rgba(248,250,252,0.04)"
            />
            <line
              x1={lx}
              y1={cy(0)}
              x2={lx}
              y2={cy(0) + 5}
              stroke="rgba(248,250,252,0.18)"
            />
            <text
              x={lx}
              y={height - margin.bot + 18}
              textAnchor="middle"
              fill="rgba(203,213,225,0.7)"
              fontSize="9"
              fontFamily="ui-monospace, monospace"
            >
              {prettyAxis(v)} m
            </text>
          </g>
        );
      })}

      {yTicks.map((v) => {
        const ly = cy(v);
        if (Math.abs(v) < 1e-9) return null;
        return (
          <g key={`yt-${v}`}>
            <line
              x1={margin.l}
              y1={ly}
              x2={margin.l + innerW}
              y2={ly}
              stroke="rgba(248,250,252,0.04)"
            />
            <line
              x1={margin.l - 5}
              y1={ly}
              x2={margin.l}
              y2={ly}
              stroke="rgba(248,250,252,0.18)"
            />
            <text
              x={margin.l - 8}
              y={ly + 3}
              textAnchor="end"
              fill="rgba(203,213,225,0.7)"
              fontSize="9"
              fontFamily="ui-monospace, monospace"
            >
              {prettyAxis(v)}
            </text>
          </g>
        );
      })}

      <text
        x={margin.l + innerW / 2}
        y={height - 10}
        textAnchor="middle"
        fill="rgba(148,163,184,0.75)"
        fontSize="10"
        fontWeight={500}
      >
        Δx (m)
      </text>
      <text
        x={12}
        y={margin.top + innerH / 2}
        textAnchor="middle"
        fill="rgba(148,163,184,0.75)"
        fontSize="10"
        fontWeight={500}
        transform={`rotate(-90 12 ${margin.top + innerH / 2})`}
      >
        Δy (m)
      </text>

      <polyline
        fill="none"
        stroke="#38bdf8"
        strokeWidth={2.25}
        strokeLinejoin="round"
        strokeLinecap="round"
        points={pts}
      />

      {/* Start */}
      <circle cx={cx(0)} cy={cy(0)} r={6} fill="rgba(52,211,153,0.35)" stroke="#34d399" strokeWidth={1.5} />
      <text x={cx(0) + 10} y={cy(0) - 8} fill="rgba(167,243,208,0.9)" fontSize="9">
        start
      </text>

      {/* Playhead */}
      <circle
        cx={hcx}
        cy={hcy}
        r={8}
        fill="rgba(251,191,36,0.92)"
        stroke="rgba(253,224,71,0.95)"
        strokeWidth={1.5}
      />

      <foreignObject x={margin.l + 4} y={margin.top + 4} width={innerW - 8} height={36}>
        <div className="rounded-md border border-white/10 bg-black/65 px-2 py-1 font-mono text-[9px] leading-snug text-flux-text">
          <span className="text-flux-muted">t </span>
          {(highlightElapsedMs / 1000).toFixed(2)} s
          <span className="mx-1.5 text-white/20">|</span>
          <span className="text-sky-200">Δx {hp.dxM >= 0 ? "+" : ""}{hp.dxM.toFixed(3)} m</span>
          <span className="mx-1 text-white/20">·</span>
          <span className="text-teal-200">Δy {hp.dyM >= 0 ? "+" : ""}{hp.dyM.toFixed(3)} m</span>
          <span className="mx-1 text-white/20">·</span>
          <span className="text-amber-100/95">|Δr| {distM.toFixed(3)} m</span>
        </div>
      </foreignObject>
    </svg>
  );
}

function ReviewReadoutCard({
  modeled,
  rel,
  highlightElapsedMs,
}: {
  modeled: SelectionTelemetrySample | null;
  rel: RelativeMotionPoint[];
  highlightElapsedMs: number;
}) {
  if (!modeled) {
    return (
      <div className="rounded-lg border border-white/12 bg-black/40 px-3 py-2.5">
        <p className="text-[11px] text-flux-muted">
          Select a movable body and record at least one playback step to graph motion.
        </p>
      </div>
    );
  }

  const hiIdx = rel.length > 0 ? timelineFindIndexAt(rel, highlightElapsedMs) : 0;
  const relPt = rel[hiIdx];
  const v = Math.hypot(modeled.vxMs, modeled.vyMs);
  const a = Math.hypot(modeled.axMs2, modeled.ayMs2);
  const distM = relPt ? Math.hypot(relPt.dxM, relPt.dyM) : 0;

  return (
    <div className="rounded-lg border border-sky-400/25 bg-gradient-to-br from-black/72 via-black/55 to-sky-950/25 px-3 py-2.5">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-flux-muted">
        At timeline head · t = {(modeled.elapsedMs / 1000).toFixed(2)} s
      </p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 font-mono text-[10px] sm:grid-cols-3">
        <div className="col-span-2 rounded-md border border-emerald-500/20 bg-emerald-950/20 px-2 py-1.5 sm:col-span-3">
          <p className="text-[9px] uppercase tracking-wide text-emerald-200/80">Relative to start</p>
          <p className="mt-0.5 text-flux-text">
            Δx = {relPt ? `${relPt.dxM >= 0 ? "+" : ""}${relPt.dxM.toFixed(3)}` : "—"} m · Δy ={" "}
            {relPt ? `${relPt.dyM >= 0 ? "+" : ""}${relPt.dyM.toFixed(3)}` : "—"} m · |Δr| ={" "}
            {relPt ? distM.toFixed(3) : "—"} m
          </p>
        </div>
        <p className="text-flux-muted">
          Lab x<span className="ml-1.5 text-flux-text">{modeled.xM.toFixed(3)} m</span>
        </p>
        <p className="text-flux-muted">
          Lab y<span className="ml-1.5 text-flux-text">{modeled.yM.toFixed(3)} m</span>
        </p>
        <p className="text-flux-muted">
          |v|<span className="ml-1.5 text-emerald-200/95">{formatSpeedMs(v)}</span>
        </p>
        <p className="text-flux-muted">
          vx, vy
          <span className="ml-1 text-[9px] text-flux-text">
            {modeled.vxMs.toFixed(2)}, {modeled.vyMs.toFixed(2)}
          </span>
        </p>
        <p className="text-flux-muted">
          |a|<span className="ml-1.5 text-amber-100/95">{a.toFixed(2)} m/s²</span>
        </p>
        <p className="text-flux-muted sm:col-span-2">
          Modeled |ΣF|
          <span className="ml-1.5 text-violet-200/95">{formatForceNMagnitudeAdaptive(modeled.rMagN)}</span>
        </p>
      </div>
      <p className="mt-2 border-t border-white/10 pt-2 text-[9px] leading-snug text-flux-muted">
        Trajectory and position charts use displacement from the first recorded frame so shape and
        distance read clearly. Lab coordinates are listed for absolute placement in the world.
      </p>
    </div>
  );
}

export function SimulationTelemetryCharts({
  bodyId,
  bodyMassMatter,
  historyLength,
  historyIndex,
  elapsedMsReview,
  simTick,
  isPlaying,
  playbackHighlight,
}: Props) {
  const [mode, setMode] = useState<GraphMode>("path");

  const timeline = useMemo(
    () => buildMotionTimelineSamplesForSelection(bodyId, historyLength, historyIndex),
    [bodyId, historyLength, historyIndex],
  );

  const rel = useMemo(() => relativeTimeline(timeline), [timeline]);

  const modeled = useMemo(() => {
    const state = useSimulationStore.getState();
    const collisions = state.getCollisions();
    const kinematicTail = timeline.length > 0 ? timeline[timeline.length - 1]! : undefined;
    return composeModeledTelemetrySample(state, collisions, bodyId, {
      kinematicTail,
      elapsedMsOverride: elapsedMsReview,
    });
  }, [bodyId, historyIndex, simTick, elapsedMsReview, timeline]);

  const massKg =
    typeof bodyMassMatter === "number" && Number.isFinite(bodyMassMatter) && bodyMassMatter > 0
      ? matterMassToKg(bodyMassMatter)
      : 0;

  const highVis = !!(playbackHighlight && isPlaying);
  const w = 360;
  const h = Math.max(272, highVis ? 304 : 284);
  const legendBase = highVis ? "text-flux-text" : "text-flux-muted";

  const timeSeriesConfig = useMemo(() => {
    if (timeline.length < 2) return null;

    let series: readonly { label: string; ys: readonly number[]; stroke: string; dash?: string }[] =
      [];
    let yUnitSuffix = "";
    let yAxisCaption = "";
    let legendPairs: { c: string; l: string }[] = [];

    switch (mode) {
      case "path":
        return null;
      case "position":
        series = [
          { label: "Δx", ys: rel.map((p) => p.dxM), stroke: "#38bdf8" },
          { label: "Δy", ys: rel.map((p) => p.dyM), stroke: "#2dd4bf", dash: "5 4" },
        ];
        yUnitSuffix = "m from start";
        yAxisCaption = "displacement";
        legendPairs = [
          { c: "#38bdf8", l: "Δx" },
          { c: "#2dd4bf", l: "Δy" },
        ];
        break;
      case "velocity":
        series = [
          { label: "vx", ys: timeline.map((p) => p.vxMs), stroke: "#34d399" },
          { label: "vy", ys: timeline.map((p) => p.vyMs), stroke: "#2dd4bf" },
        ];
        yUnitSuffix = "m/s";
        yAxisCaption = "velocity";
        legendPairs = [
          { c: "#34d399", l: "vx" },
          { c: "#2dd4bf", l: "vy" },
        ];
        break;
      case "accel":
        series = [
          { label: "ax", ys: timeline.map((p) => p.axMs2), stroke: "#fbbf24" },
          { label: "ay", ys: timeline.map((p) => p.ayMs2), stroke: "#fb923c", dash: "4 5" },
        ];
        yUnitSuffix = "m/s²";
        yAxisCaption = "acceleration";
        legendPairs = [
          { c: "#fbbf24", l: "ax" },
          { c: "#fb923c", l: "ay" },
        ];
        break;
      case "sigmaF": {
        series = [
          { label: "Fx", ys: timeline.map((p) => massKg * p.axMs2), stroke: "#fdba74" },
          { label: "Fy", ys: timeline.map((p) => massKg * p.ayMs2), stroke: "#c4b5fd", dash: "5 4" },
        ];
        yUnitSuffix = massKg <= 0 ? "N (needs mass)" : "N";
        yAxisCaption = "ΣF ≈ m·a";
        legendPairs = [
          { c: "#fdba74", l: "m·ax" },
          { c: "#c4b5fd", l: "m·ay" },
        ];
        break;
      }
    }

    return { series, yUnitSuffix, yAxisCaption, legendPairs };
  }, [timeline, rel, mode, massKg]);

  return (
    <div className={`flex flex-col gap-3 ${highVis ? "text-flux-text" : ""}`}>
      <div
        className={`grid grid-cols-2 gap-1 sm:grid-cols-3 ${highVis ? "rounded-xl p-1 ring-1 ring-emerald-500/25" : ""}`}
      >
        <ModeChip
          label="Path"
          hint="Δx vs Δy"
          active={mode === "path"}
          live={highVis && mode === "path"}
          onClick={() => setMode("path")}
        />
        <ModeChip
          label="Position"
          hint="Δx, Δy vs time"
          active={mode === "position"}
          live={highVis && mode === "position"}
          onClick={() => setMode("position")}
        />
        <ModeChip
          label="Velocity"
          hint="vx, vy"
          active={mode === "velocity"}
          live={highVis && mode === "velocity"}
          onClick={() => setMode("velocity")}
        />
        <ModeChip
          label="Accel"
          hint="Δv/Δt"
          active={mode === "accel"}
          live={highVis && mode === "accel"}
          onClick={() => setMode("accel")}
        />
        <ModeChip
          label="ΣF"
          hint="≈ m·a"
          active={mode === "sigmaF"}
          live={highVis && mode === "sigmaF"}
          onClick={() => setMode("sigmaF")}
        />
      </div>

      <ReviewReadoutCard modeled={modeled} rel={rel} highlightElapsedMs={elapsedMsReview} />

      {timeline.length < 2 && (
        <p className={`text-[11px] ${legendBase}/85`}>
          Press Play or step the timeline once — graphs need at least two recorded frames.
        </p>
      )}
      {!isPlaying && historyLength <= 1 && (
        <p className="text-[11px] text-flux-muted/85">
          Paused on setup — motion history appears after playback.
        </p>
      )}

      {timeline.length >= 2 && mode === "path" && (
        <RelativePathSvg width={w} height={h} rel={rel} highlightElapsedMs={elapsedMsReview} />
      )}

      {timeline.length >= 2 && timeSeriesConfig ? (
        <div className="flex flex-col gap-2">
          <TimeSeriesSvg
            width={w}
            height={h}
            timeline={timeline}
            highlightElapsedMs={elapsedMsReview}
            series={timeSeriesConfig.series}
            yUnitSuffix={timeSeriesConfig.yUnitSuffix}
            yAxisCaption={timeSeriesConfig.yAxisCaption}
          />
          <div className="flex flex-wrap gap-3 px-1 text-[10px] text-flux-text/85">
            {timeSeriesConfig.legendPairs.map((p) => (
              <span key={p.l} className="inline-flex items-center gap-1.5">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: p.c }}
                  aria-hidden
                />
                {p.l}
              </span>
            ))}
            {mode === "sigmaF" && massKg <= 0 ? (
              <span className="text-amber-200/90">Needs finite body mass.</span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
