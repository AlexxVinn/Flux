"use client";

import { useSimulationStore } from "@/store/simulationStore";
import { ScrubNumField } from "./ScrubNumField";
import type { SimBodySnapshot } from "@/lib/physics/types";
import {
  InspectorButton,
  InspectorButtonRow,
  InspectorHint,
  InspectorSection,
  InspectorSegmented,
} from "./inspector-ui";

interface AppliedForcePanelProps {
  body: SimBodySnapshot;
  canApply: boolean;
}

export function AppliedForcePanel({ body, canApply }: AppliedForcePanelProps) {
  const forceMode = useSimulationStore((s) => s.forceMode);
  const forceFxN = useSimulationStore((s) => s.forceFxN);
  const forceFyN = useSimulationStore((s) => s.forceFyN);
  const setForceDraft = useSimulationStore((s) => s.setForceDraft);
  const applyForceToSelection = useSimulationStore((s) => s.applyForceToSelection);
  const clearSustainedForces = useSimulationStore((s) => s.clearSustainedForces);
  const sustainedForcesActive = useSimulationStore((s) => s.sustainedForcesActive);

  return (
    <InspectorSection title="Applied force" defaultOpen>
      <InspectorHint>
        Set Fx / Fy in newtons, then apply to the selected body.
      </InspectorHint>
      <div className="px-2 pb-1">
        <InspectorSegmented
          ariaLabel="Force application mode"
          value={forceMode}
          onChange={(id) => setForceDraft({ forceMode: id as "impulse" | "sustained" })}
          items={[
            { id: "impulse", label: "Impulse" },
            { id: "sustained", label: "Sustained" },
          ]}
        />
      </div>
      <ScrubNumField
        label="Fx"
        unit="N"
        value={forceFxN}
        step={1}
        locked={!canApply}
        onPreview={(fx) => setForceDraft({ forceFxN: fx })}
        onCommit={(fx) => setForceDraft({ forceFxN: fx })}
      />
      <ScrubNumField
        label="Fy"
        unit="N"
        value={forceFyN}
        step={1}
        locked={!canApply}
        onPreview={(fy) => setForceDraft({ forceFyN: fy })}
        onCommit={(fy) => setForceDraft({ forceFyN: fy })}
      />
      <InspectorButtonRow>
        <InspectorButton
          variant="primary"
          disabled={!canApply}
          className="flex-1"
          onClick={() => applyForceToSelection()}
        >
          Apply to {body.displayName}
        </InspectorButton>
        {sustainedForcesActive && (
          <InspectorButton
            variant="ghost"
            disabled={!canApply}
            onClick={() => clearSustainedForces()}
          >
            Clear sustained
          </InspectorButton>
        )}
      </InspectorButtonRow>
    </InspectorSection>
  );
}
