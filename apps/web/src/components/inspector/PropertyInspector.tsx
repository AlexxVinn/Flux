"use client";

import { useCallback, useMemo } from "react";
import { useSimulationStore, usePrimarySelection, isAtSharedSetupFrame } from "@/store/simulationStore";
import { useCanWriteInRoom, useRoomSessionStore } from "@/store/roomSessionStore";
import { useRoomSceneCollaborationStore } from "@/store/roomSceneCollaborationStore";
import { ScrubNumField } from "./ScrubNumField";
import type { RopeSnapshot, SimBodySnapshot, SpringSnapshot } from "@/lib/physics/types";
import { FLUX_WORLD } from "@/lib/physics/worldSpace";
import {
  SPRING_ELASTIC_MAX_N_PER_M,
  SPRING_ELASTIC_MIN_N_PER_M,
  isRigidBarSpring,
} from "@/lib/physics/springDefaults";
import {
  UNIT_SCALE_LABEL,
  pxToM,
  mToPx,
  pxPerSecToMPerSec,
  mPerSecToPxPerSec,
  matterMassToKg,
  kgToMatterMass,
  matterDensityToKgM2,
  kgM2ToMatterDensity,
  kineticEnergyJ,
  formatSpeedMs,
} from "@/lib/physics/units";
import { collectBodyForceInspectNn } from "@/lib/physics/forceInspect";
import { markupDistanceM } from "@/lib/physics/sceneMarkups";
import { AppliedForcePanel } from "./AppliedForcePanel";
import { BodyFreeBodyDiagram } from "./BodyFreeBodyDiagram";
import { SimulationTelemetryCharts } from "./SimulationTelemetryCharts";
import { useRightPanelStore } from "@/store/rightPanelStore";
import {
  InspectorAlert,
  InspectorEmpty,
  InspectorForceList,
  InspectorHeader,
  InspectorHint,
  InspectorLinkList,
  InspectorRoot,
  InspectorScroll,
  InspectorSection,
  InspectorSegmented,
  InspectorStatBlock,
  InspectorToggle,
} from "./inspector-ui";

