"use client";

import { UserAvatar } from "@/components/collaboration/UserAvatar";
import { worldToScreen } from "@/lib/physics/worldSpace";
import { useCollaborationStore } from "@/store/collaborationStore";
import { useSimulationStore } from "@/store/simulationStore";

export function PresenceOverlay({ width, height }: { width: number; height: number }) {
  const peers = useCollaborationStore((s) => s.peers);
  const connected = useCollaborationStore((s) => s.connected);
  const supabaseConnected = useCollaborationStore((s) => s.supabaseConnected);
  const camera = useSimulationStore((s) => s.camera);

  const showCursors = connected || supabaseConnected;
  if (!showCursors || peers.length === 0) return null;

  return (
    <svg
      className="pointer-events-none absolute inset-0 z-10"
      width={width}
      height={height}
      aria-hidden
    >
      {peers.map((peer) => {
        if (!peer.cursor) return null;
        const { x, y } = worldToScreen(peer.cursor.x, peer.cursor.y, width, height, camera);
        return (
          <g key={peer.userId} transform={`translate(${x}, ${y})`}>
            <path
              d="M0,0 L0,14 L4,10 L7,16 L9,15 L6,9 L11,9 Z"
              fill={peer.color}
              stroke="#0a0a0a"
              strokeWidth={0.5}
            />
            <foreignObject x={12} y={-6} width={20} height={20}>
              <UserAvatar
                userId={peer.userId}
                color={peer.color}
                size={18}
                displayName={peer.displayName}
              />
            </foreignObject>
            <text
              x={34}
              y={4}
              fill={peer.color}
              fontSize={10}
              fontFamily="ui-sans-serif, system-ui, sans-serif"
            >
              {peer.displayName}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
