"use client";

import { useMemo, type ReactNode } from "react";
import { useSimulationStore } from "@/store/simulationStore";
import type { SpawnTool } from "@/lib/physics/types";
import type { TransformGizmoMode } from "@/lib/physics/transformGizmo";
import { AnnotationToolbar } from "@/components/collaboration/AnnotationToolbar";
import { useCanWriteInRoom, useRoomSessionStore } from "@/store/roomSessionStore";
import { useRoomSceneCollaborationStore } from "@/store/roomSceneCollaborationStore";
import { countSceneObjects } from "@/lib/scene/storedScene";
import { TapeMeasureHud } from "@/components/workspace/TapeMeasureHud";
import {
  AUTHORING_DOCK_BOTTOM_EXTRA_PX,
  useWorkspaceLayoutStore,
  WORKSPACE_PANEL_INSET_PX,
} from "@/store/workspaceLayoutStore";

const ICON = "h-4 w-4 shrink-0";
const GIZMO_ICON = "h-4 w-4 shrink-0";
const DOCK_BTN = "h-8 w-8";
const DOCK_BTN_COMPACT = "h-7 w-7";
const DOCK_GRID = "grid grid-cols-2 gap-0.5";

export function ToolIcon({ tool }: { tool: SpawnTool }) {
  switch (tool) {
    case "select":
      return (
        <svg className={ICON} viewBox="0 0 16 16" fill="none" aria-hidden>
          <path
            d="M3.5 2.5 12 8.5 8.2 9.4 9.8 13.5 8.2 14 6.4 9.8 3.5 10.5Z"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "circle":
      return (
        <svg className={ICON} viewBox="0 0 16 16" fill="none" aria-hidden>
          <circle cx="8" cy="8" r="4.75" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      );
    case "rectangle":
      return (
        <svg className={ICON} viewBox="0 0 16 16" fill="none" aria-hidden>
          <rect x="3.5" y="4.5" width="9" height="7" rx="0.75" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      );
    case "spring":
      return (
        <svg className={ICON} viewBox="0 0 16 16" fill="none" aria-hidden>
          <path
            d="M2.5 8h1.2l.8-1.5.8 3-.8-1.5h1.2l.8 1.5.8-3-.8 1.5H9l.8-1.5.8 3-.8-1.5h1.2"
            stroke="currentColor"
            strokeWidth="1.1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "rigidBar":
      return (
        <svg className={ICON} viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M2.5 8h11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <circle cx="2.5" cy="8" r="1.2" fill="currentColor" />
          <circle cx="13.5" cy="8" r="1.2" fill="currentColor" />
        </svg>
      );
    case "rope":
      return (
        <svg className={ICON} viewBox="0 0 16 16" fill="none" aria-hidden>
          <path
            d="M2 10.5c2-2.5 3-4 5-4s3 1.5 5 4"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      );
    case "collisionBox":
      return (
        <svg className={ICON} viewBox="0 0 16 16" fill="none" aria-hidden>
          <rect
            x="3"
            y="3"
            width="10"
            height="10"
            rx="0.75"
            stroke="currentColor"
            strokeWidth="1.1"
            strokeDasharray="2 1.5"
          />
        </svg>
      );
    case "force":
      return (
        <svg className={ICON} viewBox="0 0 16 16" fill="none" aria-hidden>
          <path
            d="M3 8h7M8.5 5.5 11 8l-2.5 2.5"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "measure":
      return (
        <svg className={ICON} viewBox="0 0 16 16" fill="none" aria-hidden>
          <rect x="2.5" y="4.5" width="11" height="7" rx="1" stroke="currentColor" strokeWidth="1.2" />
          <path d="M5.5 4.5v3M8.5 4.5v1.5M11.5 4.5v3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
        </svg>
      );
    default:
      return null;
  }
}

export function GizmoIcon({ mode }: { mode: TransformGizmoMode }) {
  switch (mode) {
    case "move":
      return (
        <svg className={GIZMO_ICON} viewBox="0 0 16 16" fill="none" aria-hidden>
          <path
            d="M8 2.5v11M8 2.5 6 4.5M8 2.5l2 2M8 13.5 6 11.5M8 13.5l2-2M2.5 8h11M2.5 8l2-2M2.5 8l2 2M13.5 8l-2-2M13.5 8l-2 2"
            stroke="currentColor"
            strokeWidth="1.1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "rotate":
      return (
        <svg className={GIZMO_ICON} viewBox="0 0 16 16" fill="none" aria-hidden>
          <path
            d="M11.5 4.5A5 5 0 1 0 12.5 9"
            stroke="currentColor"
            strokeWidth="1.1"
            strokeLinecap="round"
          />
          <path
            d="M12.5 2.5v2.5h-2.5"
            stroke="currentColor"
            strokeWidth="1.1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "scale":
      return (
        <svg className={GIZMO_ICON} viewBox="0 0 16 16" fill="none" aria-hidden>
          <path
            d="M4 12 12 4M12 4H8.5M12 4v3.5"
            stroke="currentColor"
            strokeWidth="1.1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    default:
      return null;
  }
}

const TOOLS: { id: SpawnTool; label: string; hint: string }[] = [
  { id: "select", label: "Select", hint: "1" },
  { id: "circle", label: "Circle", hint: "2" },
  { id: "rectangle", label: "Box", hint: "3" },
  { id: "spring", label: "Spring", hint: "4" },
  { id: "rigidBar", label: "Rigid bar", hint: "5" },
  { id: "rope", label: "Rope", hint: "6" },
  { id: "collisionBox", label: "Bounds", hint: "7" },
  { id: "force", label: "Force", hint: "8" },
  { id: "measure", label: "Measure", hint: "9" },
];

const GIZMO_MODES: { id: TransformGizmoMode; label: string; hint: string }[] = [
  { id: "move", label: "Move", hint: "G" },
  { id: "rotate", label: "Rotate", hint: "R" },
  { id: "scale", label: "Scale", hint: "S" },
];

interface ObjectToolbarProps {
  /** @deprecated Layout is fixed on canvas. */
  timelineOffset?: number;
}

const DOCK_SHELL =
  "pointer-events-auto overflow-hidden rounded-lg border border-white/[0.08] bg-black/78 p-1 shadow-lg backdrop-blur-md";

function DockDivider() {
  return <div className="my-0.5 h-px w-full bg-white/[0.08]" aria-hidden />;
}

function DockSectionLabel({ children }: { children: string }) {
  return (
    <p className="px-0.5 pb-0.5 text-center font-mono text-[7px] font-medium uppercase tracking-[0.12em] text-white/28">
      {children}
    </p>
  );
}

export function ToolButton({
  active,
  disabled,
  title,
  ariaLabel,
  onClick,
  children,
  tone,
  compact,
}: {
  active?: boolean;
  disabled?: boolean;
  title: string;
  ariaLabel: string;
  onClick: () => void;
  children: ReactNode;
  tone?: "default" | "danger" | "snap";
  compact?: boolean;
}) {
  const toneClass =
    tone === "danger"
      ? active
        ? "bg-red-500/20 text-red-300"
        : "text-white/45 hover:bg-red-500/10 hover:text-red-300"
      : tone === "snap"
        ? active
          ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/25"
          : "text-white/45 hover:bg-white/[0.06] hover:text-white/80"
        : active
          ? "bg-white/[0.12] text-white ring-1 ring-white/15"
          : "text-white/50 hover:bg-white/[0.06] hover:text-white/85";

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      className={`flex ${compact ? DOCK_BTN_COMPACT : DOCK_BTN} items-center justify-center rounded-md transition disabled:cursor-not-allowed disabled:opacity-30 ${toneClass}`}
    >
      {children}
    </button>
  );
}

export function IconPaste() {
  return (
    <svg className={ICON} viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="5" y="5" width="8" height="9" rx="0.75" stroke="currentColor" strokeWidth="1.1" />
      <path
        d="M4 3.5h6a1.5 1.5 0 0 1 1.5 1.5V10"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function IconDuplicate() {
  return (
    <svg className={ICON} viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="6" y="6" width="7" height="7" rx="0.75" stroke="currentColor" strokeWidth="1.1" />
      <rect x="3" y="3" width="7" height="7" rx="0.75" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}

export function IconDelete() {
  return (
    <svg className={ICON} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M3.5 5h9M6 5V3.5h4V5M5.5 5v7.5h5V5"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconGridSnap({ on }: { on: boolean }) {
  return (
    <svg className={ICON} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M3 3h10M3 8h10M3 13h10M3 3v10M8 3v10M13 3v10"
        stroke="currentColor"
        strokeWidth="1"
        strokeDasharray={on ? undefined : "1.5 1.5"}
      />
      <circle cx="8" cy="8" r="1.25" fill="currentColor" />
    </svg>
  );
}

function ContextHint({ message }: { message: string }) {
  const timelineHeight = useWorkspaceLayoutStore((s) => s.timelineHeight);
  const dockBottom =
    timelineHeight + WORKSPACE_PANEL_INSET_PX + AUTHORING_DOCK_BOTTOM_EXTRA_PX + 35;
  return (
    <div
      className="pointer-events-none absolute inset-x-3 bottom-3 z-[9] flex justify-center max-md:bottom-4"
      style={{ bottom: dockBottom }}
      role="status"
    >
      <p className="max-w-[min(100%,36rem)] truncate rounded-md border border-white/[0.08] bg-black/80 px-3 py-1.5 text-center font-mono text-[10px] text-white/65 shadow-lg backdrop-blur-sm">
        {message}
      </p>
    </div>
  );
}

function AuthoringBottomDock() {
  const springPending = useSimulationStore((s) => s.springPending);
  const ropePending = useSimulationStore((s) => s.ropePending);
  const deleteSelected = useSimulationStore((s) => s.deleteSelected);
  const duplicateSelectedAuthoring = useSimulationStore((s) => s.duplicateSelectedAuthoring);
  const pasteFromClipboard = useSimulationStore((s) => s.pasteFromClipboard);
  const authoringClipboard = useSimulationStore((s) => s.authoringClipboard);
  const selectedIds = useSimulationStore((s) => s.selectedIds);
  const activeTool = useSimulationStore((s) => s.activeTool);
  const timelineHeight = useWorkspaceLayoutStore((s) => s.timelineHeight);

  const clipboardCount =
    authoringClipboard != null
      ? authoringClipboard.bodies.length +
        authoringClipboard.springs.length +
        authoringClipboard.ropes.length
      : 0;
  const hasClipboard = clipboardCount > 0;

  const dockBottom =
    timelineHeight + WORKSPACE_PANEL_INSET_PX + AUTHORING_DOCK_BOTTOM_EXTRA_PX;

  return (
    <div
      className="pointer-events-none absolute left-3 z-10 hidden flex-col items-start gap-1 md:flex"
      style={{ bottom: dockBottom }}
      aria-label="Annotation, edit, and measure tools"
    >
      <div
        className={`${DOCK_SHELL} flex h-[35px] items-center gap-0.5 px-1`}
        aria-label="Mark and edit tools"
      >
        <AnnotationToolbar layout="inline" compact />
        <div className="mx-0.5 h-5 w-px shrink-0 bg-white/[0.08]" aria-hidden />
        <div className="flex items-center gap-0.5">
          <ToolButton
            compact
            disabled={springPending !== null || ropePending !== null || !hasClipboard}
            onClick={() => pasteFromClipboard()}
            title="Paste (⌘/Ctrl+V)"
            ariaLabel="Paste"
          >
            <IconPaste />
          </ToolButton>
          <ToolButton
            compact
            disabled={
              springPending !== null || ropePending !== null || selectedIds.length === 0
            }
            onClick={() => duplicateSelectedAuthoring()}
            title="Duplicate (⌘/Ctrl+D)"
            ariaLabel="Duplicate"
          >
            <IconDuplicate />
          </ToolButton>
          <ToolButton
            compact
            onClick={deleteSelected}
            title="Delete (Del)"
            ariaLabel="Delete"
            tone="danger"
          >
            <IconDelete />
          </ToolButton>
        </div>
      </div>

      {activeTool === "measure" && (
        <div className={`${DOCK_SHELL} w-[4.75rem]`}>
          <DockSectionLabel>Measure</DockSectionLabel>
          <TapeMeasureHud />
        </div>
      )}
    </div>
  );
}

export function ObjectToolbar(_props: ObjectToolbarProps = {}) {
  const canWrite = useCanWriteInRoom();
  const membership = useRoomSessionStore((s) => s.membership);
  const roomSceneRoomId = useRoomSceneCollaborationStore((s) => s.roomId);
  const objectLimit = useRoomSceneCollaborationStore((s) => s.objectLimit);
  const activeTool = useSimulationStore((s) => s.activeTool);
  const springPending = useSimulationStore((s) => s.springPending);
  const ropePending = useSimulationStore((s) => s.ropePending);
  const snapshot = useSimulationStore((s) => s.snapshot);
  const setTool = useSimulationStore((s) => s.setTool);
  const gridSnapEnabled = useSimulationStore((s) => s.gridSnapEnabled);
  const toggleGridSnap = useSimulationStore((s) => s.toggleGridSnap);
  const transformGizmoMode = useSimulationStore((s) => s.transformGizmoMode);
  const setTransformGizmoMode = useSimulationStore((s) => s.setTransformGizmoMode);

  const inCollabRoom =
    !!membership?.roomId &&
    membership.roomId === roomSceneRoomId &&
    (membership.role === "admin" || membership.role === "member");

  const objectCount = useMemo(() => countSceneObjects(snapshot), [snapshot]);
  const atObjectCap = inCollabRoom && objectCount >= objectLimit;

  const contextHint = springPending
    ? "Pick 2nd body · Shift angle snap · Ctrl free attach · Esc cancel"
    : ropePending
      ? "Pick 2nd body · Shift angle snap · Ctrl free attach · Esc cancel"
      : activeTool === "force"
        ? "Click a body · set Fx/Fy (N) in inspector · Enter to apply"
        : null;

  if (!canWrite) return null;

  return (
    <>
      {/* Desktop: top-left spawn + gizmo docks */}
      <div
        className="pointer-events-none absolute left-3 top-[4.75rem] z-10 hidden flex-col overflow-hidden md:flex"
        aria-label="Spawn and transform tools"
      >
        <div className={`${DOCK_SHELL} flex w-[4.75rem] flex-col gap-1`}>
          <DockSectionLabel>Tools</DockSectionLabel>
          <div className={DOCK_GRID}>
            {TOOLS.map((t) => {
              const spawns =
                t.id === "circle" ||
                t.id === "rectangle" ||
                t.id === "spring" ||
                t.id === "rigidBar" ||
                t.id === "rope";
              const disabled = spawns && atObjectCap;
              return (
                <ToolButton
                  key={t.id}
                  active={activeTool === t.id}
                  disabled={disabled}
                  onClick={() => setTool(t.id)}
                  title={
                    disabled
                      ? `Room object limit reached (${objectLimit})`
                      : `${t.label} (${t.hint})`
                  }
                  ariaLabel={t.label}
                >
                  <ToolIcon tool={t.id} />
                </ToolButton>
              );
            })}
          </div>

          {activeTool === "select" && (
            <>
              <DockDivider />
              <DockSectionLabel>Gizmo</DockSectionLabel>
              <div className={DOCK_GRID}>
                {GIZMO_MODES.map((g) => (
                  <ToolButton
                    key={g.id}
                    active={transformGizmoMode === g.id}
                    onClick={() => setTransformGizmoMode(g.id)}
                    title={`${g.label} (${g.hint})`}
                    ariaLabel={g.label}
                  >
                    <GizmoIcon mode={g.id} />
                  </ToolButton>
                ))}
                <ToolButton
                  active={gridSnapEnabled}
                  onClick={toggleGridSnap}
                  title={
                    gridSnapEnabled ? "Grid snap on (10 px / 0.1 m)" : "Grid snap off"
                  }
                  ariaLabel="Toggle grid snap"
                  tone="snap"
                >
                  <IconGridSnap on={gridSnapEnabled} />
                </ToolButton>
              </div>
            </>
          )}
        </div>
      </div>

      <AuthoringBottomDock />

      {contextHint && <ContextHint message={contextHint} />}
    </>
  );
}
