"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PhysicsCanvas } from "@/components/workspace/PhysicsCanvas";
import { TimelineControls } from "@/components/workspace/TimelineControls";
import { useWorkspaceLayoutStore } from "@/store/workspaceLayoutStore";
import { ResizeHandle } from "@/components/workspace/layout/ResizeHandle";
import type { StoredSceneSnapshot } from "@/lib/scene/storedScene";
import { useAuthStore } from "@/store/authStore";
import { saveUserScene, USER_SCENE_LIMIT } from "@/lib/scenes/userScenes";
import { fetchUserScenes } from "@/lib/rooms/api";

interface SharedSceneViewProps {
  title: string;
  module: string;
  snapshot: StoredSceneSnapshot;
  sceneId: string;
}

export function SharedSceneView({ title, module, snapshot, sceneId }: SharedSceneViewProps) {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const timelineHeight = useWorkspaceLayoutStore((s) => s.timelineHeight);
  const adjustTimelineHeight = useWorkspaceLayoutStore((s) => s.adjustTimelineHeight);
  const [forking, setForking] = useState(false);
  const [forkError, setForkError] = useState<string | null>(null);

  const handleFork = async () => {
    if (!user) {
      router.push("/auth/login");
      return;
    }
    setForking(true);
    setForkError(null);
    try {
      const existing = await fetchUserScenes();
      if (existing.length >= USER_SCENE_LIMIT) {
        setForkError(`Library full (${USER_SCENE_LIMIT} scenes). Delete one from home first.`);
        return;
      }
      await saveUserScene({
        title: `${title} (fork)`,
        module,
        snapshot,
      });
      router.push("/");
    } catch (e) {
      setForkError(e instanceof Error ? e.message : "Could not fork scene.");
    } finally {
      setForking(false);
    }
  };

  return (
    <div className="flex h-screen flex-col bg-black text-[#e8ecf4]">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-[var(--flux-border)] px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-white/90">{title}</p>
          <p className="text-[10px] font-mono uppercase tracking-wider text-white/40">
            {module} · shared scene
          </p>
          {forkError && <p className="mt-1 text-[10px] text-red-400/90">{forkError}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {user ? (
            <button
              type="button"
              disabled={forking}
              onClick={() => void handleFork()}
              className="rounded-md border border-[var(--flux-border)] bg-white/[0.06] px-3 py-1.5 text-[11px] font-medium text-white/85 transition hover:bg-white/[0.09] disabled:opacity-40"
            >
              {forking ? "Forking…" : "Fork to library"}
            </button>
          ) : (
            <Link
              href="/auth/signup"
              className="rounded-md border border-[var(--flux-border)] bg-white/[0.06] px-3 py-1.5 text-[11px] font-medium text-white/85 transition hover:bg-white/[0.09]"
            >
              Sign up to fork
            </Link>
          )}
          <Link href="/" className="flux-btn px-3 py-1.5 text-[11px] text-white/75">
            Home
          </Link>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <PhysicsCanvas key={sceneId} initialStoredScene={snapshot} />
        </div>
        <div
          className="relative z-20 flex shrink-0 flex-col overflow-hidden border-t border-[var(--flux-border)] bg-black"
          style={{ height: timelineHeight }}
        >
          <ResizeHandle
            overlay
            axis="row"
            edge="start"
            className="absolute inset-x-0 top-0 z-30 h-3 -translate-y-1/2"
            onDrag={adjustTimelineHeight}
          />
          <TimelineControls />
        </div>
      </div>
    </div>
  );
}
