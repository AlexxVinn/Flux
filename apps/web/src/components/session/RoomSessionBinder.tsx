"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { abandonRoomSession } from "@/lib/rooms/roomSessionRuntime";
import { useCollaborationStore } from "@/store/collaborationStore";
import { useRoomSessionStore } from "@/store/roomSessionStore";

/**
 * When navigation leaves the workspace for home, tear down the live room session.
 * Explicit Exit buttons also call abandon; this covers browser back and other exits.
 */
export function RoomSessionBinder() {
  const pathname = usePathname();
  const prevPath = useRef<string | null>(null);

  useEffect(() => {
    const prev = prevPath.current;
    const wasWorkspace = prev?.startsWith("/workspace/") ?? false;
    const isHome = pathname === "/";

    if (wasWorkspace && isHome) {
      const hasSession =
        useRoomSessionStore.getState().membership !== null ||
        useCollaborationStore.getState().supabaseConnected;
      if (hasSession) {
        void abandonRoomSession();
      }
    }

    prevPath.current = pathname;
  }, [pathname]);

  return null;
}
