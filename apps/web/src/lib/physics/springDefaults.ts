/**
 * Matter.js constraint tuning — stiffness & damping are normalized 0–1.
 * Lower stiffness = softer, stretchier springs; lower damping = more bounce (underdamped).
 */

/** Default for user-placed springs and unspecified layouts. */
export const DEFAULT_SPRING_STIFFNESS = 0.008;
export const DEFAULT_SPRING_DAMPING = 0.009;

/** Slightly firmer but still elastic (pendulums, multi-link rigs). */
export const LINK_SPRING_STIFFNESS = 0.014;
export const LINK_SPRING_DAMPING = 0.008;

/** Trampoline / platform supports — soft support with visible flex. */
export const SUPPORT_SPRING_STIFFNESS = 0.016;
export const SUPPORT_SPRING_DAMPING = 0.01;

/** Extra solver iterations help soft constraints stay stable. */
export const SPRING_CONSTRAINT_ITERATIONS = 8;
