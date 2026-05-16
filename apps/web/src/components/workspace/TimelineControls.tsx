"use client";

import { useCallback } from "react";
import {
  useSimulationStore,
  SPEEDS,
  type SimSpeed,
  isAtSharedSetupFrame,
} from "@/store/simulationStore";
import { useRoomSceneCollaborationStore } from "@/store/roomSceneCollaborationStore";
import { useRoomSessionStore } from "@/store/roomSessionStore";

function formatTime(ms: number): string {
  const s = ms / 1000;
  return s < 10 ? `${s.toFixed(2)}s` : `${s.toFixed(1)}s`;
}

export function TimelineControls() {
  const isPlaying = useSimulationStore((s) => s.isPlaying);
  const speed = useSimulationStore((s) => s.speed);
  const tick = useSimulationStore((s) => s.snapshot.tick);
  const historyIndex = useSimulationStore((s) => s.historyIndex);
  const historyLength = useSimulationStore((s) => s.historyLength);
  const elapsedMs = useSimulationStore((s) => s.elapsedMs);

  const setPlaying = useSimulationStore((s) => s.setPlaying);
  const setSpeed = useSimulationStore((s) => s.setSpeed);
  const resetToFirstFrame = useSimulationStore((s) => s.resetToFirstFrame);
  const scrubTo = useSimulationStore((s) => s.scrubTo);
  const setScrubbing = useSimulationStore((s) => s.setScrubbing);
  const stepForward = useSimulationStore((s) => s.stepForward);
  const stepBackward = useSimulationStore((s) => s.stepBackward);
  const goLive = useSimulationStore((s) => s.goLive);

  const membership = useRoomSessionStore((s) => s.membership);
  const roomSceneRoomId = useRoomSceneCollaborationStore((s) => s.roomId);
  const refreshFromServer = useRoomSceneCollaborationStore((s) => s.refreshFromServer);

  const collaborative =
    !!membership?.roomId &&
    membership.roomId === roomSceneRoomId &&
    (membership.role === "admin" || membership.role === "member");

  const displayIndex =
    historyIndex < 0 ? Math.max(0, historyLength - 1) : historyIndex;
  const maxIndex = Math.max(0, historyLength - 1);
  const atLive = historyIndex < 0;
  const atSetup = isAtSharedSetupFrame({ historyIndex, historyLength });

  const onScrubInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      scrubTo(Number(e.target.value));
    },
    [scrubTo],
  );

  const onScrubStart = () => {
    setScrubbing(true);
    if (!collaborative) {
      setPlaying(false);
    }
  };

  const onScrubEnd = () => {
    setScrubbing(false);
  };

  const togglePlay = () => {
    if (isPlaying) {
      setPlaying(false);
      return;
    }
    setPlaying(true);
  };

  /** Live = shared setup (frame 0): pull authoritative scene, then scrub to frame 0. */
  const onLive = () => {
    setPlaying(false);
    if (collaborative) {
      void (async () => {
        const ok = await refreshFromServer();
        const snap = useRoomSceneCollaborationStore.getState().lastServerSnapshot;
        const sim = useSimulationStore.getState();
        if (ok && snap && sim.engine) {
          sim.reconcilePausedEngineWithServerSnapshot(snap, { refitCamera: true });
        }
        useSimulationStore.getState().scrubTo(0);
      })();
      return;
    }
    goLive();
  };

  const btn =
    "flux-btn px-2.5 py-1 text-xs font-medium text-white/75 disabled:opacity-40";

  return (
    <div className="flex h-full min-h-0 flex-col justify-center px-3 py-2">
      <div className="mb-2 flex items-center gap-1.5">
        <input
          type="range"
          min={0}
          max={maxIndex}
          value={displayIndex}
          disabled={historyLength <= 1}
          onChange={onScrubInput}
          onPointerDown={onScrubStart}
          onPointerUp={onScrubEnd}
          className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-flux-border accent-[var(--flux-accent,#6ee7b7)] disabled:cursor-default [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-flux-text"
          aria-label="Simulation timeline"
        />
        <span className="shrink-0 font-mono text-[10px] text-flux-muted tabular-nums">
          {displayIndex + 1}/{historyLength || 1}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={togglePlay} className={btn} aria-label={isPlaying ? "Pause" : "Play"}>
          {isPlaying ? "Pause" : "Play"}
        </button>
        <button type="button" onClick={resetToFirstFrame} className={btn} title="Jump to frame 0">
          Reset
        </button>

        <div className="h-4 w-px bg-flux-border" aria-hidden />

        <button
          type="button"
          onClick={stepBackward}
          disabled={historyLength <= 1 || displayIndex <= 0}
          className={btn}
          title="Step backward"
        >
          −1
        </button>
        <button
          type="button"
          onClick={stepForward}
          disabled={historyLength <= 1}
          className={btn}
          title="Step forward"
        >
          +1
        </button>

        {(!atSetup || collaborative) && (
          <button
            type="button"
            onClick={onLive}
            className={`${btn} text-flux-muted`}
            title={
              collaborative
                ? "Pull shared setup and go to frame 0"
                : "Go to frame 0 (setup)"
            }
          >
            Live
          </button>
        )}

        <div className="h-4 w-px bg-flux-border" aria-hidden />

        <label className="flex items-center gap-1.5 text-[10px] text-flux-muted">
          Speed
          <select
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value) as SimSpeed)}
            className="rounded border border-flux-border bg-flux-bg px-1.5 py-0.5 text-xs text-flux-text"
          >
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </label>

        <span className="ml-auto flex items-center gap-3 font-mono text-[10px] text-flux-muted tabular-nums">
          <span>tick {tick}</span>
          <span>{formatTime(elapsedMs)}</span>
          {collaborative && atSetup && <span className="text-emerald-400/90">setup</span>}
          {collaborative && !atSetup && <span className="text-amber-400/90">preview</span>}
          {!collaborative && !atLive && <span className="text-amber-400/90">review</span>}
        </span>
      </div>
    </div>
  );
}
