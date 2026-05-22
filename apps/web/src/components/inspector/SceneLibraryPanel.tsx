"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  useSimulationStore,
  isAtSharedSetupFrame,
} from "@/store/simulationStore";
import { useCanWriteInRoom, useRoomSessionStore } from "@/store/roomSessionStore";
import { useRoomSceneCollaborationStore } from "@/store/roomSceneCollaborationStore";
import { useAuthStore } from "@/store/authStore";
import { snapshotForServer, toSimulationSnapshot } from "@/lib/scene/storedScene";
import {
  saveUserScene,
  updateUserScene,
  USER_SCENE_LIMIT,
} from "@/lib/scenes/userScenes";
import { fetchUserScenes } from "@/lib/rooms/api";
import type { UserScene } from "@flux/shared";
import { InspectorButton, InspectorButtonRow, InspectorHint } from "./inspector-ui";

export function SceneLibraryPanel({ bare = false }: { bare?: boolean }) {
  const user = useAuthStore((s) => s.user);
  const snapshot = useSimulationStore((s) => s.snapshot);
  const gravityEnabled = useSimulationStore((s) => s.gravityEnabled);
  const isPlaying = useSimulationStore((s) => s.isPlaying);
  const historyIndex = useSimulationStore((s) => s.historyIndex);
  const historyLength = useSimulationStore((s) => s.historyLength);
  const canWrite = useCanWriteInRoom();
  const membership = useRoomSessionStore((s) => s.membership);
  const lastServerSnapshot = useRoomSceneCollaborationStore((s) => s.lastServerSnapshot);
  const roomSceneRoomId = useRoomSceneCollaborationStore((s) => s.roomId);

  const [title, setTitle] = useState("");
  const [myScenes, setMyScenes] = useState<UserScene[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [overwriteId, setOverwriteId] = useState<string | null>(null);

  const collaborative =
    !!membership?.roomId &&
    membership.roomId === roomSceneRoomId &&
    (membership.role === "admin" || membership.role === "member");
  const atSharedSetup = isAtSharedSetupFrame({ historyIndex, historyLength });
  const canSave =
    !!user &&
    canWrite &&
    !isPlaying &&
    (!collaborative || atSharedSetup);

  const refreshScenes = useCallback(async () => {
    if (!user) {
      setMyScenes([]);
      return;
    }
    const scenes = await fetchUserScenes();
    setMyScenes(scenes);
  }, [user]);

  useEffect(() => {
    void refreshScenes();
  }, [refreshScenes]);

  useEffect(() => {
    if (membership?.title && !title) {
      setTitle(membership.title);
    }
  }, [membership?.title, title]);

  const buildSnapshot = useCallback(() => {
    const base =
      collaborative && lastServerSnapshot
        ? toSimulationSnapshot(lastServerSnapshot)
        : snapshot;
    return snapshotForServer(base, gravityEnabled);
  }, [collaborative, lastServerSnapshot, snapshot, gravityEnabled]);

  const handleSave = async (opts?: { overwriteId?: string }) => {
    setError(null);
    setStatus(null);
    if (!user) {
      setError("Sign in to save scenes.");
      return;
    }
    if (!canSave) {
      setError("Pause at the setup frame before saving.");
      return;
    }

    setLoading(true);
    try {
      const stored = buildSnapshot();
      const sceneTitle = title.trim() || membership?.title || "Untitled scene";
      const module = membership?.module ?? "mechanics";
      const targetId = opts?.overwriteId ?? overwriteId;

      if (targetId) {
        await updateUserScene(targetId, { title: sceneTitle, snapshot: stored });
        setStatus("Scene updated.");
        setOverwriteId(null);
      } else {
        await saveUserScene({ title: sceneTitle, module, snapshot: stored });
        setStatus("Saved to library.");
      }
      await refreshScenes();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save scene.");
    } finally {
      setLoading(false);
    }
  };

  const atQuota = myScenes.length >= USER_SCENE_LIMIT;

  const wrap = (content: ReactNode) =>
    bare ? <div className="inspector-pad">{content}</div> : content;

  if (!user) {
    return wrap(
      <p className="inspector-muted">
        Sign in to save scenes to your library (up to {USER_SCENE_LIMIT}).
      </p>,
    );
  }

  return wrap(
    <div className="flex flex-col gap-3">
      <p className="inspector-muted">
        {myScenes.length} / {USER_SCENE_LIMIT} saved
      </p>

      <label className="block">
        <span className="inspector-field-label">Title</span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Untitled scene"
          maxLength={120}
          className="inspector-input"
        />
      </label>

      {!canSave && canWrite && (
        <InspectorHint>
          {isPlaying
            ? "Pause the simulation to save."
            : collaborative
              ? "Go to the setup frame (Live) to save the shared scene."
              : "Return to the setup frame to save."}
        </InspectorHint>
      )}

      <InspectorButtonRow>
        <InspectorButton
          variant="primary"
          disabled={loading || !canSave || (atQuota && !overwriteId)}
          className="flex-1"
          onClick={() => void handleSave()}
        >
          {loading ? "Saving…" : overwriteId ? "Confirm overwrite" : "Save"}
        </InspectorButton>
        {overwriteId && (
          <InspectorButton
            variant="ghost"
            disabled={loading}
            onClick={() => setOverwriteId(null)}
          >
            Cancel
          </InspectorButton>
        )}
      </InspectorButtonRow>

      {atQuota && !overwriteId && (
        <InspectorHint>Quota full — overwrite a scene below or delete from home.</InspectorHint>
      )}

      {myScenes.length > 0 && (
        <ul className="inspector-list !px-0">
          {myScenes.map((s) => (
            <li key={s.id}>
              <div
                className={`inspector-list-item w-full ${
                  overwriteId === s.id ? "inspector-list-item--selected" : ""
                }`}
              >
                <span className="min-w-0 flex-1 truncate font-mono text-[10px]">{s.title}</span>
                <button
                  type="button"
                  disabled={loading || !canSave}
                  onClick={() => {
                    setOverwriteId(s.id);
                    setTitle(s.title);
                  }}
                  className="shrink-0 text-[10px] text-white/35 transition hover:text-white/65 disabled:opacity-35"
                >
                  Overwrite
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {status && <p className="inspector-status-ok">{status}</p>}
      {error && <p className="inspector-status-err">{error}</p>}
    </div>
  );
}
