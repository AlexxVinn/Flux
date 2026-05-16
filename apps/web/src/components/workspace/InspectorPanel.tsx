"use client";

import { LayersPanel } from "@/components/inspector/LayersPanel";
import { PropertyInspector } from "@/components/inspector/PropertyInspector";
import { DebugOverlaysPanel } from "@/components/inspector/DebugOverlaysPanel";

export function InspectorPanel({ embedded = false }: { embedded?: boolean }) {
  const content = (
    <>
      <header className="border-b border-flux-border px-3 py-2">
        <h2 className="text-[10px] font-semibold uppercase tracking-widest text-flux-muted">
          Inspector
        </h2>
      </header>

      <LayersPanel />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="border-b border-flux-border px-2 py-1.5">
          <h3 className="px-1 text-[9px] font-semibold uppercase tracking-widest text-flux-muted">
            Properties
          </h3>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <PropertyInspector />
        </div>
      </div>

      <DebugOverlaysPanel />
    </>
  );

  if (embedded) {
    return <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{content}</div>;
  }

  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-flux-border bg-flux-panel">
      {content}
    </aside>
  );
}
