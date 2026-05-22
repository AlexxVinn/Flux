"use client";

import { useCallback, type ReactNode } from "react";
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
  if (s < 60) return s < 10 ? `${s.toFixed(2)}s` : `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toFixed(1).padStart(4, "0")}`;
}

function TransportButton({
  label,
  title,
  onClick,
  disabled,
  active,
  large,
  children,
}: {
  label: string;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  large?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={label}
      className={`flex shrink-0 items-center justify-center rounded-md transition outline-none focus-visible:ring-1 focus-visible:ring-white/30 disabled:cursor-not-allowed disabled:opacity-30 ${
        large ? "h-10 w-10" : "h-7 w-7"
      } ${
        active
          ? "bg-white/[0.1] text-white"
          : "text-white/55 hover:bg-white/[0.06] hover:text-white/90"
      }`}
    >
      {children}
    </button>
  );
}

function IconPlay() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M4.5 3.2 12.5 8 4.5 12.8Z" />
    </svg>
  );
}

function IconPause() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <rect x="4" y="3" width="3" height="10" rx="0.5" />
      <rect x="9" y="3" width="3" height="10" rx="0.5" />
    </svg>
  );
}

function IconStepBack() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M9 4 4 8l5 4M11 4v8"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconStepForward() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M7 4l5 4-5 4M5 4v8"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconToStart() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M11 4 6 8l5 4M4 4v8"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconSetup() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="2.25" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  );
}

const QUICK_SPEEDS = [0.5, 1, 2] as const satisfies readonly SimSpeed[];

