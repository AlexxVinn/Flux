"use client";

import { WorkspaceSidebar } from "@/components/workspace/WorkspaceSidebar";
import { TimelineControls } from "@/components/workspace/TimelineControls";
import { PhysicsCanvas } from "@/components/workspace/PhysicsCanvas";
import { ObjectToolbar } from "@/components/workspace/ObjectToolbar";
import { WorkspaceRightPanel } from "@/components/workspace/WorkspaceRightPanel";
import { ResizeHandle } from "@/components/workspace/layout/ResizeHandle";
import { useWorkspaceLayoutStore } from "@/store/workspaceLayoutStore";

interface WorkspaceShellProps {
  roomId: string;
  benchId: string | null;
}

export function WorkspaceShell({ roomId, benchId }: WorkspaceShellProps) {
  const timelineHeight = useWorkspaceLayoutStore((s) => s.timelineHeight);
  const adjustTimelineHeight = useWorkspaceLayoutStore((s) => s.adjustTimelineHeight);

  return (
    <div className="flex min-h-0 flex-1">
        <WorkspaceSidebar roomId={roomId} benchId={benchId} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            <PhysicsCanvas key={`${roomId}:${benchId ?? "default"}`} benchId={benchId} />
            <ObjectToolbar timelineOffset={timelineHeight} />
          </div>
          <div
            className="relative z-20 flex shrink-0 flex-col overflow-hidden border-t border-[var(--flux-border)] bg-black"
            style={{ height: timelineHeight }}
          >
            <ResizeHandle
              axis="row"
              edge="start"
              className="absolute inset-x-0 top-0 z-30 -translate-y-1/2"
              onDrag={adjustTimelineHeight}
            />
            <TimelineControls />
          </div>
        </div>
      </div>
      <WorkspaceRightPanel />
    </div>
  );
}
