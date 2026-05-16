"use client";

import type { ReactNode } from "react";

interface SubPanelProps {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}

export function SubPanel({ title, open, onToggle, children }: SubPanelProps) {
  return (
    <div className="border-b border-flux-border/60 last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[10px] font-medium uppercase tracking-wider text-flux-muted transition hover:bg-white/[0.03] hover:text-flux-text"
        aria-expanded={open}
      >
        <span className={`text-[9px] transition ${open ? "rotate-90" : ""}`}>›</span>
        {title}
      </button>
      {open && <div className="pb-2">{children}</div>}
    </div>
  );
}
