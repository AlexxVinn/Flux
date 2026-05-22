"use client";

import { useSimulationStore } from "@/store/simulationStore";

const METERS_PER_PIXEL = 0.01;

/** Compact tape-measure readout for the canvas dock (spawn tool 9). */
export function TapeMeasureHud() {
  const measureStart = useSimulationStore((s) => s.measureStart);
  const measureEnd = useSimulationStore((s) => s.measureEnd);
  const measureUnit = useSimulationStore((s) => s.measureUnit);
  const setMeasureUnit = useSimulationStore((s) => s.setMeasureUnit);

  const hasLine = measureStart != null && measureEnd != null;
  const dx = hasLine ? measureEnd.x - measureStart.x : 0;
  const dy = hasLine ? measureEnd.y - measureStart.y : 0;
  const distM = hasLine ? Math.hypot(dx, dy) * METERS_PER_PIXEL : 0;
  const displayVal = measureUnit === "cm" ? distM * 100 : distM;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="rounded-md border border-white/[0.06] bg-black/40 px-2 py-1.5 font-mono text-[10px] leading-snug">
        <p className="flex justify-between gap-2 text-white/45">
          <span>Length</span>
          <span className="font-semibold tabular-nums text-emerald-400/95">
            {hasLine ? `${displayVal.toFixed(measureUnit === "cm" ? 1 : 2)} ${measureUnit}` : "—"}
          </span>
        </p>
        <p className="mt-1 flex justify-between gap-2 text-white/30">
          <span>Δx</span>
          <span className="tabular-nums text-white/55">
            {hasLine ? `${(dx * METERS_PER_PIXEL).toFixed(2)} m` : "—"}
          </span>
        </p>
        <p className="flex justify-between gap-2 text-white/30">
          <span>Δy</span>
          <span className="tabular-nums text-white/55">
            {hasLine ? `${(dy * METERS_PER_PIXEL).toFixed(2)} m` : "—"}
          </span>
        </p>
      </div>
      <div className="flex items-center justify-between gap-1 rounded-md border border-white/[0.06] bg-black/40 px-1 py-0.5">
        <span className="px-1 text-[8px] uppercase tracking-wide text-white/28">Unit</span>
        <div className="flex gap-px">
          {(["m", "cm"] as const).map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => setMeasureUnit(u)}
              className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold transition ${
                measureUnit === u
                  ? "bg-emerald-500/20 text-emerald-300"
                  : "text-white/35 hover:bg-white/[0.06] hover:text-white/65"
              }`}
            >
              {u}
            </button>
          ))}
        </div>
      </div>
      <p className="px-0.5 text-center text-[8px] leading-snug text-white/25">
        Drag on canvas to measure
      </p>
    </div>
  );
}
