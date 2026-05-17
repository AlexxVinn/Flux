"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useRoomSessionStore } from "@/store/roomSessionStore";
import { useAuthStore } from "@/store/authStore";
import { useRightPanelStore } from "@/store/rightPanelStore";
import { leaveRoomSession } from "@/lib/rooms/roomSessionRuntime";

export function RoomHeader() {
  const router = useRouter();
  const membership = useRoomSessionStore((s) => s.membership);
  const profile = useAuthStore((s) => s.profile);
  const focusRegion = useRightPanelStore((s) => s.focusRegion);
  const [copied, setCopied] = useState(false);

  const exitToHome = () => {
    void leaveRoomSession().then(() => router.push("/"));
  };

  if (!membership) return null;

  const copyCode = async () => {
    await navigator.clipboard.writeText(membership.joinCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const openMembersPanel = () => {
    focusRegion("members");
  };

  return (
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-flux-border px-3 py-2">
      <div>
        <h1 className="text-sm font-medium text-flux-text">{membership.title}</h1>
        <p className="text-[10px] text-flux-muted">
          {membership.module} ·{" "}
          <span className="capitalize">{membership.role}</span>
          {profile ? ` · ${profile.displayName}` : ` · ${membership.displayName}`}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void copyCode()}
          className="rounded border border-flux-border bg-flux-elevated px-2.5 py-1 font-mono text-xs text-flux-text hover:border-flux-focus"
          title="Copy invite code"
        >
          {membership.joinCode}
          {copied ? " ✓" : ""}
        </button>
        <button
          type="button"
          onClick={openMembersPanel}
          className="rounded border border-flux-border px-2.5 py-1 text-xs text-flux-muted hover:border-flux-focus hover:text-flux-text"
          title="Open members panel"
        >
          Members
        </button>
        <button
          type="button"
          onClick={exitToHome}
          className="rounded border border-flux-border px-2.5 py-1 text-xs text-flux-muted hover:text-flux-text"
        >
          Exit
        </button>
      </div>
    </header>
  );
}
