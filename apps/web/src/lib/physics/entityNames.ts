import type { EntityKind } from "./types";

const COUNTERS: Record<string, number> = {
  box: 0,
  circle: 0,
  spring: 0,
  rope: 0,
  floor: 0,
  wall: 0,
  body: 0,
  collisionBounds: 0,
};

const PREFIX: Record<string, string> = {
  box: "Box",
  circle: "Circle",
  spring: "Spring",
  floor: "Floor",
  wall: "Wall",
  body: "Body",
  collisionBounds: "CollisionBox",
};

export function resetNameCounters(): void {
  for (const k of Object.keys(COUNTERS)) COUNTERS[k] = 0;
}

export function nextEntityName(kind: EntityKind | "box" | "circle" | "rope"): string {
  const key =
    kind === "rectangle"
      ? "box"
      : kind === "circle"
        ? "circle"
        : kind === "rope"
          ? "rope"
          : kind === "collisionBounds"
            ? "collisionBounds"
            : kind;
  const n = (COUNTERS[key] ?? 0) + 1;
  COUNTERS[key] = n;
  const prefix = PREFIX[key] ?? "Object";
  return `${prefix}-${n}`;
}

export function reserveEntityName(name: string): void {
  const m = /^(\w+)-(\d+)$/.exec(name);
  if (!m) return;
  const prefix = m[1]!.toLowerCase();
  const num = parseInt(m[2]!, 10);
  const key = Object.entries(PREFIX).find(([, p]) => p === m[1])?.[0] ?? prefix;
  if ((COUNTERS[key] ?? 0) < num) COUNTERS[key] = num;
}
