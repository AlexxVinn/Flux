import type { UserId } from "./ids.js";
import type { Vec2 } from "./math.js";
import type { MemberRole } from "./rooms.js";

export interface UserPresence {
  userId: UserId;
  displayName: string;
  color: string;
  cursor?: Vec2;
  selectedIds?: string[];
}

export type AnnotationKind = "arrow" | "text" | "measure";

export interface CanvasAnnotation {
  id: string;
  authorId: UserId;
  authorName: string;
  kind: AnnotationKind;
  points: Vec2[];
  text?: string;
  persistent: boolean;
  createdAt: number;
  /** `world` = simulation/world space (10k map). Omit / `screen` = legacy CSS px on canvas. */
  coordinateSpace?: "world" | "screen";
}

export interface ActionLogEntry {
  id: string;
  userId: UserId;
  displayName: string;
  summary: string;
  actionType: string;
  entityId?: string;
  tick?: number;
  timestamp: number;
}

export interface ChatMessage {
  id: string;
  userId: UserId;
  displayName: string;
  text: string;
  timestamp: number;
  /** Room role at send time (for admin badge). */
  role?: MemberRole;
  /** System events: joins, kicks, etc. */
  isSystem?: boolean;
}

export interface GuidedPrompt {
  id: string;
  text: string;
  /** Optional tick threshold to auto-show */
  afterTick?: number;
}

export interface GuidedExperiment {
  id: string;
  title: string;
  description: string;
  principle: string;
  prompts: GuidedPrompt[];
}
