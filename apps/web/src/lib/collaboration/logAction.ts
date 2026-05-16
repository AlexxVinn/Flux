import { useCollaborationStore } from "@/store/collaborationStore";

export function logSimAction(
  summary: string,
  actionType: string,
  entityId?: string,
  tick?: number,
): void {
  useCollaborationStore.getState().logLocalAction(summary, actionType, entityId, tick);
}
