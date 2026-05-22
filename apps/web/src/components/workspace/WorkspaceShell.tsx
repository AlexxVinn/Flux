"use client";

import type { CSSProperties } from "react";
import { WorkspaceSidebar } from "@/components/workspace/WorkspaceSidebar";
import { TimelineControls } from "@/components/workspace/TimelineControls";
import { PhysicsCanvas } from "@/components/workspace/PhysicsCanvas";
import { ObjectToolbar } from "@/components/workspace/ObjectToolbar";
import { WorkspaceRightPanel } from "@/components/workspace/WorkspaceRightPanel";
import { ResizeHandle } from "@/components/workspace/layout/ResizeHandle";
import { useWorkspaceLayoutStore } from "@/store/workspaceLayoutStore";
import { useWorkspaceHotkeys } from "@/hooks/useWorkspaceHotkeys";
import { useRoomSessionStore } from "@/store/roomSessionStore";
import { AuthoringUndoDebugHud } from "@/components/workspace/AuthoringUndoDebugHud";
import { MobileWorkspaceChrome } from "@/components/workspace/mobile/MobileWorkspaceChrome";
import { useIsMobileWorkspace } from "@/hooks/useMobileWorkspace";

interface WorkspaceShellProps {
  roomId: string;
  benchId: string | null;
}

export function WorkspaceShell({ roomId, benchId }: WorkspaceShellProps) {
  useWorkspaceHotkeys();
  const isMobile = useIsMobileWorkspace();
  const collabBindingEpoch = useRoomSessionStore((s) => s.collabBindingEpoch);
  const timelineHeight = useWorkspaceLayoutStore((s) => s.timelineHeight);
  const adjustTimelineHeight = useWorkspaceLayoutStore((s) => s.adjustTimelineHeight);

  return (
    <div className="flex min-h-0 flex-1">
      <WorkspaceSidebar roomId={roomId} benchId={benchId} />
      <div
        className="flex min-w-0 flex-1 flex-col"
        style={
          {
            "--flux-mobile-timeline-h": `${timelineHeight}px`,
            "--flux-mobile-chrome-h": isMobile ? "56px" : "0px",
          } as CSSProperties
        }
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div
            className={`relative flex min-h-0 flex-1 flex-col overflow-hidden ${isMobile ? "pb-[calc(var(--flux-mobile-chrome-h)+env(safe-area-inset-bottom))]" : ""}`}
          >
            <PhysicsCanvas
              key={`${roomId}:${benchId ?? "default"}:${collabBindingEpoch}`}
              benchId={benchId}
            />
            <div className="hidden md:block">
              <AuthoringUndoDebugHud />
            </div>
            <ObjectToolbar />
            {isMobile && <MobileWorkspaceChrome roomId={roomId} benchId={benchId} />}
          </div>
          <div
            className="relative z-20 shrink-0 overflow-hidden border-t border-[var(--flux-border)] bg-black"
            style={{ height: timelineHeight }}
          >
            {!isMobile && (
              <ResizeHandle
                overlay
                axis="row"
                edge="start"
                className="absolute inset-x-0 top-0 z-30 h-3 -translate-y-1/2"
                onDrag={adjustTimelineHeight}
              />
            )}
            <TimelineControls mobile={isMobile} />
          </div>
        </div>
      </div>
      <WorkspaceRightPanel />
    </div>
  );
}
