"use client";

import { create } from "zustand";
import type { RoomMembership } from "@flux/shared";
import {
  normalizeStoredScene,
  type StoredSceneSnapshot,
  applySceneOpToStoredSnapshot,
  type SceneOp,
} from "@/lib/scene/storedScene";
import { rpcApplySceneOp, rpcGetRoomScene, rpcSetPlaybackState } from "@/lib/scene/roomSceneApi";
import {
  markLocalSceneRevisionApplied,
  resetRemoteSceneSyncState,
  snapshotSignature,
} from "@/lib/collaboration/remoteSceneSync";
import { createDbId } from "@/lib/supabase/roomRepository";
import { DEFAULT_SCENE_OBJECT_LIMIT } from "@/lib/scene/sceneLimits";

interface RoomSceneCollaborationState {
  roomId: string | null;
  /** `${roomId}:${memberId}:${collabBindingEpoch}` — when it changes, seq state must reset. */
  collabBindKey: string | null;
  sceneRevision: number;
  playbackRevision: number;
  playbackState: "paused" | "playing";
  objectLimit: number;
  /** Highest scene-op seq this client has committed (local acks). */
  lastAckSeq: number;
  /** Highest remote scene-op seq processed via Realtime (separate from local acks). */
  lastProcessedRemoteSeq: number;
  lastServerSnapshot: StoredSceneSnapshot | null;

  ingestJoinPayload: (raw: unknown) => void;
  /** Returns true when snapshot/revision metadata actually changed. */
  ingestRefreshPayload: (raw: unknown) => boolean;
  setRoomContext: (roomId: string | null) => void;
  /** Idempotent: full reset when membership session or epoch changes (re-entry, same room). */
  rebindToMembershipIfStale: (membership: RoomMembership, collabBindingEpoch: number) => void;
  markPlaybackFromRpc: (
    state: "paused" | "playing",
    playbackRevision: number,
    sceneRevision: number,
    snapshotRaw: unknown,
  ) => void;
  afterLocalApplyAck: (sceneRevision: number, seq: number, snapshotRaw: unknown) => void;
  shouldApplyRemoteSeq: (seq: number) => boolean;
  markRemoteSeqProcessed: (seq: number) => void;
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
  refreshFromServer: () => Promise<{ ok: true; changed: boolean } | { ok: false }>;
}

export const useRoomSceneCollaborationStore = create<RoomSceneCollaborationState>((set, get) => ({
  roomId: null,
  collabBindKey: null,
  sceneRevision: 0,
  playbackRevision: 0,
  playbackState: "paused",
  objectLimit: DEFAULT_SCENE_OBJECT_LIMIT,
  lastAckSeq: 0,
  lastProcessedRemoteSeq: 0,
  lastServerSnapshot: null,

  setRoomContext: (roomId) => {
    if (roomId === null) {
      set({
        roomId: null,
        collabBindKey: null,
        sceneRevision: 0,
        playbackRevision: 0,
        playbackState: "paused",
        lastAckSeq: 0,
        lastProcessedRemoteSeq: 0,
        lastServerSnapshot: null,
      });
      return;
    }
    if (roomId === get().roomId) return;
    set({
      roomId,
      collabBindKey: null,
      sceneRevision: 0,
      playbackRevision: 0,
      playbackState: "paused",
      lastAckSeq: 0,
      lastProcessedRemoteSeq: 0,
      lastServerSnapshot: null,
    });
  },

  rebindToMembershipIfStale: (membership, collabBindingEpoch) => {
    const key = `${membership.roomId}:${membership.memberId}:${collabBindingEpoch}`;
    if (key === get().collabBindKey) return;
    resetRemoteSceneSyncState();
    set({
      collabBindKey: key,
      roomId: membership.roomId,
      sceneRevision: 0,
      playbackRevision: 0,
      playbackState: "paused",
      lastAckSeq: 0,
      lastProcessedRemoteSeq: 0,
      lastServerSnapshot: null,
      objectLimit: DEFAULT_SCENE_OBJECT_LIMIT,
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
      objectLimit:
        typeof d.object_limit === "number" ? d.object_limit : DEFAULT_SCENE_OBJECT_LIMIT,
      lastServerSnapshot: snap,
      lastAckSeq: 0,
      lastProcessedRemoteSeq: 0,
    });
  },

  /** Refresh snapshot/revision from Postgres without resetting op sequence cursors. */
  ingestRefreshPayload: (raw) => {
    if (!raw || typeof raw !== "object") return false;
    const d = raw as Record<string, unknown>;
    const revRaw = d.scene_revision;
    const sceneRevision =
      typeof revRaw === "number" && Number.isFinite(revRaw)
        ? revRaw
        : typeof revRaw === "string" && revRaw !== ""
          ? Number(revRaw)
          : NaN;
    if (!Number.isFinite(sceneRevision)) return false;
    const snap = normalizeStoredScene(d.snapshot ?? {});
    const playbackRevision =
      typeof d.playback_revision === "number" ? d.playback_revision : 0;
    const playbackState = d.playback_state === "playing" ? "playing" : "paused";
    const objectLimit =
      typeof d.object_limit === "number" ? d.object_limit : DEFAULT_SCENE_OBJECT_LIMIT;
    const current = get();
    if (
      current.sceneRevision === sceneRevision &&
      current.playbackRevision === playbackRevision &&
      current.playbackState === playbackState &&
      current.objectLimit === objectLimit &&
      current.lastServerSnapshot &&
      snapshotSignature(current.lastServerSnapshot) === snapshotSignature(snap)
    ) {
      return false;
    }
    set({
      sceneRevision,
      playbackRevision,
      playbackState,
      objectLimit,
      lastServerSnapshot: snap,
    });
    return true;
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
    const roomId = get().roomId;
    set({
      sceneRevision,
      lastAckSeq: Math.max(get().lastAckSeq, seq),
      lastProcessedRemoteSeq: Math.max(get().lastProcessedRemoteSeq, seq),
      lastServerSnapshot: normalizeStoredScene(snapshotRaw),
    });
    if (roomId) markLocalSceneRevisionApplied(sceneRevision, roomId);
  },

  shouldApplyRemoteSeq: (seq) => seq > get().lastProcessedRemoteSeq,

  markRemoteSeqProcessed: (seq) => {
    set({ lastProcessedRemoteSeq: Math.max(get().lastProcessedRemoteSeq, seq) });
  },

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
    if (!roomId) return { ok: false };
    const raw = await rpcGetRoomScene(roomId);
    if (!raw) return { ok: false };
    const changed = get().ingestRefreshPayload(raw);
    return { ok: true, changed };
  },
}));

export function mergeRemoteSceneOp(current: StoredSceneSnapshot, op: SceneOp): StoredSceneSnapshot {
  return applySceneOpToStoredSnapshot(current, op);
}
