"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";
import { RoomHeader } from "@/components/room/RoomHeader";
import { useRoomSessionHydrated, useRoomSessionStore } from "@/store/roomSessionStore";
import { joinRoomByCode } from "@/lib/rooms/api";
import {
  buildWorkspacePath,
  PENDING_JOIN_ANONYMOUS_KEY,
  PENDING_JOIN_CODE_KEY,
  readBenchFromSearch,
} from "@/lib/physics/testLayouts";

function WorkspaceRoomContent() {
  const params = useParams<{ module: string; roomSlug: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const benchId = readBenchFromSearch(searchParams.toString());
  const hydrated = useRoomSessionHydrated();
  const membership = useRoomSessionStore((s) => s.membership);
  const setMembership = useRoomSessionStore((s) => s.setMembership);
  const [ready, setReady] = useState(false);
  const [enterError, setEnterError] = useState<string | null>(null);

  useEffect(() => {
    if (!hydrated) return;

    const slug = params.roomSlug;
    const mod = params.module;

    if (membership && membership.slug === slug && membership.module === mod) {
      sessionStorage.removeItem(PENDING_JOIN_CODE_KEY);
      sessionStorage.removeItem(PENDING_JOIN_ANONYMOUS_KEY);
      setReady(true);
      setEnterError(null);
      return;
    }

    const code = sessionStorage.getItem(PENDING_JOIN_CODE_KEY);
    if (code) {
      const anonymous = sessionStorage.getItem(PENDING_JOIN_ANONYMOUS_KEY) === "1";
      sessionStorage.removeItem(PENDING_JOIN_CODE_KEY);
      sessionStorage.removeItem(PENDING_JOIN_ANONYMOUS_KEY);

      void joinRoomByCode(code, { anonymous })
        .then((m) => {
          setMembership(m);
          if (m.slug !== slug || m.module !== mod) {
            router.replace(buildWorkspacePath(m.module, m.slug, benchId));
            return;
          }
          setReady(true);
          setEnterError(null);
        })
        .catch(() => {
          setEnterError("Could not enter the simulation room.");
        });
      return;
    }

    setEnterError(null);
    router.replace("/");
  }, [hydrated, membership, params.module, params.roomSlug, router, setMembership, benchId]);

  if (enterError) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm text-red-400">{enterError}</p>
        <button
          type="button"
          onClick={() => router.replace("/")}
          className="rounded-lg border border-flux-border px-3 py-2 text-sm hover:bg-flux-elevated"
        >
          Back to home
        </button>
      </div>
    );
  }

  if (!ready || !membership) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-flux-muted">
        Entering room…
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col">
      <RoomHeader />
      <div className="flex min-h-0 flex-1">
        <WorkspaceShell roomId={membership.roomId} benchId={benchId} />
      </div>
    </div>
  );
}

export default function WorkspaceRoomPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center text-sm text-flux-muted">
          Loading workspace…
        </div>
      }
    >
      <WorkspaceRoomContent />
    </Suspense>
  );
}
