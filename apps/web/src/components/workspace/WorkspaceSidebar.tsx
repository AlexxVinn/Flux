"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { buildWorkspacePath, type TestLayoutId } from "@/lib/physics/testLayouts";
import { useRoomSessionStore } from "@/store/roomSessionStore";
import { useWorkspaceLayoutStore } from "@/store/workspaceLayoutStore";
import { useCollaborationStore } from "@/store/collaborationStore";
import { useRoomSceneCollaborationStore } from "@/store/roomSceneCollaborationStore";
import { useSimulationStore, isAtSharedSetupFrame } from "@/store/simulationStore";
import { ResizeHandle } from "./layout/ResizeHandle";
import { abandonRoomSession } from "@/lib/rooms/roomSessionRuntime";

const MODULES = [
  {
    id: "mechanics",
    label: "Mechanics",
    subtitle: "Active lab",
    icon: "◎",
    locked: false,
  },
  { id: "thermo", label: "Thermodynamics", subtitle: "Soon", icon: "△", locked: true },
  { id: "em", label: "Electromagnetism", subtitle: "Soon", icon: "⚡", locked: true },
  { id: "fluid", label: "Fluid dynamics", subtitle: "Soon", icon: "≋", locked: true },
] as const;

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">
      {children}
    </p>
  );
}

interface WorkspaceSidebarProps {
  roomId: string;
  benchId: string | null;
  /** Full-width drawer on mobile; docked rail on desktop. */
  variant?: "docked" | "drawer";
}

