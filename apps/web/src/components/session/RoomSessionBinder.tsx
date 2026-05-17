"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { leaveRoomSession } from "@/lib/rooms/roomSessionRuntime";

/**
 * When navigation leaves the workspace for home, tear down the live room session.
 * Avoids stale collab channels / membership blocking the next bench or join.
 */
export function RoomSessionBinder() {
  const pathname = usePathname();
  const prevPath = useRef<string | null>(null);

  useEffect(() => {
    const prev = prevPath.current;
    const wasWorkspace = prev?.startsWith("/workspace/") ?? false;
    const isHome = pathname === "/";

    if (wasWorkspace && isHome) {
      void leaveRoomSession();
    }

    prevPath.current = pathname;
  }, [pathname]);

  return null;
}
