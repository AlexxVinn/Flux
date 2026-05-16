"use client";

import { create } from "zustand";
import {
  normalizeStoredScene,
  type StoredSceneSnapshot,
  applySceneOpToStoredSnapshot,
  type SceneOp,
} from "@/lib/scene/storedScene";
import { rpcApplySceneOp, rpcGetRoomScene, rpcSetPlaybackState } from "@/lib/scene/roomSceneApi";
import { createDbId } from "@/lib/supabase/roomRepository";

interface RoomSceneCollaborationState {
  roomId: string | null;
  sceneRevision: number;
  playbackRevision: number;
  playbackState: "paused" | "playing";
  objectLimit: number;
  lastAckSeq: number;
  lastServerSnapshot: StoredSceneSnapshot | null;

  ingestJoinPayload: (raw: unknown) => void;
  setRoomContext: (roomId: string | null) => void;
  markPlaybackFromRpc: (
    state: "paused" | "playing",
    playbackRevision: number,
    sceneRevision: number,
    snapshotRaw: unknown,
  ) => void;
  afterLocalApplyAck: (sceneRevision: number, seq: number, snapshotRaw: unknown) => void;
  shouldApplyRemoteSeq: (seq: number) => boolean;
  commitSceneOp: (
    baseRevision: number,
    op: SceneOp,
  ) => Promise<
    | { ok: true; duplicate?: boolean }
    | { ok: false; code: string; message: string; refreshed?: StoredSceneSnapshot }
  >;
  setPlaybackOnServer: (
    state: "paused" | "playing",
    captureSnapshot?: StoredSceneSnapshot,
  ) => Promise<
    | { ok: true; playback_state: "paused" | "playing"; scene_revision: number; snapshot: unknown }
    | { ok: false; message: string }
  >;
  refreshFromServer: () => Promise<boolean>;
}

export const useRoomSceneCollaborationStore = create<RoomSceneCollaborationState>((set, get) => ({
  roomId: null,
  sceneRevision: 0,
  playbackRevision: 0,
  playbackState: "paused",
  objectLimit: 64,
  lastAckSeq: 0,
  lastServerSnapshot: null,

  setRoomContext: (roomId) => {
    if (roomId === get().roomId) return;
    set({
      roomId,
      sceneRevision: 0,
      playbackRevision: 0,
      playbackState: "paused",
      lastAckSeq: 0,
      lastServerSnapshot: null,
    });
  },

  ingestJoinPayload: (raw) => {
    if (!raw || typeof raw !== "object") return;
    const d = raw as Record<string, unknown>;
    const revRaw = d.scene_revision;
    const sceneRevision =
      typeof revRaw === "number" && Number.isFinite(revRaw)
        ? revRaw
        : typeof revRaw === "string" && revRaw !== ""
          ? Number(revRaw)
          : NaN;
    if (!Number.isFinite(sceneRevision)) return;
    const snap = normalizeStoredScene(d.snapshot ?? {});
    set({
      sceneRevision,
      playbackRevision: typeof d.playback_revision === "number" ? d.playback_revision : 0,
      playbackState: d.playback_state === "playing" ? "playing" : "paused",
      objectLimit: typeof d.object_limit === "number" ? d.object_limit : 64,
      lastServerSnapshot: snap,
      lastAckSeq: 0,
    });
  },

  markPlaybackFromRpc: (state, playbackRevision, sceneRevision, snapshotRaw) => {
    const snap = normalizeStoredScene(snapshotRaw);
    set({
      playbackState: state,
      playbackRevision,
      sceneRevision,
      lastServerSnapshot: snap,
    });
  },

  afterLocalApplyAck: (sceneRevision, seq, snapshotRaw) => {
    set({
      sceneRevision,
      lastAckSeq: Math.max(get().lastAckSeq, seq),
      lastServerSnapshot: normalizeStoredScene(snapshotRaw),
    });
  },

  shouldApplyRemoteSeq: (seq) => seq > get().lastAckSeq,

  commitSceneOp: async (baseRevision, op) => {
    const { roomId } = get();
    if (!roomId) return { ok: false, code: "no_room", message: "No room context" };

    const clientOpId = createDbId();
    const result = await rpcApplySceneOp(roomId, baseRevision, op, clientOpId);

    if (!result.ok) {
      if (result.code === "stale_revision") {
        const raw = await rpcGetRoomScene(roomId);
        if (raw && typeof raw === "object" && "snapshot" in raw) {
          const refreshed = normalizeStoredScene((raw as Record<string, unknown>).snapshot);
          get().ingestJoinPayload(raw);
          return { ok: false, code: result.code, message: result.message, refreshed: refreshed };
        }
      }
      return { ok: false, code: result.code, message: result.message };
    }

    const { result: r } = result;
    if (!r.duplicate) {
      get().afterLocalApplyAck(r.scene_revision, r.seq, r.snapshot);
    } else {
      set({ lastServerSnapshot: normalizeStoredScene(r.snapshot), sceneRevision: r.scene_revision });
    }
    return { ok: true, duplicate: r.duplicate };
  },

  setPlaybackOnServer: async (state, captureSnapshot) => {
    const { roomId } = get();
    if (!roomId) return { ok: false, message: "no room" };
    const res = await rpcSetPlaybackState(roomId, state, captureSnapshot);
    if (!res.ok) return res;
    get().markPlaybackFromRpc(
      res.playback_state,
      res.playback_revision,
      res.scene_revision,
      res.snapshot,
    );
    return {
      ok: true,
      playback_state: res.playback_state,
      scene_revision: res.scene_revision,
      snapshot: res.snapshot,
    };
  },

  refreshFromServer: async () => {
    const { roomId } = get();
    if (!roomId) return false;
    const raw = await rpcGetRoomScene(roomId);
    if (!raw) return false;
    get().ingestJoinPayload(raw);
    return true;
  },
}));

export function mergeRemoteSceneOp(current: StoredSceneSnapshot, op: SceneOp): StoredSceneSnapshot {
  return applySceneOpToStoredSnapshot(current, op);
}
