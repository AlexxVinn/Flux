"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { CatalogScene, UserScene } from "@flux/shared";
import { JoinCodeInput } from "@/components/room/JoinCodeInput";
import { useAuthStore } from "@/store/authStore";
import { createRoom, joinRoomByCode, joinRoomBySlug } from "@/lib/rooms/api";
import { prepareRoomJoinNavigation } from "@/lib/rooms/session";
import {
  getRecentRooms,
  removeRecentRoom,
  type RecentRoomEntry,
} from "@/lib/rooms/recentRooms";
import { useHomeHubData } from "@/hooks/useHomeHubData";
import { deleteUserScene, renameUserScene, setUserScenePublic, buildSceneShareUrl, USER_SCENE_LIMIT } from "@/lib/scenes/userScenes";
import {
  buildWorkspacePath,
  TEST_LAYOUTS,
  type TestLayoutId,
} from "@/lib/physics/testLayouts";
import { snapshotForServer } from "@/lib/scene/storedScene";
import { FLUX_WORLD } from "@/lib/physics/worldSpace";
import { updateDisplayName } from "@/lib/auth/profile";
import { joinCodeSchema } from "@/lib/auth/validation";

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">{children}</h2>
  );
}

function CollapsibleHubSection({
  title,
  description,
  open,
  onToggle,
  trailing,
  children,
}: {
  title: string;
  description?: string;
  open: boolean;
  onToggle: () => void;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-[var(--flux-border)] px-6 py-6 sm:px-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <button
          type="button"
          onClick={onToggle}
          className="group flex min-w-0 flex-1 items-start gap-2.5 text-left"
          aria-expanded={open}
        >
          <span
            className={`mt-0.5 shrink-0 text-[11px] text-white/35 transition group-hover:text-white/55 ${
              open ? "rotate-90" : ""
            }`}
            aria-hidden
          >
            ›
          </span>
          <span className="min-w-0">
            <SectionTitle>{title}</SectionTitle>
            {description && (
              <p className="mt-2 max-w-2xl text-[11px] leading-relaxed text-white/45">{description}</p>
            )}
          </span>
        </button>
        {trailing}
      </div>
      {open && <div className="mt-5">{children}</div>}
    </section>
  );
}

