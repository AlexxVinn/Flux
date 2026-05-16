"use client";

import { worldToScreen } from "@/lib/physics/worldSpace";
import { useCollaborationStore } from "@/store/collaborationStore";
import { useSimulationStore } from "@/store/simulationStore";

export function PresenceOverlay({ width, height }: { width: number; height: number }) {
  const peers = useCollaborationStore((s) => s.peers);
  const connected = useCollaborationStore((s) => s.connected);
  const camera = useSimulationStore((s) => s.camera);

  if (!connected || peers.length === 0) return null;

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
            <text
              x={12}
              y={4}
              fill={peer.color}
              fontSize={10}
              fontFamily="monospace"
            >
              {peer.displayName}
            </text>
            {peer.selectedIds && peer.selectedIds.length > 0 && (
              <text x={12} y={14} fill="rgba(255,255,255,0.5)" fontSize={8}>
                {peer.selectedIds.length} selected
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
