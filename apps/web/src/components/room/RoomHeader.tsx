"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useRoomSessionStore } from "@/store/roomSessionStore";
import { useAuthStore } from "@/store/authStore";
import { useRightPanelStore } from "@/store/rightPanelStore";
import { useWorkspaceLayoutStore } from "@/store/workspaceLayoutStore";
import { useIsMobileWorkspace } from "@/hooks/useMobileWorkspace";
import { abandonRoomSession } from "@/lib/rooms/roomSessionRuntime";

export function RoomHeader() {
  const router = useRouter();
  const membership = useRoomSessionStore((s) => s.membership);
  const profile = useAuthStore((s) => s.profile);
  const focusRegion = useRightPanelStore((s) => s.focusRegion);
  const setMobileSheet = useWorkspaceLayoutStore((s) => s.setMobileSheet);
  const isMobile = useIsMobileWorkspace();
  const [copied, setCopied] = useState(false);

  const exitToHome = () => {
    void abandonRoomSession().then(() => router.push("/"));
  };

  if (!membership) return null;

  const copyCode = async () => {
    await navigator.clipboard.writeText(membership.joinCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const openMembersPanel = () => {
    focusRegion("members");
    if (isMobile) setMobileSheet("members");
  };

  return (
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-flux-border px-3 py-2 max-md:gap-1.5 max-md:px-2 max-md:py-1.5">
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-sm font-medium text-flux-text max-md:text-xs">
          {membership.title}
        </h1>
        <p className="truncate text-[10px] text-flux-muted max-md:text-[9px]">
          {membership.module} ·{" "}
          <span className="capitalize">{membership.role}</span>
          {profile ? ` · ${profile.displayName}` : ` · ${membership.displayName}`}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 max-md:gap-1">
        <button
          type="button"
          onClick={() => void copyCode()}
          className="rounded border border-flux-border bg-flux-elevated px-2.5 py-1 font-mono text-xs text-flux-text hover:border-flux-focus max-md:px-2 max-md:py-1.5 max-md:text-[10px]"
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
