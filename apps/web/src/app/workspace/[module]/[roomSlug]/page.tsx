"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";
import { RoomHeader } from "@/components/room/RoomHeader";
import { useRoomSessionStore } from "@/store/roomSessionStore";
import { membershipMatchesRoute, resolveWorkspaceMembership } from "@/lib/rooms/session";
import {
  enterRoomSession,
  isSessionCurrent,
} from "@/lib/rooms/roomSessionRuntime";
import {
  buildWorkspacePath,
  readBenchFromSearch,
  type TestLayoutId,
} from "@/lib/physics/testLayouts";
import { useAuthStore } from "@/store/authStore";

function WorkspaceRoomContent({
  sessionRouteKey,
  benchId,
}: {
  sessionRouteKey: string;
  benchId: TestLayoutId | null;
}) {
  const params = useParams<{ module: string; roomSlug: string }>();
  const router = useRouter();
  const membership = useRoomSessionStore((s) => s.membership);
  const user = useAuthStore((s) => s.user);
  const [ready, setReady] = useState(false);
  const [enterError, setEnterError] = useState<string | null>(null);
  const runIdRef = useRef(0);

  const mod = params.module;
  const slug = params.roomSlug;
  const sessionReady = ready && membershipMatchesRoute(membership, mod, slug);

  useEffect(() => {
    setReady(false);
    setEnterError(null);
    const runId = ++runIdRef.current;

    void (async () => {
      try {
        const resolved = await resolveWorkspaceMembership(mod, slug, { anonymous: !user });
        if (runId !== runIdRef.current) return;

        if (resolved.slug !== slug || resolved.module !== mod) {
          router.replace(buildWorkspacePath(resolved.module, resolved.slug, benchId));
          return;
        }

        const { generation, synced } = await enterRoomSession(resolved, { anonymous: !user });
        if (runId !== runIdRef.current) return;
        if (!isSessionCurrent(generation, resolved.roomId)) {
          setEnterError("Could not attach to the room session. Please try joining again.");
          return;
        }

        if (!synced) {
          console.warn("[flux] room scene refresh returned empty; continuing with local bench seed");
        }

        setReady(true);
        setEnterError(null);
      } catch (e) {
        if (runId !== runIdRef.current) return;
        setEnterError(
          e instanceof Error ? e.message : "Could not enter the simulation room.",
        );
      }
    })();

    return () => {
      runIdRef.current += 1;
    };
  }, [sessionRouteKey, mod, slug, router, user]);

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

  if (!sessionReady || !membership) {
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

function WorkspaceRoomGate() {
  const params = useParams<{ module: string; roomSlug: string }>();
  const searchParams = useSearchParams();
  const benchId = readBenchFromSearch(searchParams.toString());

  const sessionRouteKey = useMemo(
    () => `${params.module}:${params.roomSlug}`,
    [params.module, params.roomSlug],
  );

  return (
    <WorkspaceRoomContent
      key={sessionRouteKey}
      sessionRouteKey={sessionRouteKey}
      benchId={benchId}
    />
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
      <WorkspaceRoomGate />
    </Suspense>
  );
}
