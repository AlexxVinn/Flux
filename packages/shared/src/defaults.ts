import { ComponentKind, type RigidBodyComponent } from "./components.js";

export function rigidBodyDefaults(
  partial: Partial<RigidBodyComponent> & Pick<RigidBodyComponent, "mass" | "isStatic">,
): RigidBodyComponent {
  return {
    kind: ComponentKind.RigidBody,
    velocity: { x: 0, y: 0 },
    force: { x: 0, y: 0 },
    isKinematic: false,
    isSleeping: false,
    sleepTimer: 0,
    ...partial,
  };
}
