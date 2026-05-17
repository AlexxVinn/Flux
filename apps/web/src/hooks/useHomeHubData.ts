"use client";

import { useCallback, useEffect, useState } from "react";
import type { CatalogScene, UserScene } from "@flux/shared";
import { fetchCatalogScenes, fetchPublicRooms, fetchUserScenes } from "@/lib/rooms/api";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { waitForAuthReady } from "@/lib/supabase/waitForAuth";
import { useAuthStore } from "@/store/authStore";

const REFRESH_MS = 30_000;

export type HomeHubLoadState = "idle" | "loading" | "ready" | "error";

export function useHomeHubData() {
  const initialized = useAuthStore((s) => s.initialized);
  const user = useAuthStore((s) => s.user);

  const [catalog, setCatalog] = useState<CatalogScene[]>([]);
  const [myScenes, setMyScenes] = useState<UserScene[]>([]);
  const [publicRooms, setPublicRooms] = useState<
    Array<{ id: string; slug: string; title: string; module: string; joinCode: string }>
  >([]);
  const [loadState, setLoadState] = useState<HomeHubLoadState>("idle");
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setLoadState("error");
      setLoadError(
        "Supabase is not configured. Add keys to apps/web/.env.local and restart the dev server.",
      );
      return;
    }

    setLoadState((s) => (s === "ready" ? "ready" : "loading"));
    setLoadError(null);

    try {
      await waitForAuthReady();
      const [cat, rooms, scenes] = await Promise.all([
        fetchCatalogScenes(),
        fetchPublicRooms(),
        user ? fetchUserScenes() : Promise.resolve([] as UserScene[]),
      ]);
      setCatalog(cat);
      setPublicRooms(rooms);
      setMyScenes(scenes);
      setLoadState("ready");
    } catch (e) {
      setLoadState("error");
      setLoadError(e instanceof Error ? e.message : "Could not load rooms and scenes");
    }
  }, [user]);

  useEffect(() => {
    if (!initialized) return;
    void refresh();
  }, [initialized, refresh]);

  useEffect(() => {
    if (!initialized || loadState !== "ready") return;
    const id = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [initialized, loadState, refresh]);

  useEffect(() => {
    if (!initialized) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [initialized, refresh]);

  return {
    catalog,
    myScenes,
    publicRooms,
    loadState,
    loadError,
    refresh,
  };
}
