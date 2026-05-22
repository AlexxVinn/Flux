import type { EntityKind } from "./types";

const COUNTERS: Record<string, number> = {
  box: 0,
  circle: 0,
  spring: 0,
  bar: 0,
  rope: 0,
  floor: 0,
  wall: 0,
  body: 0,
  collisionBounds: 0,
  arrow: 0,
  text: 0,
  measure: 0,
};

const PREFIX: Record<string, string> = {
  box: "Box",
  circle: "Circle",
  spring: "Spring",
  floor: "Floor",
  wall: "Wall",
  body: "Body",
  collisionBounds: "CollisionBox",
  arrow: "Arrow",
  text: "Text",
  measure: "Ruler",
};

export function resetNameCounters(): void {
  for (const k of Object.keys(COUNTERS)) COUNTERS[k] = 0;
}

export function nextMarkupName(kind: "arrow" | "text" | "measure"): string {
  const n = (COUNTERS[kind] ?? 0) + 1;
  COUNTERS[kind] = n;
  return `${PREFIX[kind]}-${n}`;
}

export function nextEntityName(
  kind: EntityKind | "box" | "circle" | "rope" | "bar" | "arrow" | "text" | "measure",
): string {
  const key =
    kind === "rectangle"
      ? "box"
      : kind === "circle"
        ? "circle"
        : kind === "rope"
          ? "rope"
          : kind === "collisionBounds"
            ? "collisionBounds"
            : kind === "arrow" || kind === "text" || kind === "measure"
              ? kind
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