export function WorkspaceSidebar({
  roomId,
  benchId,
  variant = "docked",
}: WorkspaceSidebarProps) {
  const isDrawer = variant === "drawer";
  const pathname = usePathname();
  const router = useRouter();
  const membership = useRoomSessionStore((s) => s.membership);
  const sidebarWidth = useWorkspaceLayoutStore((s) => s.sidebarWidth);
  const sidebarCollapsed = useWorkspaceLayoutStore((s) => s.sidebarCollapsed);
  const showExpanded = isDrawer || !sidebarCollapsed;
  const adjustSidebarWidth = useWorkspaceLayoutStore((s) => s.adjustSidebarWidth);
  const toggleSidebarCollapsed = useWorkspaceLayoutStore((s) => s.toggleSidebarCollapsed);

  const supabaseConnected = useCollaborationStore((s) => s.supabaseConnected);
  const peerCount = useCollaborationStore((s) => s.peers.length);
  const collabRoomId = useRoomSceneCollaborationStore((s) => s.roomId);
  const sceneRevision = useRoomSceneCollaborationStore((s) => s.sceneRevision);
  const playbackState = useRoomSceneCollaborationStore((s) => s.playbackState);

  const goLive = useSimulationStore((s) => s.goLive);
  const isPlaying = useSimulationStore((s) => s.isPlaying);
  const historyIndex = useSimulationStore((s) => s.historyIndex);
  const historyLength = useSimulationStore((s) => s.historyLength);

  const [linkCopied, setLinkCopied] = useState(false);

  const inMechanics = pathname?.includes("/workspace/mechanics") ?? false;

  const mechanicsHref =
    membership?.module === "mechanics"
      ? buildWorkspacePath(
          membership.module,
          membership.slug,
          (benchId as TestLayoutId | null) ?? null,
        )
      : "/workspace/mechanics";

  const sessionForRoom = !!membership && collabRoomId === membership.roomId && collabRoomId === roomId;
  const configPresent = isSupabaseConfigured();

  const collaborative =
    !!membership?.roomId &&
    membership.roomId === collabRoomId &&
    (membership.role === "admin" || membership.role === "member");

  const showSetupTimelineHint =
    collaborative &&
    configPresent &&
    sessionForRoom &&
    !isPlaying &&
    !isAtSharedSetupFrame({ historyIndex, historyLength });

  const copyWorkspaceUrl = useCallback(async () => {
    if (typeof window === "undefined" || !membership) return;
    const url = `${window.location.origin}${buildWorkspacePath(
      membership.module,
      membership.slug,
      (benchId as TestLayoutId | null) ?? null,
    )}`;
    await navigator.clipboard.writeText(url);
    setLinkCopied(true);
    window.setTimeout(() => setLinkCopied(false), 1800);
  }, [benchId, membership]);

  const jumpToSetup = useCallback(() => {
    goLive();
  }, [goLive]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "[") return;
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
      if (t instanceof HTMLElement && t.isContentEditable) return;
      e.preventDefault();
      toggleSidebarCollapsed();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleSidebarCollapsed]);

  return (
      <aside
        style={isDrawer ? undefined : { width: sidebarWidth }}
        className={
          isDrawer
            ? "relative flex h-full min-h-0 w-full flex-col bg-black"
            : "relative hidden h-full min-h-0 shrink-0 flex-col border-r border-[var(--flux-border)] bg-black md:flex"
        }
        aria-label="Workspace navigation"
      >
        <div className="flux-panel-header flex items-center gap-2 px-3 py-3">
          <Link
            href="/"
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg transition hover:bg-white/[0.03]"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--flux-border)] bg-black text-base font-semibold text-white">
              φ
            </span>
            {showExpanded && (
              <span className="truncate text-sm font-semibold tracking-tight text-white">
                Flux
              </span>
            )}
          </Link>
          {!isDrawer && (
            <button
              type="button"
              onClick={toggleSidebarCollapsed}
              className="flux-btn flex h-8 w-8 shrink-0 items-center justify-center text-xs text-white/45"
              title={sidebarCollapsed ? "Expand sidebar ([)" : "Collapse sidebar ([)"}
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-expanded={!sidebarCollapsed}
            >
              {sidebarCollapsed ? "»" : "«"}
            </button>
          )}
        </div>

        {showExpanded && membership && (
          <div className="mx-3 space-y-3 border-b border-[var(--flux-border)] pb-3">
            <div>
              <div className="rounded-lg border border-[var(--flux-border)] bg-black px-2.5 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">
                  This room
                </p>
                <p className="mt-1 truncate text-[11px] font-medium text-white/90">{membership.title}</p>
                <p className="mt-0.5 truncate font-mono text-[10px] text-white/40">
                  /{membership.module}/{membership.slug}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-white/45">
                  <span className="capitalize">{membership.visibility}</span>
                  <span className="text-white/25">·</span>
                  <span className="capitalize">{membership.role}</span>
                </div>
              </div>
              <p className="mt-2 px-0.5 text-[10px] leading-snug text-white/35">
                Open the <span className="text-white/55">Members</span> panel on the right for the roster,
                invite code, and moderation. Here you switch labs and confirm cloud sync.
              </p>
            </div>

            <div>
              <SectionLabel>Session</SectionLabel>
              <ul className="space-y-1.5 px-2 text-[10px] leading-snug text-white/50">
                <li className="flex gap-2">
                  <span className="shrink-0 font-mono text-white/35">◇</span>
                  <span>
                    {!configPresent ? (
                      <>Offline stack — cloud features disabled</>
                    ) : sessionForRoom && supabaseConnected ? (
                      <>Cloud sync · connected</>
                    ) : sessionForRoom ? (
                      <>Cloud sync · reconnecting</>
                    ) : (
                      <>Cloud sync · idle</>
                    )}
                  </span>
                </li>
                {configPresent && sessionForRoom && (
                  <li className="flex gap-2">
                    <span className="shrink-0 font-mono text-white/35">↻</span>
                    <span>
                      Scene rev. {sceneRevision}
                      <span className="text-white/30"> · </span>
                      <span className="capitalize">{playbackState}</span>
                    </span>
                  </li>
                )}
                <li className="flex gap-2">
                  <span className="shrink-0 font-mono text-white/35">◎</span>
                  <span>
                    {peerCount === 0
                      ? "Live cursors · no peers (optional WS channel)"
                      : peerCount === 1
                        ? "Live cursors · 1 other"
                        : `Live cursors · ${peerCount} others`}
                  </span>
                </li>
                {showSetupTimelineHint && (
                  <li className="flex gap-2 text-white/55">
                    <span className="shrink-0 font-mono text-white/35">!</span>
                    <span>
                      Shared edits apply on the setup timeline—use Quick actions to jump back if needed.
                    </span>
                  </li>
                )}
              </ul>
            </div>

            <div>
              <SectionLabel>Quick actions</SectionLabel>
              <div className="flex flex-col gap-1 px-0.5">
                <button
                  type="button"
                  onClick={() => jumpToSetup()}
                  className="flux-btn w-full px-2 py-1.5 text-left text-[11px] text-white/80 hover:bg-white/[0.06]"
                >
                  <span className="font-medium text-white/90">Jump to setup</span>
                  <span className="mt-0.5 block text-[10px] font-normal text-white/40">
                    Frame 0 · pause · best for room edits
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void copyWorkspaceUrl()}
                  className="flux-btn w-full px-2 py-1.5 text-left text-[11px] text-white/80 hover:bg-white/[0.06]"
                >
                  <span className="font-medium text-white/90">
                    {linkCopied ? "Workspace link copied" : "Copy workspace link"}
                  </span>
                  <span className="mt-0.5 block text-[10px] font-normal text-white/40">
                    Includes bench preset in the URL when set
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}

        <nav className="flux-scroll flex-1 space-y-1 overflow-y-auto p-2 pt-3" aria-label="Labs">
          {showExpanded && <SectionLabel>Curriculum</SectionLabel>}
          {MODULES.map((mod) => {
            const active = !mod.locked && inMechanics && mod.id === "mechanics";
            const effectiveHref = mod.id === "mechanics" && !mod.locked ? mechanicsHref : null;

            const inner = (
              <>
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border text-sm ${
                    active
                      ? "border-[var(--flux-border-active)] bg-[var(--flux-surface-raised)] text-white"
                      : "border-[var(--flux-border)] bg-black text-white/45"
                  }`}
                  aria-hidden
                >
                  {mod.icon}
                </span>
                {!sidebarCollapsed && (
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-white/90">
                      {mod.label}
                    </span>
                    <span className="block truncate text-[10px] text-white/40">{mod.subtitle}</span>
                  </span>
                )}
              </>
            );

            if (mod.locked) {
              return (
                <div
                  key={mod.id}
                  className={`flex items-center gap-2.5 rounded-md px-2 py-2 opacity-35 ${
                    sidebarCollapsed ? "justify-center" : ""
                  }`}
                  title={`${mod.label} (${mod.subtitle})`}
                >
                  {inner}
                </div>
              );
            }

            return (
              <Link
                key={mod.id}
                href={effectiveHref ?? "/"}
                title={mod.label}
                aria-current={active ? "page" : undefined}
                className={`relative flex items-center gap-2.5 rounded-md px-2 py-2 transition ${
                  sidebarCollapsed ? "justify-center" : ""
                } ${active ? "bg-white/[0.08]" : "hover:bg-white/[0.04]"}`}
              >
                {active && (
                  <span className="absolute top-2 bottom-2 left-0 w-px bg-white" aria-hidden />
                )}
                {inner}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-[var(--flux-border)] p-2">
          <button
            type="button"
            title="All rooms"
            onClick={() => {
              void abandonRoomSession().then(() => router.push("/"));
            }}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[11px] text-white/45 transition hover:bg-white/[0.04] hover:text-white/80 ${
              sidebarCollapsed ? "justify-center" : ""
            }`}
          >
            <span className="text-sm" aria-hidden>
              ←
            </span>
            {!sidebarCollapsed && <span>All rooms</span>}
          </button>
          {!sidebarCollapsed && (
            <p className="mt-1 px-2 text-[9px] leading-snug text-white/25">
              Press <kbd className="font-mono text-white/35">[</kbd> to toggle this panel
            </p>
          )}
        </div>
        {!isDrawer && !sidebarCollapsed && (
          <ResizeHandle
            overlay
            axis="column"
            edge="end"
            className="absolute inset-y-0 right-0 z-50 w-3 translate-x-1/2"
            onDrag={adjustSidebarWidth}
          />
        )}
      </aside>
  );
}
