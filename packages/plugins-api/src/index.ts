import type { ComponentKind, ComponentData } from "@flux/shared";
import type { SimulationEngine } from "@flux/sim-core";
import type { PortKind } from "@flux/sim-core";

/** Workspace pointer tool handler (client-side). */
export interface WorkspaceTool {
  readonly id: string;
  readonly label: string;
  onPointerDown?(ctx: ToolPointerContext): void;
  onPointerMove?(ctx: ToolPointerContext): void;
  onPointerUp?(ctx: ToolPointerContext): void;
}

export interface ToolPointerContext {
  worldX: number;
  worldY: number;
  screenX: number;
  screenY: number;
  selectedEntityIds: string[];
}

export interface ComponentRegistration {
  kind: ComponentKind;
  /** Default component data when spawning from palette. */
  createDefault: () => ComponentData;
}

export interface PortRegistration {
  kind: PortKind;
  description: string;
}

/**
 * Plugin bundle — host merges registrations at startup.
 * MVP uses built-in engines; third-party plugins implement this contract.
 */
export interface fluxPlugin {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  components?: ComponentRegistration[];
  engines?: SimulationEngine[];
  tools?: WorkspaceTool[];
  ports?: PortRegistration[];
}

export interface PluginHost {
  register(plugin: fluxPlugin): void;
  getEngines(): SimulationEngine[];
  getTools(): WorkspaceTool[];
}

export function createPluginHost(): PluginHost {
  const plugins: fluxPlugin[] = [];

  return {
    register(plugin: fluxPlugin) {
      plugins.push(plugin);
    },
    getEngines() {
      return plugins.flatMap((p) => p.engines ?? []);
    },
    getTools() {
      return plugins.flatMap((p) => p.tools ?? []);
    },
  };
}