function SpeedControl({
  speed,
  setSpeed,
}: {
  speed: SimSpeed;
  setSpeed: (s: SimSpeed) => void;
}) {
  const isQuick = (QUICK_SPEEDS as readonly number[]).includes(speed);
  const moreSpeeds = SPEEDS.filter((s) => !(QUICK_SPEEDS as readonly number[]).includes(s));

  return (
    <div
      className="flex items-center rounded-md border border-white/[0.06] bg-black/40 p-px"
      role="group"
      aria-label="Playback speed"
    >
      {QUICK_SPEEDS.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => setSpeed(s)}
          className={`min-w-[2rem] rounded-[5px] px-1.5 py-1 font-mono text-[10px] font-medium tabular-nums transition ${
            speed === s
              ? "bg-white/[0.12] text-white"
              : "text-white/40 hover:text-white/70"
          }`}
          aria-pressed={speed === s}
        >
          {s}×
        </button>
      ))}
      {moreSpeeds.length > 0 && (
        <label className="relative flex h-7 items-center">
          <select
            value={isQuick ? "" : String(speed)}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (!Number.isNaN(v)) setSpeed(v as SimSpeed);
            }}
            className={`h-7 cursor-pointer appearance-none rounded-[5px] border-0 bg-transparent font-mono text-[10px] outline-none hover:text-white/70 focus:text-white/85 ${
              isQuick
                ? "w-7 px-1 text-white/35"
                : "w-9 bg-white/[0.12] px-1 text-white"
            }`}
            title="More playback speeds"
            aria-label={isQuick ? "More playback speeds" : `Playback speed ${speed}×`}
          >
            {isQuick ? (
              <option value="" disabled>
                ···
              </option>
            ) : null}
            {moreSpeeds.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

function TimelineScrubRail({
  displayIndex,
  historyLength,
  maxIndex,
  elapsedMs,
  progressPct,
  atSetup,
  scrubDisabled,
  mobile,
  onScrubInput,
  onScrubStart,
  onScrubEnd,
}: {
  displayIndex: number;
  historyLength: number;
  maxIndex: number;
  elapsedMs: number;
  progressPct: number;
  atSetup: boolean;
  scrubDisabled: boolean;
  mobile?: boolean;
  onScrubInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onScrubStart: () => void;
  onScrubEnd: () => void;
}) {
  const frameTotal = historyLength || 1;

  return (
    <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 px-0.5">
      <div className="flex items-center justify-between gap-2 font-mono text-[9px] tabular-nums leading-none">
        <span
          className="rounded bg-white/[0.04] px-1.5 py-0.5 text-white/50"
          title="Elapsed simulation time"
        >
          {formatTime(elapsedMs)}
        </span>
        <span className="text-white/30">
          Frame{" "}
          <span className="text-white/65">{displayIndex + 1}</span>
          <span className="text-white/20"> / {frameTotal}</span>
        </span>
      </div>

      <div className={`group relative flex w-full min-w-0 items-center ${mobile ? "h-9" : "h-6"}`}>
        <div
          className="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/[0.06] ring-1 ring-inset ring-white/[0.04]"
          aria-hidden
        />
        {maxIndex > 0 && (
          <div
            className="pointer-events-none absolute top-1/2 left-0 h-1 -translate-y-1/2 rounded-full bg-gradient-to-r from-emerald-600/45 to-emerald-400/55 transition-[width] duration-75 ease-out"
            style={{ width: `${Math.max(progressPct, maxIndex > 0 && displayIndex === 0 ? 0.5 : 0)}%` }}
            aria-hidden
          />
        )}
        {atSetup && maxIndex > 0 && (
          <div
            className="pointer-events-none absolute top-1/2 left-0 z-[1] h-3 w-px -translate-y-1/2 bg-emerald-400/75"
            title="Setup frame"
            aria-hidden
          />
        )}
        <div
          className="pointer-events-none absolute top-1/2 z-[1] h-3.5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.25)] transition-[left] duration-75 ease-out group-hover:h-4 group-hover:shadow-[0_0_10px_rgba(255,255,255,0.35)]"
          style={{ left: `${progressPct}%` }}
          aria-hidden
        />
        <input
          type="range"
          min={0}
          max={maxIndex}
          value={displayIndex}
          disabled={scrubDisabled}
          onChange={onScrubInput}
          onPointerDown={onScrubStart}
          onPointerUp={onScrubEnd}
          onPointerCancel={onScrubEnd}
          className={`timeline-scrub absolute inset-0 z-[2] w-full cursor-pointer appearance-none bg-transparent disabled:cursor-default disabled:opacity-40 ${mobile ? "h-9" : "h-6"}`}
          aria-label="Scrub timeline frames"
          aria-valuetext={`Frame ${displayIndex + 1} of ${frameTotal}`}
        />
      </div>
    </div>
  );
}

export function TimelineControls({ mobile = false }: { mobile?: boolean }) {
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
  const scrubDisabled = historyLength <= 1;
  const progressPct = maxIndex > 0 ? (displayIndex / maxIndex) * 100 : 0;

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
    setPlaying(!isPlaying);
  };

  const onLive = () => {
    setPlaying(false);
    if (collaborative) {
      void (async () => {
        const fetched = await refreshFromServer();
        const snap = useRoomSceneCollaborationStore.getState().lastServerSnapshot;
        const sim = useSimulationStore.getState();
        if (fetched.ok && snap && sim.engine) {
          sim.reconcilePausedEngineWithServerSnapshot(snap, {
            refitCamera: true,
            resetAuthoringHistory: true,
          });
        } else {
          useSimulationStore.getState().scrubTo(0);
        }
      })();
      return;
    }
    goLive();
  };

  const modeLabel = collaborative
    ? atSetup
      ? "Setup"
      : "Preview"
    : atLive
      ? "Live"
      : "Review";

  const modeTone =
    modeLabel === "Setup"
      ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300/90"
      : modeLabel === "Live"
        ? "border-sky-500/25 bg-sky-500/10 text-sky-300/90"
        : "border-amber-500/20 bg-amber-500/8 text-amber-300/85";

  return (
    <div
      className={`flex h-full min-h-0 min-w-0 flex-1 items-center bg-[#050505] py-0 ${mobile ? "gap-2 px-2" : "gap-3 px-3"}`}
      role="group"
      aria-label="Timeline transport"
    >
      {/* Transport */}
      <div
        className={`flex shrink-0 items-center gap-px rounded-lg border border-white/[0.06] bg-black/40 ${mobile ? "p-1" : "p-0.5"}`}
      >
        <TransportButton
          label={isPlaying ? "Pause" : "Play"}
          title={isPlaying ? "Pause (Space)" : "Play (Space)"}
          onClick={togglePlay}
          active={isPlaying}
          large={mobile}
        >
          {isPlaying ? <IconPause /> : <IconPlay />}
        </TransportButton>
        <TransportButton
          label="Step backward"
          title="Previous frame"
          onClick={stepBackward}
          disabled={scrubDisabled || displayIndex <= 0}
          large={mobile}
        >
          <IconStepBack />
        </TransportButton>
        <TransportButton
          label="Step forward"
          title="Next frame"
          onClick={stepForward}
          disabled={scrubDisabled}
          large={mobile}
        >
          <IconStepForward />
        </TransportButton>
        <div className="mx-0.5 h-4 w-px bg-white/[0.08]" aria-hidden />
        <TransportButton
          label="Jump to first frame"
          title="Jump to frame 0"
          onClick={resetToFirstFrame}
          large={mobile}
        >
          <IconToStart />
        </TransportButton>
        {(!atSetup || collaborative) && (
          <TransportButton
            label="Setup frame"
            title={
              collaborative
                ? "Pull shared setup and go to frame 0"
                : "Go to setup (frame 0)"
            }
            onClick={onLive}
            active={atSetup}
            large={mobile}
          >
            <IconSetup />
          </TransportButton>
        )}
      </div>

      <TimelineScrubRail
        mobile={mobile}
        displayIndex={displayIndex}
        historyLength={historyLength}
        maxIndex={maxIndex}
        elapsedMs={elapsedMs}
        progressPct={progressPct}
        atSetup={atSetup}
        scrubDisabled={scrubDisabled}
        onScrubInput={onScrubInput}
        onScrubStart={onScrubStart}
        onScrubEnd={onScrubEnd}
      />

      <div className="flex shrink-0 items-center gap-2">
        <SpeedControl speed={speed} setSpeed={setSpeed} />

        <span
          className={`rounded border px-1.5 py-0.5 font-mono text-[9px] font-medium uppercase tracking-wider ${mobile ? "inline" : "hidden sm:inline"} ${modeTone}`}
        >
          {modeLabel}
        </span>

        <span
          className="hidden font-mono text-[9px] tabular-nums text-white/28 lg:inline"
          title="Simulation tick"
        >
          #{tick}
        </span>
      </div>
    </div>
  );
}
