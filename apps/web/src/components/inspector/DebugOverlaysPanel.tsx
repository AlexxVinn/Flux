"use client";

import { useSimulationStore } from "@/store/simulationStore";
import type { DebugFlags } from "@/lib/physics/debugTypes";
import { UNIT_SCALE_LABEL } from "@/lib/physics/units";
import { InspectorCheckbox, InspectorHint, InspectorSection } from "./inspector-ui";

const GROUPS: { title: string; items: { key: keyof DebugFlags; label: string }[] }[] = [
  {
    title: "Vectors",
    items: [
      { key: "forceLabels", label: "Magnitude labels" },
      { key: "forceVectors", label: "Force vectors" },
      { key: "gravityVectors", label: "Gravity" },
      { key: "appliedForces", label: "Applied forces" },
      { key: "velocityVectors", label: "Velocity" },
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
      { key: "sleepingBodies", label: "Sleeping bodies" },
    ],
  },
  {
    title: "Constraints",
    items: [
      { key: "springLinks", label: "Spring links" },
      { key: "springTension", label: "Spring tension" },
      { key: "springElasticAmbient", label: "Elastic arrows" },
    ],
  },
  {
    title: "Scene",
    items: [{ key: "grid", label: "World grid" }],
  },
];

export function DebugOverlaysPanel({ bare = false }: { bare?: boolean }) {
  const debug = useSimulationStore((s) => s.debug);
  const toggleDebug = useSimulationStore((s) => s.toggleDebug);

  const content = (
    <>
      {GROUPS.map((g) => (
        <InspectorSection key={g.title} title={g.title} defaultOpen={g.title === "Vectors"}>
          {g.items.map(({ key, label }) => (
            <InspectorCheckbox
              key={key}
              label={label}
              checked={!!debug[key]}
              onChange={() => toggleDebug(key)}
            />
          ))}
        </InspectorSection>
      ))}
      {debug.grid && (
        <InspectorHint>Major grid lines every 5 m ({UNIT_SCALE_LABEL}).</InspectorHint>
      )}
    </>
  );

  if (bare) {
    return <div className="inspector-panel-body">{content}</div>;
  }

  return <section className="inspector-panel-body">{content}</section>;
}
