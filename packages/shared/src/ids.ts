/** Branded IDs for type-safe references across client and server. */

export type EntityId = string & { readonly __brand: "EntityId" };
export type RoomId = string & { readonly __brand: "RoomId" };
export type UserId = string & { readonly __brand: "UserId" };
export type ActionId = string & { readonly __brand: "ActionId" };
export type ConstraintId = string & { readonly __brand: "ConstraintId" };
export type SnapshotId = string & { readonly __brand: "SnapshotId" };

export function entityId(id: string): EntityId {
  return id as EntityId;
}

export function roomId(id: string): RoomId {
  return id as RoomId;
}

export function userId(id: string): UserId {
  return id as UserId;
}

export function actionId(id: string): ActionId {
  return id as ActionId;
}

export function constraintId(id: string): ConstraintId {
  return id as ConstraintId;
}

export function snapshotId(id: string): SnapshotId {
  return id as SnapshotId;
}

export function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}
