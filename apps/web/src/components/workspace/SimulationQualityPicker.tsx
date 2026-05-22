"use client";

import { useSimulationStore } from "@/store/simulationStore";
import type { SimulationQualityMode } from "@/lib/physics/simulationQuality";

const MODES: { id: SimulationQualityMode; label: string; short: string }[] = [
  { id: "standard", label: "Standard", short: "Std" },
  { id: "high", label: "High", short: "Hi" },
  { id: "max", label: "Max", short: "Max" },
];

export function SimulationQualityPicker({
  compact = false,
}: {
  /** Shorter labels for timeline / narrow layouts. */
  compact?: boolean;
}) {
  const simQuality = useSimulationStore((s) => s.simQuality);
  const setSimulationQuality = useSimulationStore((s) => s.setSimulationQuality);

  return (
    <div
      role="radiogroup"
      aria-label="Simulation quality"
      className={
        compact
          ? "flex shrink-0 items-center gap-0.5 rounded-lg border border-white/[0.08] bg-black/50 p-0.5"
          : "pointer-events-auto rounded-lg border border-white/[0.08] bg-black/58 px-2 py-1.5 shadow-lg backdrop-blur-sm"
      }
      onPointerDown={(e) => e.stopPropagation()}
    >
      {!compact && (
        <div className="mb-1 font-mono text-[9px] font-medium uppercase tracking-wide text-white/36">
          Quality
        </div>
      )}
      <div className="flex gap-px rounded-md bg-white/[0.05] p-px">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={simQuality === m.id}
            aria-label={m.label}
            onClick={() => simQuality !== m.id && setSimulationQuality(m.id)}
            className={`min-h-[32px] rounded-[5px] px-2 py-1 font-mono text-[10px] font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-white/35 ${
              simQuality === m.id
                ? m.id === "max"
                  ? "bg-violet-500/22 text-violet-100"
                  : m.id === "high"
                    ? "bg-emerald-500/18 text-emerald-100"
                    : "bg-white/[0.12] text-white/92"
                : "text-white/45 active:bg-white/[0.08]"
            }`}
          >
            {compact ? m.short : m.label}
          </button>
        ))}
      </div>
    </div>
  );
}
