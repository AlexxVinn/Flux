"use client";

import { useCallback } from "react";
import { useSimulationStore, usePrimarySelection, isAtSharedSetupFrame } from "@/store/simulationStore";
import { useCanWriteInRoom, useRoomSessionStore } from "@/store/roomSessionStore";
import { useRoomSceneCollaborationStore } from "@/store/roomSceneCollaborationStore";
import { ScrubNumField } from "./ScrubNumField";
import type { SimBodySnapshot, SpringSnapshot } from "@/lib/physics/types";
import { FLUX_WORLD } from "@/lib/physics/worldSpace";

function Toggle({
  label,
  checked,
  locked,
  onChange,
}: {
  label: string;
  checked: boolean;
  locked?: boolean;
  onChange: () => void;
}) {
  return (
    <label
      className={`flex items-center justify-between gap-2 text-[11px] ${
        locked ? "cursor-default opacity-50" : "cursor-pointer"
      }`}
    >
      <span className="text-flux-muted">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={locked}
        onClick={() => !locked && onChange()}
        className={`relative h-4 w-7 shrink-0 rounded-full transition ${
          checked ? "bg-flux-text" : "bg-flux-elevated"
        } disabled:opacity-40`}
      >
        <span
          className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition ${
            checked ? "left-3.5" : "left-0.5"
          }`}
        />
      </button>
    </label>
  );
}

export function PropertyInspector() {
  const primaryId = usePrimarySelection();
  const snapshot = useSimulationStore((s) => s.snapshot);
  const selectedIds = useSimulationStore((s) => s.selectedIds);
  const isPlaying = useSimulationStore((s) => s.isPlaying);
  const historyIndex = useSimulationStore((s) => s.historyIndex);
  const historyLength = useSimulationStore((s) => s.historyLength);
  const gravityEnabled = useSimulationStore((s) => s.gravityEnabled);
  const toggleGravity = useSimulationStore((s) => s.toggleGravity);
  const updateBody = useSimulationStore((s) => s.updateBody);
  const updateSpring = useSimulationStore((s) => s.updateSpring);
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

  const body = snapshot.bodies.find((b) => b.id === primaryId);
  const spring = snapshot.springs.find((s) => s.id === primaryId);

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
    (patch: Partial<Pick<SpringSnapshot, "stiffness" | "damping" | "length">>) => {
      if (!primaryId || locked) return;
      updateSpring(primaryId, patch, { commit: false });
    },
    [primaryId, locked, updateSpring],
  );

  const commitSpring = useCallback(
    (
      patch: Partial<Pick<SpringSnapshot, "stiffness" | "damping" | "length">>,
      summary: string,
    ) => {
      if (!primaryId || locked) return;
      updateSpring(primaryId, patch, { commit: true, summary });
    },
    [primaryId, locked, updateSpring],
  );

  if (!primaryId) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-dashed border-flux-border bg-flux-elevated/50 text-lg text-flux-muted">
          ◇
        </div>
        <p className="text-xs font-medium text-flux-text">No selection</p>
        <p className="max-w-[220px] text-[11px] leading-relaxed text-flux-muted">
          Click an object on the canvas or in Layers. Hold Ctrl/Cmd to multi-select,
          Shift for range.
        </p>
      </div>
    );
  }

  if (spring && !body) {
    const a = snapshot.bodies.find((b) => b.id === spring.bodyA);
    const b = snapshot.bodies.find((b) => b.id === spring.bodyB);

    return (
      <div
        className={`flex flex-col gap-3 px-2 py-2 transition-opacity ${
          locked ? "opacity-[0.52]" : ""
        }`}
      >
        <div>
          <p className="font-mono text-xs font-medium text-flux-text">{spring.displayName}</p>
          <p className="text-[10px] text-flux-muted">Spring constraint</p>
          <div className="mt-2 rounded-md border border-flux-border/60 bg-black/25 px-2 py-1.5 font-mono text-[10px] text-flux-muted">
            <p>A → {a?.displayName ?? spring.bodyA}</p>
            <p>B → {b?.displayName ?? spring.bodyB}</p>
          </div>
          {isPlaying && (
            <p className="mt-2 rounded-md border border-flux-border/60 bg-black/30 px-2 py-1.5 text-[10px] leading-snug text-flux-muted">
              Simulation running — values are read-only. Pause to edit.
            </p>
          )}
        </div>

        <fieldset className="flex flex-col gap-1.5" disabled={locked}>
          <legend className="mb-0.5 text-[8px] font-semibold uppercase tracking-widest text-flux-muted">
            Spring
          </legend>
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
          <ScrubNumField
            label="Length"
            unit="px"
            value={spring.length}
            step={1}
            decimals={0}
            min={20}
            locked={locked}
            onPreview={(length) => previewSpring({ length })}
            onCommit={(length) =>
              commitSpring({ length }, `Set ${spring.displayName} rest length`)
            }
          />
        </fieldset>
      </div>
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

  return (
    <div
      className={`flex flex-col gap-3 px-2 py-2 transition-opacity ${
        locked ? "opacity-[0.52]" : ""
      }`}
    >
      <div>
        <p className="font-mono text-xs font-medium text-flux-text">{body.displayName}</p>
        <p className="text-[10px] capitalize text-flux-muted">
          {isCollisionFrame ? "Collision frame · inner play area" : body.entityKind}
          {multi ? ` · +${selectedIds.length - 1} selected` : ""}
        </p>
        {isCollisionFrame && (
          <p className="mt-2 rounded-md border border-flux-border/60 bg-black/30 px-2 py-1.5 text-[10px] leading-snug text-flux-muted">
            Replaces the world edge walls with this rim while active. Delete the frame to restore
            full {FLUX_WORLD.WIDTH}×{FLUX_WORLD.HEIGHT} bounds.
          </p>
        )}
        {isPlaying && (
          <p className="mt-2 rounded-md border border-flux-border/60 bg-black/30 px-2 py-1.5 text-[10px] leading-snug text-flux-muted">
            Simulation running — values are read-only. Pause to edit.
          </p>
        )}
        {!canWrite && !isPlaying && (
          <p className="mt-2 text-[10px] text-amber-400/80">Spectator view — read only.</p>
        )}
      </div>

      <fieldset className="flex flex-col gap-1.5" disabled={locked}>
        <legend className="mb-0.5 text-[8px] font-semibold uppercase tracking-widest text-flux-muted">
          Transform
        </legend>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          <ScrubNumField
            label="X"
            unit="px"
            value={body.x}
            step={1}
            decimals={0}
            locked={locked}
            onPreview={(x) => preview({ x, y: body.y })}
            onCommit={(x) => commit({ x, y: body.y }, `Set ${body.displayName} position X`)}
          />
          <ScrubNumField
            label="Y"
            unit="px"
            value={body.y}
            step={1}
            decimals={0}
            locked={locked}
            onPreview={(y) => preview({ x: body.x, y })}
            onCommit={(y) => commit({ x: body.x, y }, `Set ${body.displayName} position Y`)}
          />
        </div>
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
      </fieldset>

      {canResizeShape && (
        <fieldset className="flex flex-col gap-1.5" disabled={locked}>
          <legend className="mb-0.5 text-[8px] font-semibold uppercase tracking-widest text-flux-muted">
            Size
          </legend>
          {body.shape === "circle" ? (
            <ScrubNumField
              label="Radius"
              unit="px"
              value={radius}
              step={1}
              decimals={0}
              min={4}
              locked={locked}
              onPreview={(r) => {
                const d = r * 2;
                preview({ width: d, height: d });
              }}
              onCommit={(r) => {
                const d = r * 2;
                commit(
                  { width: d, height: d },
                  `Set ${body.displayName} radius`,
                );
              }}
            />
          ) : (
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              <ScrubNumField
                label="Width"
                unit="px"
                value={body.width}
                step={1}
                decimals={0}
                min={isCollisionFrame ? 64 : 8}
                locked={locked}
                onPreview={(width) => preview({ width, height: body.height })}
                onCommit={(width) =>
                  commit(
                    { width, height: body.height },
                    `Set ${body.displayName} width`,
                  )
                }
              />
              <ScrubNumField
                label="Height"
                unit="px"
                value={body.height}
                step={1}
                decimals={0}
                min={isCollisionFrame ? 64 : 8}
                locked={locked}
                onPreview={(height) => preview({ width: body.width, height })}
                onCommit={(height) =>
                  commit(
                    { width: body.width, height },
                    `Set ${body.displayName} height`,
                  )
                }
              />
            </div>
          )}
        </fieldset>
      )}

      {!body.isStatic && (
        <>
          <fieldset className="flex flex-col gap-1.5" disabled={locked}>
            <legend className="mb-0.5 text-[8px] font-semibold uppercase tracking-widest text-flux-muted">
              Motion
            </legend>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              <ScrubNumField
                label="Vx"
                unit="m/s"
                value={body.velocityX}
                step={0.5}
                {...fieldProps}
                onPreview={(velocityX) => preview({ velocityX })}
                onCommit={(velocityX) =>
                  commit({ velocityX }, `Set ${body.displayName} velocity X`)
                }
              />
              <ScrubNumField
                label="Vy"
                unit="m/s"
                value={body.velocityY}
                step={0.5}
                {...fieldProps}
                onPreview={(velocityY) => preview({ velocityY })}
                onCommit={(velocityY) =>
                  commit({ velocityY }, `Set ${body.displayName} velocity Y`)
                }
              />
            </div>
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
          </fieldset>

          <fieldset className="flex flex-col gap-1.5" disabled={locked}>
            <legend className="mb-0.5 text-[8px] font-semibold uppercase tracking-widest text-flux-muted">
              Material
            </legend>
            <ScrubNumField
              label="Mass"
              unit="kg"
              value={body.mass}
              step={0.1}
              min={0.001}
              locked={locked}
              onPreview={(mass) => preview({ mass })}
              onCommit={(mass) => commit({ mass }, `Set ${body.displayName} mass`)}
            />
            <ScrubNumField
              label="Density"
              unit="kg/m²"
              value={body.density}
              step={0.0001}
              min={0}
              locked={locked}
              onPreview={(density) => preview({ density })}
              onCommit={(density) => commit({ density }, `Set ${body.displayName} density`)}
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
          </fieldset>

          <fieldset className="flex flex-col gap-1.5" disabled={locked}>
            <legend className="mb-0.5 text-[8px] font-semibold uppercase tracking-widest text-flux-muted">
              Forces
            </legend>
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
            <Toggle
              label="Global gravity"
              checked={gravityEnabled}
              locked={locked}
              onChange={toggleGravity}
            />
          </fieldset>

          <div className="rounded-md border border-flux-border bg-black/25 px-2 py-1.5 font-mono text-[10px] text-flux-muted">
            <p>Speed {Math.hypot(body.velocityX, body.velocityY).toFixed(2)} m/s</p>
            <p>
              KE {(0.5 * body.mass * (body.velocityX ** 2 + body.velocityY ** 2)).toFixed(1)} J
            </p>
            {body.isSleeping && <p className="text-sky-400/90">Sleeping</p>}
          </div>
        </>
      )}

      {!isCollisionFrame && (
        <fieldset className="flex flex-col gap-1" disabled={locked}>
          <legend className="mb-0.5 text-[8px] font-semibold uppercase tracking-widest text-flux-muted">
            Flags
          </legend>
          <Toggle
            label="Static"
            checked={body.isStatic}
            locked={locked}
            onChange={() => commit({ isStatic: !body.isStatic }, `Set ${body.displayName} static`)}
          />
        </fieldset>
      )}
    </div>
  );
}
