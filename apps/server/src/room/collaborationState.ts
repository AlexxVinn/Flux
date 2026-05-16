import type {
  ActionLogEntry,
  CanvasAnnotation,
  ChatMessage,
  UserPresence,
} from "@flux/shared";
import type { UserId } from "@flux/shared";

const MAX_CHAT = 200;
const MAX_ACTION_LOG = 500;
const MAX_ANNOTATIONS = 300;

export class CollaborationState {
  readonly presence = new Map<UserId, UserPresence>();
  readonly annotations = new Map<string, CanvasAnnotation>();
  readonly chat: ChatMessage[] = [];
  readonly actionLog: ActionLogEntry[] = [];

  setPresence(p: UserPresence): void {
    this.presence.set(p.userId, p);
  }

  removePresence(userId: UserId): void {
    this.presence.delete(userId);
  }

  listPresence(): UserPresence[] {
    return [...this.presence.values()];
  }

  addAnnotation(a: CanvasAnnotation): void {
    this.annotations.set(a.id, a);
    while (this.annotations.size > MAX_ANNOTATIONS) {
      const first = this.annotations.keys().next().value;
      if (first) this.annotations.delete(first);
    }
  }

  removeAnnotation(id: string): boolean {
    return this.annotations.delete(id);
  }

  listAnnotations(): CanvasAnnotation[] {
    return [...this.annotations.values()];
  }

  addChat(m: ChatMessage): void {
    this.chat.push(m);
    if (this.chat.length > MAX_CHAT) this.chat.splice(0, this.chat.length - MAX_CHAT);
  }

  logAction(entry: ActionLogEntry): void {
    this.actionLog.push(entry);
    if (this.actionLog.length > MAX_ACTION_LOG) {
      this.actionLog.splice(0, this.actionLog.length - MAX_ACTION_LOG);
    }
  }
}
