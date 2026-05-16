"use client";

import { useCollaborationStore } from "@/store/collaborationStore";
import type { AnnotationKind } from "@flux/shared";

const TOOLS: { id: AnnotationKind; label: string }[] = [
  { id: "arrow", label: "Arrow" },
  { id: "text", label: "Text" },
  { id: "measure", label: "Measure" },
];

export function AnnotationToolbar() {
  const tool = useCollaborationStore((s) => s.activeAnnotationTool);
  const setTool = useCollaborationStore((s) => s.setAnnotationTool);

  return (
    <div className="flex items-center gap-0.5 border-l border-flux-border pl-2">
      <span className="mr-1 text-[9px] uppercase text-flux-muted">Annotate</span>
      {TOOLS.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => setTool(tool === t.id ? null : t.id)}
          className={`rounded px-2 py-1 text-[10px] font-medium ${
            tool === t.id
              ? "bg-amber-500/20 text-amber-200"
              : "text-flux-muted hover:bg-flux-elevated hover:text-flux-text"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
