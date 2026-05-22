"use client";

import { useEffect, useState } from "react";
import { useSimulationStore } from "@/store/simulationStore";
import { useCanWriteInRoom, useRoomSessionStore } from "@/store/roomSessionStore";
import { isAtSharedSetupFrame } from "@/store/simulationStore";
import {
  clearAuthoringUndoDebugLog,
  getAuthoringUndoDebugLog,
  getAuthoringUndoStackDebugCounts,
  getAuthoringUndoStackEntrySummaries,
  isAuthoringUndoDebugEnabled,
  setAuthoringUndoDebugEnabled,
} from "@/lib/scene/authoringHistoryDebug";

/** Temporary on-canvas HUD for undo/redo diagnosis (dev). */
export function AuthoringUndoDebugHud() {
  const [, bump] = useState(0);
  const engine = useSimulationStore((s) => s.engine);
  const isPlaying = useSimulationStore((s) => s.isPlaying);
  const historyIndex = useSimulationStore((s) => s.historyIndex);
  const historyLength = useSimulationStore((s) => s.historyLength);
  const canUndo = useSimulationStore((s) => s.canUndoAuthoring());
  const canRedo = useSimulationStore((s) => s.canRedoAuthoring());
  const canWrite = useCanWriteInRoom();
  const role = useRoomSessionStore((s) => s.membership?.role ?? "none");

  useEffect(() => {
    const id = window.setInterval(() => bump((n) => n + 1), 400);
    return () => window.clearInterval(id);
  }, []);

  if (!isAuthoringUndoDebugEnabled()) return null;

  const stack = getAuthoringUndoStackDebugCounts();
  const entries = getAuthoringUndoStackEntrySummaries();
  const log = getAuthoringUndoDebugLog();
  const atSetup = isAtSharedSetupFrame({ historyIndex, historyLength });

  return (
    <div
      className="pointer-events-auto absolute bottom-14 left-3 z-[90] max-w-[min(420px,calc(100%-1.5rem))] rounded-lg border border-amber-500/40 bg-black/90 p-2 font-mono text-[10px] leading-snug text-amber-100/90 shadow-lg"
      aria-label="Undo debug HUD"
    >
      <div className="mb-1 flex items-center justify-between gap-2 border-b border-amber-500/25 pb-1">
        <span className="font-semibold text-amber-300">Undo debug (temp)</span>
        <button
          type="button"
          className="rounded px-1.5 py-0.5 text-[9px] text-amber-200/70 hover:bg-white/10"
          onClick={() => {
            setAuthoringUndoDebugEnabled(false);
            bump((n) => n + 1);
          }}
        >
          hide
        </button>
      </div>
      <div className="grid gap-0.5 text-[9px] text-white/75">
        <div>engine: {engine ? "yes" : "NO"} · canWrite: {canWrite ? "yes" : "NO"} · role: {role}</div>
        <div>
          playing: {isPlaying ? "yes" : "no"} · timeline: idx={historyIndex} len={historyLength} · setup:{" "}
          {atSetup ? "yes" : "no"}
        </div>
        <div>
          stack: entries={stack.entryCount} index={stack.index} · canUndo={stack.canUndo ? "yes" : "NO"}{" "}
          · canRedo={stack.canRedo ? "yes" : "NO"}
        </div>
        <div>
          store: canUndoAuthoring={canUndo ? "yes" : "NO"} · canRedoAuthoring={canRedo ? "yes" : "NO"}
        </div>
      </div>
      {entries.length > 0 && (
        <div className="mt-1 max-h-16 overflow-y-auto border-t border-amber-500/20 pt-1 text-[9px] text-white/60">
          {entries.map((line, i) => (
            <div key={`stack-${i}`}>{line}</div>
          ))}
        </div>
      )}
      <div className="mt-1 max-h-24 overflow-y-auto border-t border-amber-500/20 pt-1">
        {log.length === 0 ? (
          <div className="text-white/40">No events yet — try Ctrl+Z or spawn an object</div>
        ) : (
          log.slice(0, 8).map((e) => (
            <div key={e.id} className="text-[9px] text-white/55">
              <span className="text-amber-400/80">{e.kind}</span> {e.detail}
            </div>
          ))
        )}
      </div>
      <button
        type="button"
        className="mt-1 text-[9px] text-amber-200/60 underline hover:text-amber-100"
        onClick={() => {
          clearAuthoringUndoDebugLog();
          bump((n) => n + 1);
        }}
      >
        clear log
      </button>
    </div>
  );
}