export function HomeHub() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const profile = useAuthStore((s) => s.profile);
  const signOut = useAuthStore((s) => s.signOut);
  const { catalog, myScenes, publicRooms, loadState, loadError, refresh } = useHomeHubData();

  const [joinLoading, setJoinLoading] = useState(false);
  const [joinInputKey, setJoinInputKey] = useState(0);
  const [launchingBenchId, setLaunchingBenchId] = useState<TestLayoutId | null>(null);
  const [openingSceneId, setOpeningSceneId] = useState<string | null>(null);
  const [editingSceneId, setEditingSceneId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [nameEdit, setNameEdit] = useState("");
  const [benchesOpen, setBenchesOpen] = useState(true);
  const [starterLabsOpen, setStarterLabsOpen] = useState(true);
  const [recentRooms, setRecentRooms] = useState<RecentRoomEntry[]>([]);
  const [continuingRoomId, setContinuingRoomId] = useState<string | null>(null);

  const refreshRecentRooms = useCallback(() => {
    setRecentRooms(getRecentRooms());
  }, []);

  useEffect(() => {
    refreshRecentRooms();
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshRecentRooms();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refreshRecentRooms]);

  const error = actionError ?? loadError;

  const goWorkspace = useCallback(
    (
      membership: Awaited<ReturnType<typeof joinRoomByCode>>,
      opts?: { benchId?: TestLayoutId; anonymous?: boolean },
    ) => {
      prepareRoomJoinNavigation(membership, { anonymous: opts?.anonymous });
      router.push(buildWorkspacePath(membership.module, membership.slug, opts?.benchId));
    },
    [router],
  );

  const handleJoin = async (code: string, anonymous = false) => {
    setActionError(null);
    const parsed = joinCodeSchema.safeParse(code);
    if (!parsed.success) {
      setActionError(parsed.error.issues[0]?.message ?? "Enter a 6-digit room code");
      return;
    }

    setJoinLoading(true);
    try {
      const m = await joinRoomByCode(parsed.data, { anonymous });
      goWorkspace(m, { anonymous });
      setJoinInputKey((k) => k + 1);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Could not join room");
    } finally {
      setJoinLoading(false);
    }
  };

  const handleContinueRecent = async (entry: RecentRoomEntry) => {
    setActionError(null);
    setContinuingRoomId(entry.roomId);
    setJoinLoading(true);
    try {
      const m = user
        ? await joinRoomBySlug(entry.slug)
        : await joinRoomByCode(entry.joinCode, { anonymous: true });
      goWorkspace(m, { anonymous: !user });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Could not rejoin room");
    } finally {
      setJoinLoading(false);
      setContinuingRoomId(null);
    }
  };

  const handleRemoveRecent = (roomId: string) => {
    removeRecentRoom(roomId);
    refreshRecentRooms();
  };

  const handleLaunchTestLayout = async (layoutId: TestLayoutId) => {
    setActionError(null);
    if (!user) {
      router.push("/auth/login");
      return;
    }
    setLaunchingBenchId(layoutId);
    try {
      const layout = TEST_LAYOUTS.find((l) => l.id === layoutId);
      if (!layout) {
        setActionError("Unknown bench");
        return;
      }
      const simSnap = layout.build(FLUX_WORLD.WIDTH, FLUX_WORLD.HEIGHT);
      const stored = snapshotForServer(simSnap, true);
      const m = await createRoom({
        title: `Bench · ${layout.title}`,
        module: "mechanics",
        visibility: "private",
        initialScene: stored as unknown as Record<string, unknown>,
      });
      goWorkspace(m, { benchId: layoutId });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Could not open test layout");
    } finally {
      setLaunchingBenchId(null);
    }
  };

  const handleCreateFromCatalog = async (scene: CatalogScene) => {
    if (!user) {
      router.push("/auth/login");
      return;
    }
    setJoinLoading(true);
    setActionError(null);
    try {
      const m = await createRoom({
        title: scene.title,
        module: scene.module,
        visibility: "private",
        catalogId: scene.id,
      });
      goWorkspace(m);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Could not create room");
    } finally {
      setJoinLoading(false);
    }
  };

  const handleOpenUserScene = async (scene: UserScene) => {
    if (!user) {
      router.push("/auth/login");
      return;
    }
    setOpeningSceneId(scene.id);
    setActionError(null);
    try {
      const m = await createRoom({
        title: scene.title,
        module: scene.module,
        visibility: "private",
        userSceneId: scene.id,
      });
      goWorkspace(m);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Could not open scene");
    } finally {
      setOpeningSceneId(null);
    }
  };

  const handleRenameScene = async (sceneId: string) => {
    if (!editTitle.trim()) return;
    setActionError(null);
    try {
      await renameUserScene(sceneId, editTitle.trim());
      setEditingSceneId(null);
      setEditTitle("");
      await refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Could not rename scene");
    }
  };

  const handleDeleteScene = async (scene: UserScene) => {
    if (!window.confirm(`Delete "${scene.title}" from your library?`)) return;
    setActionError(null);
    try {
      await deleteUserScene(scene.id);
      await refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Could not delete scene");
    }
  };

  const handleToggleShare = async (scene: UserScene) => {
    setActionError(null);
    try {
      await setUserScenePublic(scene.id, !scene.isPublic);
      await refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Could not update sharing");
    }
  };

  const handleCopyShareLink = async (scene: UserScene) => {
    if (!scene.isPublic) {
      setActionError("Make the scene public before sharing the link.");
      return;
    }
    try {
      await navigator.clipboard.writeText(buildSceneShareUrl(scene.id));
    } catch {
      setActionError("Could not copy link.");
    }
  };

  const saveDisplayName = async () => {
    if (!nameEdit.trim()) return;
    setActionError(null);
    try {
      await updateDisplayName(nameEdit.trim());
      await useAuthStore.getState().refreshProfile();
      setNameEdit("");
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Could not update name");
    }
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-black text-[#e8ecf4] md:flex-row">
      <aside
        className="flex max-h-[min(50vh,28rem)] min-h-0 w-full shrink-0 flex-col border-b border-[var(--flux-border)] bg-black md:h-full md:max-h-none md:w-[280px] md:border-b-0 md:border-r"
        aria-label="Account and access"
      >
        <div className="flux-panel-header flex items-center gap-2.5 px-3 py-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--flux-border)] bg-black text-base font-semibold text-white">
            φ
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight text-white">Flux</p>
            <p className="truncate text-[10px] text-white/40">Operations console</p>
          </div>
        </div>

        <div className="flux-scroll flex min-h-0 flex-1 flex-col space-y-4 overflow-y-auto overflow-x-hidden p-3">
          {user && profile ? (
            <div className="rounded-lg border border-[var(--flux-border)] bg-black px-2.5 py-2">
              <p className="truncate text-xs font-medium text-white/90">{profile.displayName}</p>
              <p className="truncate text-[10px] text-white/45">{user.email}</p>
              {profile.defaultNameAssigned && (
                <p className="mt-1.5 text-[10px] leading-snug text-white/50">
                  Display name is still the generated default — set a public name in the main panel.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <Link
                href="/auth/login"
                className="flux-btn block px-3 py-2 text-center text-xs font-medium text-white/85"
              >
                Sign in
              </Link>
              <Link
                href="/auth/signup"
                className="block rounded-md border border-[var(--flux-border)] bg-white/[0.06] px-3 py-2 text-center text-xs font-medium text-white transition hover:bg-white/[0.09]"
              >
                Create account
              </Link>
            </div>
          )}
        </div>

        {user && (
          <button
            type="button"
            onClick={() => void signOut()}
            className="border-t border-[var(--flux-border)] px-3 py-2.5 text-left text-[11px] text-white/45 transition hover:bg-white/[0.03] hover:text-white/70"
          >
            Sign out
          </button>
        )}
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="shrink-0 border-b border-[var(--flux-border)] px-6 py-4 sm:px-10">
          <div className="mx-auto w-full max-w-sm">
            <JoinCodeInput
              key={joinInputKey}
              onSubmit={(c) => handleJoin(c)}
              loading={joinLoading}
              centered
            />
            {!user && (
              <button
                type="button"
                disabled={joinLoading || launchingBenchId !== null}
                onClick={() => {
                  const code = window.prompt("Public room · 6-digit code");
                  const parsed = joinCodeSchema.safeParse(code);
                  if (parsed.success) void handleJoin(parsed.data, true);
                  else setActionError(parsed.error.issues[0]?.message ?? "Enter a 6-digit room code");
                }}
                className="mt-2 w-full text-center text-[10px] text-white/40 transition hover:text-white/65"
              >
                Spectate as guest
              </button>
            )}
          </div>
        </header>

        <main className="flux-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain">
          <div className="border-b border-[var(--flux-border)] px-6 py-6 sm:px-10">
            {error && (
              <p className="mb-4 rounded-md border border-red-500/40 bg-red-950/30 px-3 py-2 text-sm text-red-300">
                {error}
              </p>
            )}
            {loadState === "loading" && catalog.length === 0 && publicRooms.length === 0 && (
              <p className="mb-4 text-sm text-white/40">Loading rooms and scenes…</p>
            )}
            {loadState === "ready" && catalog.length === 0 && publicRooms.length === 0 && (
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <p className="text-sm text-white/45">No scenes or public rooms loaded yet.</p>
                <button
                  type="button"
                  onClick={() => void refresh()}
                  className="flux-btn px-2.5 py-1 text-[11px] text-white/70"
                >
                  Retry
                </button>
              </div>
            )}

            {recentRooms.length > 0 && (
              <section className="mb-6">
                <SectionTitle>Continue</SectionTitle>
                <p className="mt-2 text-[11px] text-white/45">
                  Recently visited rooms on this device.
                </p>
                <ul className="mt-3 space-y-2">
                  {recentRooms.map((r) => (
                    <li
                      key={r.roomId}
                      className="flex items-center justify-between gap-3 rounded-lg border border-[var(--flux-border)] bg-black px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-white/88">{r.title}</p>
                        <p className="text-[10px] font-mono text-white/38">
                          {r.module} · {r.joinCode}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          disabled={joinLoading || continuingRoomId === r.roomId}
                          onClick={() => void handleContinueRecent(r)}
                          className="flux-btn px-3 py-1.5 text-[11px] text-white/85 disabled:opacity-40"
                        >
                          {continuingRoomId === r.roomId ? "Opening…" : "Continue"}
                        </button>
                        <button
                          type="button"
                          disabled={joinLoading}
                          onClick={() => handleRemoveRecent(r.roomId)}
                          className="rounded-md px-2 py-1 text-[10px] text-white/35 hover:text-white/60"
                          aria-label={`Remove ${r.title} from recent`}
                        >
                          ✕
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {user && profile && (
              <section className="mb-2 max-w-lg">
                <SectionTitle>Public display name</SectionTitle>
                <p className="mb-2 mt-1 text-[11px] text-white/45">
                  Shown on presence, chat attribution, and membership rosters.
                </p>
                <div className="flex gap-2">
                  <input
                    value={nameEdit}
                    onChange={(e) => setNameEdit(e.target.value)}
                    placeholder={profile.displayName}
                    className="flux-btn flex-1 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-[var(--flux-border-active)]"
                  />
                  <button
                    type="button"
                    onClick={() => void saveDisplayName()}
                    className="flux-btn px-4 py-2 text-xs font-medium text-white/85"
                  >
                    Save
                  </button>
                </div>
              </section>
            )}
          </div>

          <CollapsibleHubSection
            title="Engine benches"
            description="Deterministic torture tests for Matter.js integration. Each run provisions a private room, serializes the preset, and drops you on the timeline with the bench query parameter intact."
            open={benchesOpen}
            onToggle={() => setBenchesOpen((v) => !v)}
            trailing={
              !user ? (
                <span className="text-[10px] font-mono uppercase tracking-wider text-white/35">
                  Sign in to spawn
                </span>
              ) : undefined
            }
          >
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {TEST_LAYOUTS.map((layout) => (
                <button
                  key={layout.id}
                  type="button"
                  disabled={!user || launchingBenchId === layout.id}
                  onClick={() => void handleLaunchTestLayout(layout.id)}
                  className="group relative overflow-hidden rounded-lg border border-[var(--flux-border)] bg-black px-4 py-3.5 text-left transition hover:border-[var(--flux-border-hover)] hover:bg-white/[0.02] disabled:opacity-40"
                >
                  <span
                    className="absolute inset-y-3 left-0 w-px bg-white/35 transition group-hover:bg-white/55"
                    aria-hidden
                  />
                  <p className="pl-3 text-sm font-medium text-white/92">{layout.title}</p>
                  <p className="mt-1.5 pl-3 text-[11px] leading-snug text-white/48 line-clamp-3">
                    {layout.description}
                  </p>
                  <p className="mt-3 pl-3 font-mono text-[9px] uppercase tracking-[0.16em] text-white/38">
                    {layout.tests}
                  </p>
                  <p className="mt-2 pl-3 text-[10px] text-white/30 opacity-0 transition group-hover:opacity-100">
                    Open workspace →
                  </p>
                </button>
              ))}
            </div>
          </CollapsibleHubSection>

          <CollapsibleHubSection
            title="Starter labs"
            description="Curated scene_catalog entries hydrate through Supabase with slug-keyed authoring presets."
            open={starterLabsOpen}
            onToggle={() => setStarterLabsOpen((v) => !v)}
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {catalog.map((scene) => (
                <button
                  key={scene.id}
                  type="button"
                  disabled={joinLoading || launchingBenchId !== null}
                  onClick={() => void handleCreateFromCatalog(scene)}
                  className="rounded-lg border border-[var(--flux-border)] bg-black px-4 py-3.5 text-left transition hover:border-[var(--flux-border-hover)] hover:bg-white/[0.02]"
                >
                  <p className="text-sm font-medium text-white/90">{scene.title}</p>
                  <p className="mt-1.5 text-[11px] leading-snug text-white/48">{scene.description}</p>
                  <p className="mt-3 text-[10px] font-mono uppercase tracking-wider text-white/35">
                    {user ? "Create hosted room →" : "Authenticate to host"}
                  </p>
                </button>
              ))}
            </div>
          </CollapsibleHubSection>

          {user && (
            <section className="border-b border-[var(--flux-border)] px-6 py-8 sm:px-10">
              <SectionTitle>My library</SectionTitle>
              <p className="mt-2 text-[11px] text-white/45">
                Saved scenes ({myScenes.length}/{USER_SCENE_LIMIT}). Save from the workspace Scene → Library panel.
              </p>
              {myScenes.length === 0 ? (
                <p className="mt-3 max-w-xl text-sm text-white/40">
                  Build a scene in the workspace, pause at the setup frame, then save it from the Library panel in the right sidebar.
                </p>
              ) : (
                <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {myScenes.map((s) => (
                    <li
                      key={s.id}
                      className="flex flex-col rounded-lg border border-[var(--flux-border)] bg-black px-4 py-3"
                    >
                      {editingSceneId === s.id ? (
                        <div className="flex flex-col gap-2">
                          <input
                            type="text"
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            className="rounded-md border border-[var(--flux-border)] bg-black/40 px-2 py-1.5 text-sm text-white outline-none focus:border-[var(--flux-border-hover)]"
                            autoFocus
                          />
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => void handleRenameScene(s.id)}
                              className="flux-btn px-2 py-1 text-[10px] text-white/85"
                            >
                              Save name
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingSceneId(null);
                                setEditTitle("");
                              }}
                              className="text-[10px] text-white/45 hover:text-white/70"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <p className="text-sm font-medium text-white/90">{s.title}</p>
                          <p className="mt-1 text-[10px] font-mono uppercase tracking-wider text-white/35">
                            {s.module}
                          </p>
                          <p className="mt-1 text-[10px] text-white/35">
                            Updated {new Date(s.updatedAt).toLocaleDateString()}
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={openingSceneId === s.id || joinLoading}
                              onClick={() => void handleOpenUserScene(s)}
                              className="flux-btn px-2.5 py-1 text-[10px] text-white/85 disabled:opacity-40"
                            >
                              {openingSceneId === s.id ? "Opening…" : "Open workspace"}
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleToggleShare(s)}
                              className={`rounded-md border px-2.5 py-1 text-[10px] ${
                                s.isPublic
                                  ? "border-emerald-900/50 text-emerald-400/80"
                                  : "border-[var(--flux-border)] text-white/60 hover:text-white/85"
                              }`}
                            >
                              {s.isPublic ? "Public" : "Make public"}
                            </button>
                            <button
                              type="button"
                              disabled={!s.isPublic}
                              onClick={() => void handleCopyShareLink(s)}
                              className="rounded-md border border-[var(--flux-border)] px-2.5 py-1 text-[10px] text-white/60 hover:text-white/85 disabled:opacity-40"
                            >
                              Copy link
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingSceneId(s.id);
                                setEditTitle(s.title);
                              }}
                              className="rounded-md border border-[var(--flux-border)] px-2.5 py-1 text-[10px] text-white/60 hover:text-white/85"
                            >
                              Rename
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDeleteScene(s)}
                              className="rounded-md border border-red-900/40 px-2.5 py-1 text-[10px] text-red-400/70 hover:text-red-400"
                            >
                              Delete
                            </button>
                          </div>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {publicRooms.length > 0 && (
            <section className="px-6 py-8 sm:px-10">
              <SectionTitle>Public halls</SectionTitle>
              <p className="mt-2 text-[11px] text-white/45">
                Discoverable rooms on this deployment (spectate without an account when allowed).
              </p>
              <ul className="mt-4 space-y-2">
                {publicRooms.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between rounded-lg border border-[var(--flux-border)] bg-black px-3 py-2.5"
                  >
                    <div>
                      <p className="text-sm text-white/88">{r.title}</p>
                      <p className="text-[10px] font-mono text-white/40">
                        {r.module}/{r.slug}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={joinLoading || launchingBenchId !== null}
                      onClick={() => void handleJoin(r.joinCode, !user)}
                      className="flux-btn px-3 py-1.5 text-[11px] text-white/75"
                    >
                      {user ? "Join" : "Spectate"}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
