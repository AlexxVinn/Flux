"use client";

import type { SceneMarkupKind } from "@/lib/physics/types";
import { useSimulationStore } from "@/store/simulationStore";

const TOOLS: { id: SceneMarkupKind; label: string }[] = [
  { id: "arrow", label: "Arrow" },
  { id: "text", label: "Text" },
  { id: "measure", label: "Measure" },
];

function AnnotIcon({ kind }: { kind: SceneMarkupKind }) {
  switch (kind) {
    case "arrow":
      return (
        <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path
            d="M3 8h8M9 5.5 12 8l-3 2.5"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "text":
      return (
        <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path
            d="M4 4h8M8 4v9"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      );
    case "measure":
      return (
        <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M3 6h10M6 6v5M10 6v3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
        </svg>
      );
    default:
      return null;
  }
}

export function AnnotationToolbar({
  layout = "vertical",
  compact = false,
}: {
  layout?: "vertical" | "horizontal" | "grid" | "inline";
  compact?: boolean;
}) {
  const tool = useSimulationStore((s) => s.activeMarkupTool);
  const setTool = useSimulationStore((s) => s.setMarkupTool);
  const btnSize = compact ? "h-7 w-7" : "h-8 w-8";

  const buttons = TOOLS.map((t) => (
    <button
      key={t.id}
      type="button"
      onClick={() => setTool(tool === t.id ? null : t.id)}
      title={t.label}
      aria-label={t.label}
      className={`flex ${btnSize} items-center justify-center rounded-md transition ${
        tool === t.id
          ? "bg-amber-500/20 text-amber-200 ring-1 ring-amber-500/30"
          : "text-white/45 hover:bg-white/[0.06] hover:text-white/80"
      }`}
    >
      <AnnotIcon kind={t.id} />
    </button>
  ));

  if (layout === "horizontal") {
    return (
      <div className="flex items-center gap-0.5 border-l border-flux-border pl-2">
        <span className="mr-1 text-[9px] uppercase text-flux-muted">Annotate</span>
        {buttons}
      </div>
    );
  }

  if (layout === "grid") {
    return <div className="grid grid-cols-2 gap-0.5">{buttons}</div>;
  }

  if (layout === "inline") {
    return <div className="flex items-center gap-px">{buttons}</div>;
  }

  return <div className="flex flex-col gap-0.5">{buttons}</div>;
}
