/** Directional snap increments (degrees); each is repeated around the full circle. */
export const ATTACH_ANGLE_SNAPS_DEG = [0, 30, 45, 60, 90] as const;

/** All world bearings reachable by stepping each increment around 360° (e.g. 30° → every 30°). */
const FULL_CIRCLE_SNAP_DEG: readonly number[] = (() => {
  const set = new Set<number>();
  set.add(0);
  for (const step of ATTACH_ANGLE_SNAPS_DEG) {
    if (step === 0) continue;
    for (let a = 0; a < 360; a += step) {
      set.add(a);
    }
  }
  return [...set].sort((a, b) => a - b);
})();

function smallestAngleDiffDeg(a: number, b: number): number {
  let d = ((a - b + 180) % 360 + 360) % 360 - 180;
  return Math.abs(d);
}

export type AngleSnapOrigin =
  | { x: number; y: number }
  | { worldX: number; worldY: number };

export function angleSnapOriginXY(origin: AngleSnapOrigin): { x: number; y: number } {
  return "worldX" in origin ? { x: origin.worldX, y: origin.worldY } : origin;
}

export interface AttachSnapOptions {
  /** Body COM / edge snapping (off when Ctrl held). */
  snap: boolean;
  /** Shift — snap ray from origin to cursor bearing. */
  angleSnap?: boolean;
  angleSnapOrigin?: AngleSnapOrigin | null;
}

/**
 * Snap `(wx, wy)` to the nearest bearing from `(ox, oy)` using every increment
 * in {@link ATTACH_ANGLE_SNAPS_DEG} stepped around the full 360° (e.g. 30° → 0…330°).
 */
export function snapWorldPointToAngle(
  ox: number,
  oy: number,
  wx: number,
  wy: number,
  enabled: boolean,
): { x: number; y: number } {
  if (!enabled) return { x: wx, y: wy };

  const dx = wx - ox;
  const dy = wy - oy;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return { x: wx, y: wy };

  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;

  let bestDeg = FULL_CIRCLE_SNAP_DEG[0]!;
  let bestDiff = 360;
  for (const c of FULL_CIRCLE_SNAP_DEG) {
    const diff = smallestAngleDiffDeg(deg, c);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestDeg = c;
    }
  }

  const rad = (bestDeg * Math.PI) / 180;
  return { x: ox + Math.cos(rad) * len, y: oy + Math.sin(rad) * len };
}
