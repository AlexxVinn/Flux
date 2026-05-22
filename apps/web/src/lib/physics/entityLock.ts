import type { LayerEntity, SimulationSnapshot } from "./types";

export function isEntityLocked(snapshot: SimulationSnapshot, id: string): boolean {
  const body = snapshot.bodies.find((b) => b.id === id);
  if (body) return !!body.locked;
  const spring = snapshot.springs.find((s) => s.id === id);
  if (spring) return !!spring.locked;
  const rope = (snapshot.ropes ?? []).find((r) => r.id === id);
  if (rope) return !!rope.locked;
  const markup = (snapshot.markups ?? []).find((m) => m.id === id);
  if (markup) return !!markup.locked;
  return false;
}

export function layerEntityLocked(entity: LayerEntity): boolean {
  return !!entity.data.locked;
}
