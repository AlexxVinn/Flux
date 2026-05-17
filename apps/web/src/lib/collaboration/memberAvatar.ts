/**
 * Deterministic illustrated avatars via DiceBear (https://www.dicebear.com).
 * SVG served from their CDN; seed should be stable per user/guest/member.
 */
const DICEBEAR_STYLE = "lorelei";
const DICEBEAR_VERSION = "9.x";

export function memberAvatarUrl(seed: string, pixelSize = 80): string {
  const params = new URLSearchParams({
    seed,
    size: String(Math.min(256, Math.max(32, pixelSize * 2))),
    backgroundType: "gradientLinear",
    backgroundRotation: "0,360",
  });
  return `https://api.dicebear.com/${DICEBEAR_VERSION}/${DICEBEAR_STYLE}/svg?${params}`;
}

/** Accent pair for gradient ring derived from seed (matches roster color logic). */
export function avatarRingGradient(color: string): string {
  return `linear-gradient(135deg, ${color}cc 0%, ${color}44 100%)`;
}
