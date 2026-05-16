/** Typed cross-engine message bus (per simulation step). */

export const PortKind = {
  FrictionHeat: "frictionHeat",
} as const;

export type PortKind = (typeof PortKind)[keyof typeof PortKind];

export interface FrictionHeatMessage {
  kind: typeof PortKind.FrictionHeat;
  entityId: string;
  /** Optional second body receiving heat (e.g. floor). */
  partnerEntityId?: string;
  energyJoules: number;
}

export type PortMessage = FrictionHeatMessage;

export class PortBus {
  private queues = new Map<PortKind, PortMessage[]>();

  publish(message: PortMessage): void {
    const q = this.queues.get(message.kind) ?? [];
    q.push(message);
    this.queues.set(message.kind, q);
  }

  drain(kind: PortKind): PortMessage[] {
    const messages = this.queues.get(kind) ?? [];
    this.queues.set(kind, []);
    return messages;
  }

  clear(): void {
    this.queues.clear();
  }
}