export function PropertyInspector() {
  const primaryId = usePrimarySelection();
  const simTick = useSimulationStore((s) => s.snapshot.tick);
  const snapshot = useSimulationStore((s) => s.snapshot);
  const selectedIds = useSimulationStore((s) => s.selectedIds);
  const isPlaying = useSimulationStore((s) => s.isPlaying);
  const historyIndex = useSimulationStore((s) => s.historyIndex);
  const historyLength = useSimulationStore((s) => s.historyLength);
  const elapsedMs = useSimulationStore((s) => s.elapsedMs);
  const gravityEnabled = useSimulationStore((s) => s.gravityEnabled);
  const toggleGravity = useSimulationStore((s) => s.toggleGravity);
  const updateBody = useSimulationStore((s) => s.updateBody);
  const setBodyShowTrajectory = useSimulationStore((s) => s.setBodyShowTrajectory);
  const updateSpring = useSimulationStore((s) => s.updateSpring);
  const updateRope = useSimulationStore((s) => s.updateRope);
  const activeTool = useSimulationStore((s) => s.activeTool);
  const inspectorTab = useRightPanelStore((s) => s.propertiesInspectorTab);
  const setInspectorTab = useRightPanelStore((s) => s.setPropertiesInspectorTab);
  const canWrite = useCanWriteInRoom();
  const roomSceneRoomId = useRoomSceneCollaborationStore((s) => s.roomId);
  const membership = useRoomSessionStore((s) => s.membership);
  const collaborative =
    !!membership?.roomId &&
    membership.roomId === roomSceneRoomId &&
    (membership.role === "admin" || membership.role === "member");
  const atSharedSetup = isAtSharedSetupFrame({ historyIndex, historyLength });
  const locked =
    isPlaying ||
    !canWrite ||
    (collaborative && !atSharedSetup);

  const forceInspectRows = useMemo(() => {
    const selBody = snapshot.bodies.find(
      (b) => b.id === primaryId && b.entityKind !== "ropeSegment",
    );
    if (!selBody?.visible) return [];
    const st = useSimulationStore.getState();
    return collectBodyForceInspectNn(snapshot, selBody.id, {
      gravityForBody: (id) => st.getGravityForce(id),
      appliedNn: st.getUserSustainedForcesNewtons(),
      contacts: st.getCollisions(),
      draftNn:
        st.activeTool === "force" && st.selectedIds[0] === selBody.id
          ? { fx: st.forceFxN, fy: st.forceFyN }
          : undefined,
    });
  }, [snapshot, primaryId, simTick, historyIndex]);

  const body = snapshot.bodies.find((b) => b.id === primaryId && b.entityKind !== "ropeSegment");
  const spring = snapshot.springs.find((s) => s.id === primaryId);
  const rope = (snapshot.ropes ?? []).find((r) => r.id === primaryId);
  const markup = (snapshot.markups ?? []).find((m) => m.id === primaryId);
  const updateSceneMarkup = useSimulationStore((s) => s.updateSceneMarkup);
  const setMeasureUnit = useSimulationStore((s) => s.setMeasureUnit);
  const setEntityLocked = useSimulationStore((s) => s.setEntityLocked);

  const preview = useCallback(
    (patch: Partial<SimBodySnapshot>) => {
      if (!primaryId || locked) return;
      updateBody(primaryId, patch, { commit: false });
    },
    [primaryId, locked, updateBody],
  );

  const commit = useCallback(
    (patch: Partial<SimBodySnapshot>, summary: string) => {
      if (!primaryId || locked) return;
      updateBody(primaryId, patch, { commit: true, summary });
    },
    [primaryId, locked, updateBody],
  );

  const previewSpring = useCallback(
    (
      patch: Partial<
        Pick<SpringSnapshot, "stiffness" | "damping" | "length" | "elasticConstantNnPerM">
      >,
    ) => {
      if (!primaryId || locked) return;
      updateSpring(primaryId, patch, { commit: false });
    },
    [primaryId, locked, updateSpring],
  );

  const commitSpring = useCallback(
    (
      patch: Partial<
        Pick<SpringSnapshot, "stiffness" | "damping" | "length" | "elasticConstantNnPerM">
      >,
      summary: string,
    ) => {
      if (!primaryId || locked) return;
      updateSpring(primaryId, patch, { commit: true, summary });
    },
    [primaryId, locked, updateSpring],
  );

  const previewRope = useCallback(
    (patch: Partial<Pick<RopeSnapshot, "linkStiffness" | "linkDamping">>) => {
      if (!primaryId || locked) return;
      updateRope(primaryId, patch, { commit: false });
    },
    [primaryId, locked, updateRope],
  );

  const commitRope = useCallback(
    (
      patch: Partial<Pick<RopeSnapshot, "linkStiffness" | "linkDamping">>,
      summary: string,
    ) => {
      if (!primaryId || locked) return;
      updateRope(primaryId, patch, { commit: true, summary });
    },
    [primaryId, locked, updateRope],
  );

  if (activeTool === "measure") {
    return (
      <InspectorEmpty
        icon="↔"
        title="Tape Measure"
        description="Readout and units are on the canvas dock at bottom-left. Drag to measure; press 9 to exit."
      />
    );
  }

  if (!primaryId) {
    return (
      <InspectorEmpty
        title="No selection"
        description="Click to select. Drag empty space to box-select. Shift adds; Ctrl removes. Drag selected bodies to move them together."
      />
    );
  }

  if (markup) {
    const kindLabel =
      markup.kind === "arrow" ? "Arrow" : markup.kind === "text" ? "Text label" : "Ruler";
    const distM = markup.kind !== "text" ? markupDistanceM(markup) : 0;
    const unit = markup.measureUnit ?? "m";

    return (
      <InspectorRoot locked={locked}>
        <InspectorHeader title={markup.displayName} subtitle={kindLabel} />
        <InspectorSection title="Markup" defaultOpen>
          <InspectorToggle
            label="Locked"
            checked={!!markup.locked}
            locked={locked}
            onChange={() => setEntityLocked(markup.id, !markup.locked)}
          />
          {markup.kind === "text" ? (
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-flux-muted">Text</span>
              <input
                type="text"
                className="inspector-input w-full"
                defaultValue={markup.text ?? "Note"}
                disabled={locked}
                onBlur={(e) => {
                  const t = e.target.value.trim() || "Note";
                  updateSceneMarkup(markup.id, { text: t });
                }}
              />
            </label>
          ) : null}
          {markup.kind === "measure" ? (
            <>
              <InspectorStatBlock>
                <p>
                  Length{" "}
                  {unit === "cm" ? `${(distM * 100).toFixed(1)} cm` : `${distM.toFixed(2)} m`}
                </p>
              </InspectorStatBlock>
              <InspectorSegmented
                ariaLabel="Ruler units"
                value={unit}
                onChange={(id) => {
                  setMeasureUnit(id as "m" | "cm");
                  updateSceneMarkup(markup.id, { measureUnit: id as "m" | "cm" });
                }}
                items={[
                  { id: "m", label: "m" },
                  { id: "cm", label: "cm" },
                ]}
              />
            </>
          ) : null}
          {markup.kind === "arrow" ? (
            <InspectorHint>Drag endpoints on canvas to reposition. Delete with Backspace.</InspectorHint>
          ) : null}
        </InspectorSection>
      </InspectorRoot>
    );
  }

  if (rope && !body) {
    const a = snapshot.bodies.find((b) => b.id === rope.bodyA);
    const b = snapshot.bodies.find((b) => b.id === rope.bodyB);

    return (
      <InspectorRoot locked={locked}>
        <InspectorHeader
          title={rope.displayName}
          subtitle={`Rope · ${rope.segmentCount} links`}
        >
          <InspectorLinkList
            items={[
              { label: "A →", value: a?.displayName ?? rope.bodyA },
              { label: "B →", value: b?.displayName ?? rope.bodyB },
            ]}
          />
          {isPlaying && (
            <InspectorAlert variant="info">
              Simulation running — pause to edit constraint values.
            </InspectorAlert>
          )}
        </InspectorHeader>
        <InspectorSection title="Rope" defaultOpen>
          <InspectorToggle
            label="Locked"
            checked={!!rope.locked}
            locked={locked}
            onChange={() => setEntityLocked(rope.id, !rope.locked)}
          />
          <ScrubNumField
            label="Link stiffness"
            value={rope.linkStiffness}
            step={0.001}
            min={0.001}
            max={1}
            decimals={3}
            locked={locked}
            onPreview={(linkStiffness) => previewRope({ linkStiffness })}
            onCommit={(linkStiffness) =>
              commitRope({ linkStiffness }, `Set ${rope.displayName} link stiffness`)
            }
          />
          <ScrubNumField
            label="Link damping"
            value={rope.linkDamping}
            step={0.001}
            min={0}
            max={1}
            decimals={3}
            locked={locked}
            onPreview={(linkDamping) => previewRope({ linkDamping })}
            onCommit={(linkDamping) =>
              commitRope({ linkDamping }, `Set ${rope.displayName} link damping`)
            }
          />
        </InspectorSection>
      </InspectorRoot>
    );
  }

  if (spring && !body) {
    const sa = snapshot.bodies.find((b) => b.id === spring.bodyA);
    const sb = snapshot.bodies.find((b) => b.id === spring.bodyB);
    const rigidBar = isRigidBarSpring(spring);

    return (
      <InspectorRoot locked={locked}>
        <InspectorHeader
          title={spring.displayName}
          subtitle={rigidBar ? "Rigid bar constraint" : "Spring constraint"}
        >
          <InspectorLinkList
            items={[
              { label: "A →", value: sa?.displayName ?? spring.bodyA },
              { label: "B →", value: sb?.displayName ?? spring.bodyB },
            ]}
          />
          {isPlaying && (
            <InspectorAlert variant="info">
              Simulation running — pause to edit constraint values.
            </InspectorAlert>
          )}
        </InspectorHeader>
        <InspectorSection title={rigidBar ? "Bar" : "Spring"} defaultOpen>
          <InspectorToggle
            label="Locked"
            checked={!!spring.locked}
            locked={locked}
            onChange={() => setEntityLocked(spring.id, !spring.locked)}
          />
          {!rigidBar && (
            <>
              <ScrubNumField
                label="Elastic k"
                unit="N/m"
                value={spring.elasticConstantNnPerM}
                step={5}
                decimals={0}
                min={SPRING_ELASTIC_MIN_N_PER_M}
                max={SPRING_ELASTIC_MAX_N_PER_M}
                locked={locked}
                onPreview={(elasticConstantNnPerM) =>
                  previewSpring({ elasticConstantNnPerM })
                }
                onCommit={(elasticConstantNnPerM) =>
                  commitSpring({ elasticConstantNnPerM }, `Set ${spring.displayName} elastic k`)
                }
              />
              <InspectorHint>
                |F| ≈ k·|ΔL| vs rest length. Matter stiffness is solver tuning from k unless overridden.
              </InspectorHint>
              <ScrubNumField
                label="Stiffness"
                value={spring.stiffness}
                step={0.001}
                min={0.001}
                max={1}
                decimals={3}
                locked={locked}
                onPreview={(stiffness) => previewSpring({ stiffness })}
                onCommit={(stiffness) =>
                  commitSpring({ stiffness }, `Set ${spring.displayName} stiffness`)
                }
              />
              <ScrubNumField
                label="Damping"
                value={spring.damping}
                step={0.001}
                min={0}
                max={1}
                decimals={3}
                locked={locked}
                onPreview={(damping) => previewSpring({ damping })}
                onCommit={(damping) =>
                  commitSpring({ damping }, `Set ${spring.displayName} damping`)
                }
              />
            </>
          )}
          <ScrubNumField
            label="Length"
            unit="m"
            value={pxToM(spring.length)}
            step={0.05}
            decimals={2}
            min={pxToM(20)}
            locked={locked}
            onPreview={(lengthM) => previewSpring({ length: mToPx(lengthM) })}
            onCommit={(lengthM) =>
              commitSpring({ length: mToPx(lengthM) }, `Set ${spring.displayName} rest length`)
            }
          />
        </InspectorSection>
      </InspectorRoot>
    );
  }

  if (!body) return null;

  const multi = selectedIds.length > 1;
  const fieldProps = { locked, decimals: 3 as number };
  const canResizeShape =
    body.entityKind !== "wall" &&
    body.entityKind !== "floor" &&
    (body.shape === "circle" || body.shape === "rectangle");
  const radius = body.width / 2;
  const isCollisionFrame = body.entityKind === "collisionBounds";
  const showGraphsTab = !isCollisionFrame && !body.isStatic;
  /** Graphs tab stays bright while playing so traces stay readable under read-only inspector state. */
  const detailsDimmed = locked && (!showGraphsTab || inspectorTab === "details");
  const inspectHeaderMuted = locked && (!showGraphsTab || inspectorTab === "details");

  return (
    <InspectorRoot locked={locked} className="min-h-0 flex-1">
      <div className={inspectHeaderMuted ? "opacity-[0.52]" : ""}>
        <InspectorHeader
          title={body.displayName}
          subtitle={`${isCollisionFrame ? "Collision frame" : body.entityKind}${multi ? ` · +${selectedIds.length - 1} selected` : ""}`}
          badge={body.isStatic ? "Static" : undefined}
        >
          {isCollisionFrame && (
            <InspectorAlert variant="info">
              Replaces world edge walls. Delete to restore{" "}
              {pxToM(FLUX_WORLD.WIDTH).toFixed(0)}×{pxToM(FLUX_WORLD.HEIGHT).toFixed(0)} m bounds.
            </InspectorAlert>
          )}
          {isPlaying && (!showGraphsTab || inspectorTab !== "graphs") && (
            <InspectorAlert variant="info">
              Simulation running — values read-only. Open Graphs for live traces.
            </InspectorAlert>
          )}
          {showGraphsTab && isPlaying && inspectorTab === "graphs" && (
            <InspectorAlert variant="success">
              Live playback — graphs follow the recorder; scrub shows frame-accurate values.
            </InspectorAlert>
          )}
          {!canWrite && !isPlaying && (
            <InspectorAlert variant="warn">Spectator view — read only.</InspectorAlert>
          )}
        </InspectorHeader>
      </div>

      {showGraphsTab ? (
        <InspectorSegmented
          ariaLabel="Property inspector tabs"
          value={inspectorTab}
          onChange={(id) => setInspectorTab(id as "details" | "graphs")}
          liveId="graphs"
          items={[
            { id: "details", label: "Inspect" },
            { id: "graphs", label: "Graphs", live: isPlaying },
          ]}
        />
      ) : null}

      <InspectorScroll>
        <div className={detailsDimmed ? "opacity-[0.52]" : ""}>
        {showGraphsTab && inspectorTab === "graphs" ? (
          <div className="pb-1">
            <SimulationTelemetryCharts
              bodyId={body.id}
              bodyMassMatter={body.mass}
              historyLength={historyLength}
              historyIndex={historyIndex}
              elapsedMsReview={elapsedMs}
              simTick={simTick}
              isPlaying={isPlaying}
              playbackHighlight
            />
          </div>
        ) : (
          <>
            <InspectorSection title="Transform" defaultOpen>
                <ScrubNumField
                  label="X"
                  unit="m"
                  value={pxToM(body.x)}
                  step={0.05}
                  decimals={2}
                  locked={locked}
                  onPreview={(xM) => preview({ x: mToPx(xM), y: body.y })}
                  onCommit={(xM) =>
                    commit({ x: mToPx(xM), y: body.y }, `Set ${body.displayName} position X`)
                  }
                />
                <ScrubNumField
                  label="Y"
                  unit="m"
                  value={pxToM(body.y)}
                  step={0.05}
                  decimals={2}
                  locked={locked}
                  onPreview={(yM) => preview({ x: body.x, y: mToPx(yM) })}
                  onCommit={(yM) =>
                    commit({ x: body.x, y: mToPx(yM) }, `Set ${body.displayName} position Y`)
                  }
                />
              {!isCollisionFrame && (
                <ScrubNumField
                  label="Angle"
                  unit="rad"
                  value={body.angle}
                  step={0.01}
                  locked={locked}
                  onPreview={(angle) => preview({ angle })}
                  onCommit={(angle) => commit({ angle }, `Set ${body.displayName} angle`)}
                />
              )}
            </InspectorSection>

            {canResizeShape && (
              <InspectorSection title="Dimensions" defaultOpen>
                {body.shape === "circle" ? (
                  <ScrubNumField
                    label="Radius"
                    unit="m"
                    value={pxToM(radius)}
                    step={0.05}
                    decimals={2}
                    min={pxToM(4)}
                    locked={locked}
                    onPreview={(rM) => {
                      const d = mToPx(rM) * 2;
                      preview({ width: d, height: d });
                    }}
                    onCommit={(rM) => {
                      const d = mToPx(rM) * 2;
                      commit({ width: d, height: d }, `Set ${body.displayName} radius`);
                    }}
                  />
                ) : (
                  <>
                    <ScrubNumField
                      label="Width"
                      unit="m"
                      value={pxToM(body.width)}
                      step={0.05}
                      decimals={2}
                      min={pxToM(isCollisionFrame ? 64 : 8)}
                      locked={locked}
                      onPreview={(widthM) => preview({ width: mToPx(widthM), height: body.height })}
                      onCommit={(widthM) =>
                        commit(
                          { width: mToPx(widthM), height: body.height },
                          `Set ${body.displayName} width`,
                        )
                      }
                    />
                    <ScrubNumField
                      label="Height"
                      unit="m"
                      value={pxToM(body.height)}
                      step={0.05}
                      decimals={2}
                      min={pxToM(isCollisionFrame ? 64 : 8)}
                      locked={locked}
                      onPreview={(heightM) =>
                        preview({ width: body.width, height: mToPx(heightM) })
                      }
                      onCommit={(heightM) =>
                        commit(
                          { width: body.width, height: mToPx(heightM) },
                          `Set ${body.displayName} height`,
                        )
                      }
                    />
                  </>
                )}
              </InspectorSection>
            )}

            {!body.isStatic && (
              <>
                <InspectorSection title="Motion" defaultOpen>
                    <ScrubNumField
                      label="Vx"
                      unit="m/s"
                      value={pxPerSecToMPerSec(body.velocityX)}
                      step={0.05}
                      {...fieldProps}
                      onPreview={(vxMs) => preview({ velocityX: mPerSecToPxPerSec(vxMs) })}
                      onCommit={(vxMs) =>
                        commit(
                          { velocityX: mPerSecToPxPerSec(vxMs) },
                          `Set ${body.displayName} velocity X`,
                        )
                      }
                    />
                    <ScrubNumField
                      label="Vy"
                      unit="m/s"
                      value={pxPerSecToMPerSec(body.velocityY)}
                      step={0.05}
                      {...fieldProps}
                      onPreview={(vyMs) => preview({ velocityY: mPerSecToPxPerSec(vyMs) })}
                      onCommit={(vyMs) =>
                        commit(
                          { velocityY: mPerSecToPxPerSec(vyMs) },
                          `Set ${body.displayName} velocity Y`,
                        )
                      }
                    />
                  <ScrubNumField
                    label="ω"
                    unit="rad/s"
                    value={body.angularVelocity}
                    step={0.05}
                    {...fieldProps}
                    onPreview={(angularVelocity) => preview({ angularVelocity })}
                    onCommit={(angularVelocity) =>
                      commit({ angularVelocity }, `Set ${body.displayName} angular velocity`)
                    }
                  />
                </InspectorSection>

                <InspectorSection title="Material" defaultOpen>
                  <ScrubNumField
                    label="Mass"
                    unit="kg"
                    value={matterMassToKg(body.mass)}
                    step={0.01}
                    min={0.001}
                    locked={locked}
                    onPreview={(massKg) => preview({ mass: kgToMatterMass(massKg) })}
                    onCommit={(massKg) =>
                      commit({ mass: kgToMatterMass(massKg) }, `Set ${body.displayName} mass`)
                    }
                  />
                  <ScrubNumField
                    label="Density"
                    unit="kg/m²"
                    value={matterDensityToKgM2(body.density)}
                    step={0.01}
                    min={0}
                    locked={locked}
                    onPreview={(densityKgM2) => preview({ density: kgM2ToMatterDensity(densityKgM2) })}
                    onCommit={(densityKgM2) =>
                      commit(
                        { density: kgM2ToMatterDensity(densityKgM2) },
                        `Set ${body.displayName} density`,
                      )
                    }
                  />
                  <ScrubNumField
                    label="Restitution"
                    value={body.restitution}
                    step={0.05}
                    min={0}
                    max={1}
                    locked={locked}
                    onPreview={(restitution) => preview({ restitution })}
                    onCommit={(restitution) =>
                      commit({ restitution }, `Set ${body.displayName} restitution`)
                    }
                  />
                  <ScrubNumField
                    label="Friction"
                    value={body.friction}
                    step={0.05}
                    min={0}
                    max={1}
                    locked={locked}
                    onPreview={(friction) => preview({ friction })}
                    onCommit={(friction) => commit({ friction }, `Set ${body.displayName} friction`)}
                  />
                  <ScrubNumField
                    label="Static μ"
                    value={body.frictionStatic}
                    step={0.05}
                    min={0}
                    max={1}
                    locked={locked}
                    onPreview={(frictionStatic) => preview({ frictionStatic })}
                    onCommit={(frictionStatic) =>
                      commit({ frictionStatic }, `Set ${body.displayName} static friction`)
                    }
                  />
                  <ScrubNumField
                    label="Air drag"
                    value={body.frictionAir}
                    step={0.001}
                    min={0}
                    locked={locked}
                    onPreview={(frictionAir) => preview({ frictionAir })}
                    onCommit={(frictionAir) =>
                      commit({ frictionAir }, `Set ${body.displayName} air drag`)
                    }
                  />
                  <ScrubNumField
                    label="Sleep thr."
                    value={body.sleepThreshold}
                    step={0.5}
                    min={0}
                    locked={locked}
                    onPreview={(sleepThreshold) => preview({ sleepThreshold })}
                    onCommit={(sleepThreshold) =>
                      commit({ sleepThreshold }, `Set ${body.displayName} sleep threshold`)
                    }
                  />
                </InspectorSection>

                <InspectorSection title="Forces" defaultOpen>
                  <ScrubNumField
                    label="Gravity scale"
                    value={body.gravityScale}
                    step={0.1}
                    min={0}
                    max={3}
                    locked={locked || !gravityEnabled}
                    onPreview={(gravityScale) => preview({ gravityScale })}
                    onCommit={(gravityScale) =>
                      commit({ gravityScale }, `Set ${body.displayName} gravity scale`)
                    }
                  />
                  <InspectorToggle
                    label="Global gravity"
                    checked={gravityEnabled}
                    locked={locked}
                    onChange={toggleGravity}
                  />
                </InspectorSection>

                {forceInspectRows.length > 0 && (
                  <InspectorSection title="Force breakdown" defaultOpen>
                    <InspectorHint>
                      Canvas labels show tag + magnitude; full Fx·Fy detail here while selected.
                    </InspectorHint>
                    <InspectorForceList rows={forceInspectRows} />
                  </InspectorSection>
                )}

                {activeTool === "force" && (
                  <AppliedForcePanel body={body} canApply={canWrite && !body.isStatic} />
                )}

                <InspectorStatBlock>
                  <p>
                    Speed{" "}
                    {formatSpeedMs(
                      Math.hypot(
                        pxPerSecToMPerSec(body.velocityX),
                        pxPerSecToMPerSec(body.velocityY),
                      ),
                    )}
                  </p>
                  <p>
                    KE{" "}
                    {kineticEnergyJ(
                      matterMassToKg(body.mass),
                      pxPerSecToMPerSec(body.velocityX),
                      pxPerSecToMPerSec(body.velocityY),
                    ).toFixed(2)}{" "}
                    J
                  </p>
                  <p className="mt-1 opacity-70">{UNIT_SCALE_LABEL}</p>
                  {body.isSleeping && <p className="text-sky-400/90">Sleeping</p>}
                </InspectorStatBlock>
              </>
            )}

            {!isCollisionFrame && (
              <InspectorSection title="Object flags" defaultOpen>
                <InspectorToggle
                  label="Locked"
                  checked={!!body.locked}
                  locked={locked}
                  onChange={() => setEntityLocked(body.id, !body.locked)}
                />
                <InspectorToggle
                  label="Static body"
                  checked={body.isStatic}
                  locked={locked}
                  onChange={() => commit({ isStatic: !body.isStatic }, `Set ${body.displayName} static`)}
                />
              </InspectorSection>
            )}

            {!isCollisionFrame && !body.isStatic && (
              <InspectorSection title="Review" defaultOpen>
                <InspectorToggle
                  label="Show trajectory"
                  checked={body.showTrajectory ?? false}
                  locked={!canWrite}
                  onChange={() =>
                    setBodyShowTrajectory(primaryId!, !(body.showTrajectory ?? false))
                  }
                  description="Dashed path from frame 0 through the current timeline position."
                />
              </InspectorSection>
            )}

            {!isCollisionFrame && forceInspectRows.length > 0 && (
              <InspectorSection title="Free-body diagram" defaultOpen={false}>
                <div className="px-2 pb-2">
                  <BodyFreeBodyDiagram body={body} rows={forceInspectRows} />
                </div>
              </InspectorSection>
            )}
          </>
        )}
        </div>
      </InspectorScroll>
    </InspectorRoot>
  );
}
