"use client";

import { useState } from "react";
import { FORCE_LEGEND_ROWS } from "@/lib/physics/forceLegendMeta";

export function ForceLegendHud() {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="pointer-events-auto w-full rounded-lg border border-white/[0.08] bg-black/75 p-2.5 shadow-lg backdrop-blur-md"
      onPointerDown={(e) => e.stopPropagation()}
      aria-label="Force vector legend"
    >
      <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-1.5">
        <div className="min-w-0">
          <p className="font-mono text-[9px] font-medium uppercase tracking-[0.14em] text-white/40">
            Forces
          </p>
          <p className="mt-0.5 text-[10px] leading-snug text-white/55">
            Vector colors on canvas
          </p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] text-white/40 transition hover:bg-white/[0.06] hover:text-white/75"
        >
          {expanded ? "Hide" : "Show"}
        </button>
      </div>

      {expanded && (
        <>
          <ul className="mt-2 flex flex-col gap-1">
            {FORCE_LEGEND_ROWS.map((row) => (
              <li
                key={row.id}
                className="flex items-center gap-2 rounded-md border border-transparent bg-white/[0.02] px-1.5 py-1 transition hover:border-white/[0.06] hover:bg-white/[0.05]"
              >
                <span
                  className="flex h-6 min-w-[1.75rem] shrink-0 items-center justify-center rounded font-mono text-[9px] font-bold leading-none"
                  style={{
                    color: row.color,
                    backgroundColor: `${row.color}18`,
                    boxShadow: `0 0 10px ${row.glow}`,
                  }}
                >
                  {row.tag}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[10.5px] font-medium leading-tight text-white/88">{row.label}</p>
                  <p className="text-[9px] leading-snug text-white/42">{row.detail}</p>
                </div>
                <span
                  className="h-2 w-2 shrink-0 rounded-full ring-1 ring-white/15"
                  style={{ backgroundColor: row.color }}
                  aria-hidden
                />
              </li>
            ))}
          </ul>
          <p className="mt-2 border-t border-white/[0.06] pt-1.5 font-mono text-[8px] leading-snug text-white/32">
            Magnitudes in newtons (N) · velocities in m/s
          </p>
        </>
      )}
    </div>
  );
}
