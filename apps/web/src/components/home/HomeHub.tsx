"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { CatalogScene, UserScene } from "@flux/shared";
import { JoinCodeInput } from "@/components/room/JoinCodeInput";
import { useAuthStore } from "@/store/authStore";
import { useRoomSessionStore } from "@/store/roomSessionStore";
import {
  createRoom,
  fetchCatalogScenes,
  fetchPublicRooms,
  fetchUserScenes,
  joinRoomByCode,
} from "@/lib/rooms/api";
import {
  buildWorkspacePath,
  clearPendingRoomJoin,
  TEST_LAYOUTS,
  type TestLayoutId,
} from "@/lib/physics/testLayouts";
import { snapshotForServer } from "@/lib/scene/storedScene";
import { FLUX_WORLD } from "@/lib/physics/worldSpace";
import { updateDisplayName } from "@/lib/auth/profile";
import { isSupabaseConfigured } from "@/lib/supabase/env";

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">{children}</h2>
  );
}

export function HomeHub() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const profile = useAuthStore((s) => s.profile);
  const signOut = useAuthStore((s) => s.signOut);
  const setMembership = useRoomSessionStore((s) => s.setMembership);

  const [catalog, setCatalog] = useState<CatalogScene[]>([]);
  const [myScenes, setMyScenes] = useState<UserScene[]>([]);
  const [publicRooms, setPublicRooms] = useState<
    Array<{ id: string; slug: string; title: string; module: string; joinCode: string }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameEdit, setNameEdit] = useState("");

  const goWorkspace = useCallback(
    (
      membership: Awaited<ReturnType<typeof joinRoomByCode>>,
      opts?: { benchId?: TestLayoutId },
    ) => {
      setMembership(membership);
      router.push(buildWorkspacePath(membership.module, membership.slug, opts?.benchId));
    },
    [router, setMembership],
  );

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setError(
        "Supabase is not configured. Add keys to apps/web/.env.local and restart the dev server.",
      );
      return;
    }
    void fetchCatalogScenes().then(setCatalog);
    void fetchPublicRooms().then(setPublicRooms);
    if (user) void fetchUserScenes().then(setMyScenes);
  }, [user]);

  const handleJoin = async (code: string, anonymous = false) => {
    setError(null);
    setLoading(true);
    try {
      const m = await joinRoomByCode(code, { anonymous });
      goWorkspace(m);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not join room");
    } finally {
      setLoading(false);
    }
  };

  const handleLaunchTestLayout = async (layoutId: TestLayoutId) => {
    setError(null);
    if (!user) {
      router.push("/auth/login");
      return;
    }
    setLoading(true);
    try {
      const layout = TEST_LAYOUTS.find((l) => l.id === layoutId);
      if (!layout) {
        setError("Unknown bench");
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
      clearPendingRoomJoin();
      setMembership(m);
      router.push(buildWorkspacePath(m.module, m.slug, layoutId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open test layout");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateFromCatalog = async (scene: CatalogScene) => {
    if (!user) {
      router.push("/auth/login");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const m = await createRoom({
        title: scene.title,
        module: scene.module,
        visibility: "private",
        catalogId: scene.id,
      });
      goWorkspace(m);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create room");
    } finally {
      setLoading(false);
    }
  };

  const saveDisplayName = async () => {
    if (!nameEdit.trim()) return;
    setError(null);
    try {
      await updateDisplayName(nameEdit.trim());
      await useAuthStore.getState().refreshProfile();
      setNameEdit("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update name");
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

          <div>
            <SectionTitle>Join session</SectionTitle>
            <p className="mb-2 mt-1 text-[10px] leading-snug text-white/38">
              Six-digit room codes mirror the header chip inside a workspace.
            </p>
            <JoinCodeInput onSubmit={(c) => handleJoin(c)} loading={loading} />
          </div>

          {!user && (
            <button
              type="button"
              disabled={loading}
              onClick={() => {
                const code = window.prompt("Public room · 6-digit code");
                if (code) void handleJoin(code, true);
              }}
              className="flux-btn w-full px-3 py-2 text-left text-[11px] text-white/55"
            >
              Enter as guest spectator…
            </button>
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
        <header className="flux-panel-header shrink-0 px-6 py-10 sm:px-10">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/40">
            Collaborative mechanics workspace
          </p>
          <h1 className="mt-3 max-w-3xl text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Host Newtonian rigs with a shared timeline, scene operations, and presence-ready rooms.
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-white/55">
            Bench scenarios are deterministic stress tests. Starter labs ship curated snapshots. Public join
            codes let cohorts drop into the same Matter-backed canvas without leaving the browser.
          </p>
          <dl className="mt-8 grid max-w-3xl gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-[var(--flux-border)] bg-black/80 px-3 py-2.5">
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-white/35">
                Scene graph
              </dt>
              <dd className="mt-1 text-xs text-white/70">Bodies, springs, and server-acked patches.</dd>
            </div>
            <div className="rounded-lg border border-[var(--flux-border)] bg-black/80 px-3 py-2.5">
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-white/35">
                Live revisioning
              </dt>
              <dd className="mt-1 text-xs text-white/70">Rooms carry `scene_revision` for teach/pause loops.</dd>
            </div>
            <div className="rounded-lg border border-[var(--flux-border)] bg-black/80 px-3 py-2.5">
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-white/35">
                Access tiers
              </dt>
              <dd className="mt-1 text-xs text-white/70">Admin · member authoring · spectator students.</dd>
            </div>
          </dl>
        </header>

        <main className="flux-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain">
          <div className="border-b border-[var(--flux-border)] px-6 py-6 sm:px-10">
            {error && (
              <p className="mb-4 rounded-md border border-red-500/40 bg-red-950/30 px-3 py-2 text-sm text-red-300">
                {error}
              </p>
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

          <section className="border-b border-[var(--flux-border)] px-6 py-8 sm:px-10">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
              <div>
                <SectionTitle>Engine benches</SectionTitle>
                <p className="mt-2 max-w-2xl text-[11px] leading-relaxed text-white/45">
                  Deterministic torture tests for Matter.js integration. Each run provisions a private room,
                  serializes the preset, and drops you on the timeline with the bench query parameter intact.
                </p>
              </div>
              {!user && (
                <span className="text-[10px] font-mono uppercase tracking-wider text-white/35">
                  Sign in to spawn
                </span>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {TEST_LAYOUTS.map((layout) => (
                <button
                  key={layout.id}
                  type="button"
                  disabled={loading || !user}
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
          </section>

          <section className="border-b border-[var(--flux-border)] px-6 py-8 sm:px-10">
            <div className="mb-5">
              <SectionTitle>Starter labs</SectionTitle>
              <p className="mt-2 max-w-2xl text-[11px] leading-relaxed text-white/45">
                Curated `scene_catalog` entries hydrate through Supabase with slug-keyed authoring presets.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {catalog.map((scene) => (
                <button
                  key={scene.id}
                  type="button"
                  disabled={loading}
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
          </section>

          {user && (
            <section className="border-b border-[var(--flux-border)] px-6 py-8 sm:px-10">
              <SectionTitle>Local scene quota</SectionTitle>
              <p className="mt-2 text-[11px] text-white/45">
                Saved snapshots per researcher ({myScenes.length}/3).
              </p>
              {myScenes.length === 0 ? (
                <p className="mt-3 max-w-xl text-sm text-white/40">
                  Pin scenes from the inspector once the export path lands — quota enforces light-weight
                  iteration.
                </p>
              ) : (
                <ul className="mt-4 grid gap-2 sm:grid-cols-3">
                  {myScenes.map((s) => (
                    <li
                      key={s.id}
                      className="rounded-lg border border-[var(--flux-border)] px-3 py-2 text-sm text-white/80"
                    >
                      {s.title}
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
                      disabled={loading}
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
