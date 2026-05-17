import type { SimulationSnapshot } from "./types";

const MAX_FRAMES = 2400;
const KEYFRAME_INTERVAL = 45;
const POS_EPS = 0.01;
const VEL_EPS = 0.01;
const ANGLE_EPS = 0.0005;

/** Physics-only body state for replay. */
export interface CompactBodyState {
  id: string;
  x: number;
  y: number;
  angle: number;
  velocityX: number;
  velocityY: number;
}

export interface HistoryFrame {
  tick: number;
  elapsedMs: number;
  isKeyframe: boolean;
  /** Full snapshot on keyframes; deltas otherwise. */
  bodies: CompactBodyState[];
  full?: SimulationSnapshot;
}

function compactFromSnapshot(snap: SimulationSnapshot): CompactBodyState[] {
  return snap.bodies.map((b) => ({
    id: b.id,
    x: b.x,
    y: b.y,
    angle: b.angle,
    velocityX: b.velocityX,
    velocityY: b.velocityY,
  }));
}

function bodyChanged(a: CompactBodyState, b: CompactBodyState): boolean {
  return (
    Math.abs(a.x - b.x) > POS_EPS ||
    Math.abs(a.y - b.y) > POS_EPS ||
    Math.abs(a.angle - b.angle) > ANGLE_EPS ||
    Math.abs(a.velocityX - b.velocityX) > VEL_EPS ||
    Math.abs(a.velocityY - b.velocityY) > VEL_EPS
  );
}

function deltaBodies(
  prev: CompactBodyState[],
  next: CompactBodyState[],
): CompactBodyState[] {
  const prevMap = new Map(prev.map((b) => [b.id, b]));
  const changed: CompactBodyState[] = [];
  for (const b of next) {
    const p = prevMap.get(b.id);
    if (!p || bodyChanged(p, b)) changed.push(b);
  }
  return changed;
}

function applyDelta(
  base: CompactBodyState[],
  delta: CompactBodyState[],
): CompactBodyState[] {
  const map = new Map(base.map((b) => [b.id, { ...b }]));
  for (const d of delta) map.set(d.id, { ...d });
  return [...map.values()];
}

export class SnapshotBuffer {
  private frames: HistoryFrame[] = [];
  private lastCompact: CompactBodyState[] = [];

  get length(): number {
    return this.frames.length;
  }

  clear(): void {
    this.frames = [];
    this.lastCompact = [];
  }

  /**
   * Replace frame 0 with the current authoring scene (after setup edits).
   * Optionally drops playback frames so frame 0 stays the single source of truth.
   */
  updateSetupKeyframe(
    snap: SimulationSnapshot,
    opts?: { truncatePlayback?: boolean },
  ): void {
    const compact = compactFromSnapshot(snap);
    const setupSnap: SimulationSnapshot = { ...snap, tick: 0 };
    const frame: HistoryFrame = {
      tick: 0,
      elapsedMs: 0,
      isKeyframe: true,
      bodies: compact,
      full: setupSnap,
    };

    if (this.frames.length === 0) {
      this.frames.push(frame);
    } else {
      this.frames[0] = frame;
      if (opts?.truncatePlayback && this.frames.length > 1) {
        this.frames.length = 1;
      }
    }

    this.lastCompact = compact;
  }

  push(snap: SimulationSnapshot, elapsedMs: number): void {
    const compact = compactFromSnapshot(snap);
    const isKeyframe =
      this.frames.length === 0 ||
      this.frames.length % KEYFRAME_INTERVAL === 0 ||
      compact.length !== this.lastCompact.length;

    let bodies: CompactBodyState[];
    if (isKeyframe) {
      bodies = compact;
    } else {
      bodies = deltaBodies(this.lastCompact, compact);
    }

    this.frames.push({
      tick: snap.tick,
      elapsedMs,
      isKeyframe,
      bodies,
      full: isKeyframe ? snap : undefined,
    });

    if (this.frames.length > MAX_FRAMES) {
      this.pruneHead();
    }

    this.lastCompact = compact;
  }

  private pruneHead(): void {
    const drop = Math.floor(MAX_FRAMES * 0.15);
    this.frames.splice(0, drop);
    this.rebuildLastCompact();
  }

  private rebuildLastCompact(): void {
    if (this.frames.length === 0) {
      this.lastCompact = [];
      return;
    }
    this.lastCompact = this.reconstructAt(this.frames.length - 1);
  }

  reconstructAt(index: number): CompactBodyState[] {
    if (index < 0 || index >= this.frames.length) return [];
    let kf = index;
    while (kf >= 0 && !this.frames[kf]!.isKeyframe) kf -= 1;
    if (kf < 0) kf = 0;

    const start = this.frames[kf]!;
    let bodies = start.isKeyframe
      ? start.bodies.map((b) => ({ ...b }))
      : [...start.bodies];

    for (let i = kf + 1; i <= index; i++) {
      const frame = this.frames[i]!;
      if (frame.isKeyframe) {
        bodies = frame.bodies.map((b) => ({ ...b }));
      } else {
        bodies = applyDelta(bodies, frame.bodies);
      }
    }
    return bodies;
  }

  getFrame(index: number): HistoryFrame | null {
    return this.frames[index] ?? null;
  }

  getKeyframeSnapshot(index: number): SimulationSnapshot | null {
    let kf = index;
    while (kf >= 0) {
      const f = this.frames[kf];
      if (f?.full) return f.full;
      kf -= 1;
    }
    return this.frames[0]?.full ?? null;
  }

  getElapsedMs(index: number): number {
    return this.frames[index]?.elapsedMs ?? 0;
  }

  getTick(index: number): number {
    return this.frames[index]?.tick ?? 0;
  }

  /** Drop frames after index (inclusive keep). */
  truncateTo(index: number): void {
    if (index < 0 || index >= this.frames.length) return;
    this.frames.length = index + 1;
    this.rebuildLastCompact();
  }
}
