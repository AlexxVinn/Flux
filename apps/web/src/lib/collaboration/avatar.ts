/**
 * Deterministic GitHub-style identicons from a user id + accent color.
 */

const PALETTE = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#84cc16",
];

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Stable accent color from any seed string (user id, guest id, …). */
export function colorFromSeed(seed: string): string {
  return PALETTE[hashString(seed) % PALETTE.length]!;
}

/**
 * 5×5 identicon cells with vertical symmetry (15 bits).
 * Returns row-major [row][col] for cols 0..4.
 */
export function identiconGrid(seed: string): boolean[][] {
  const h = hashString(seed);
  const rows: boolean[][] = [];
  for (let y = 0; y < 5; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < 5; x++) {
      const mirrorX = x < 3 ? x : 4 - x;
      const bit = (h >> (y * 3 + mirrorX)) & 1;
      row.push(bit === 1);
    }
    rows.push(row);
  }
  return rows;
}

const DEFAULT_PROFILE_COLOR = "#6ee7b7";

export function resolveAvatarColor(
  userId: string,
  profileColor?: string | null,
): string {
  if (
    profileColor &&
    profileColor.length > 0 &&
    profileColor.toLowerCase() !== DEFAULT_PROFILE_COLOR
  ) {
    return profileColor;
  }
  if (typeof window === "undefined") return colorFromSeed(userId);
  const key = `flux_avatar_color_${userId}`;
  const stored = localStorage.getItem(key);
  if (stored) return stored;
  const generated = colorFromSeed(userId);
  localStorage.setItem(key, generated);
  return generated;
}
