/** Collaborative room & membership types (Flux learning sessions). */

export type RoomVisibility = "public" | "private";

export type MemberRole = "admin" | "member" | "spectator";

export interface CatalogScene {
  id: string;
  slug: string;
  title: string;
  module: string;
  description: string;
  thumbnailUrl?: string;
  sortOrder: number;
}

export interface UserScene {
  id: string;
  ownerId: string;
  title: string;
  module: string;
  createdAt: string;
  updatedAt: string;
}

export interface RoomSummary {
  roomId: string;
  slug: string;
  title: string;
  module: string;
  visibility: RoomVisibility;
  joinCode: string;
}

export interface RoomMembership {
  memberId: string;
  roomId: string;
  slug: string;
  title: string;
  module: string;
  visibility: RoomVisibility;
  joinCode: string;
  role: MemberRole;
  displayName: string;
}

export interface CreateRoomRequest {
  title: string;
  module?: string;
  visibility?: RoomVisibility;
  catalogId?: string;
  userSceneId?: string;
  /** Optional initial scene document (JSON); stored as room `scene_snapshot` (e.g. test bench presets). */
  initialScene?: Record<string, unknown>;
}

export interface JoinRoomRequest {
  joinCode: string;
  asSpectator?: boolean;
  guestId?: string;
  guestDisplayName?: string;
}

export interface UserProfile {
  id: string;
  displayName: string;
  avatarColor: string;
  defaultNameAssigned: boolean;
}
