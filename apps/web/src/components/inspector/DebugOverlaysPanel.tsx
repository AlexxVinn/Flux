"use client";

import { useSimulationStore } from "@/store/simulationStore";
import type { DebugFlags } from "@/lib/physics/debugTypes";

const GROUPS: { title: string; items: { key: keyof DebugFlags; label: string }[] }[] = [
  {
    title: "Vectors",
    items: [
      { key: "velocityVectors", label: "Velocity" },
      { key: "gravityVectors", label: "Gravity / weight" },
      { key: "forceVectors", label: "Vector labels" },
    ],
  },
  {
    title: "Collisions",
    items: [
      { key: "collisionContacts", label: "Contact points" },
      { key: "collisionNormals", label: "Contact normals" },
    ],
  },
  {
    title: "Bodies",
    items: [
      { key: "centerOfMass", label: "Center of mass" },
      { key: "aabbBounds", label: "AABB bounds" },
      { key: "sleepingBodies", label: "Sleeping highlight" },
    ],
  },
  {
    title: "Constraints",
    items: [
      { key: "springLinks", label: "Spring links" },
      { key: "springTension", label: "Spring tension" },
    ],
  },
  {
    title: "Scene",
    items: [{ key: "grid", label: "Grid" }],
  },
];

export function DebugOverlaysPanel({ bare = false }: { bare?: boolean }) {
  const debug = useSimulationStore((s) => s.debug);
  const toggleDebug = useSimulationStore((s) => s.toggleDebug);

  return (
    <section className={bare ? "px-2 py-1" : "border-b border-flux-border px-2 py-2"}>
      {!bare && (
        <h3 className="mb-1.5 px-1 text-[9px] font-semibold uppercase tracking-widest text-flux-muted">
          Debug overlays
        </h3>
      )}
      <div className="flex flex-col gap-2">
        {GROUPS.map((g) => (
          <div key={g.title}>
            <p className="mb-0.5 px-1 text-[8px] font-medium uppercase text-flux-muted/80">
              {g.title}
            </p>
            <ul className="flex flex-col gap-0.5">
              {g.items.map(({ key, label }) => (
                <li key={key}>
                  <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-[11px] text-flux-text hover:bg-white/5">
                    <input
                      type="checkbox"
                      checked={debug[key]}
                      onChange={() => toggleDebug(key)}
                      className="h-3 w-3 shrink-0 rounded border-flux-border bg-flux-bg accent-[var(--flux-accent,#6ee7b7)]"
                    />
                    {label}
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
