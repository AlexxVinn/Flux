"use client";

import { useCollaborationStore } from "@/store/collaborationStore";

export function ActionHistoryPanel({ bare = false }: { bare?: boolean }) {
  const actionLog = useCollaborationStore((s) => s.actionLog);
  const entries = [...actionLog].reverse().slice(0, 40);

  return (
    <section
      className={
        bare
          ? "flex min-h-0 flex-1 flex-col overflow-hidden"
          : "max-h-32 shrink-0 overflow-hidden border-t border-flux-border"
      }
    >
      {!bare && (
        <header className="px-2 py-1.5">
          <h3 className="text-[9px] font-semibold uppercase tracking-widest text-flux-muted">
            Activity
          </h3>
        </header>
      )}
      <ul
        className={`flux-scroll px-2 pb-2 ${bare ? "min-h-0 flex-1 overflow-y-auto" : "max-h-24 overflow-y-auto"}`}
      >
        {entries.length === 0 ? (
          <li className="text-[10px] text-flux-muted">Actions appear here as you work.</li>
        ) : (
          entries.map((e) => (
            <li key={e.id} className="border-b border-flux-border/50 py-1 text-[10px] last:border-0">
              <span className="font-medium text-flux-text">{e.displayName}</span>
              <span className="text-flux-muted"> · {e.summary}</span>
              {e.tick !== undefined && (
                <span className="ml-1 font-mono text-[9px] text-flux-muted/80">t{e.tick}</span>
              )}
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
