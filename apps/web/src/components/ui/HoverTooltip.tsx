"use client";

import type { ReactNode } from "react";

interface HoverTooltipProps {
  label: string;
  children: ReactNode;
  /** Tooltip placement relative to trigger */
  side?: "top" | "bottom";
  className?: string;
}

/** Icon control label — visible on hover/focus only. */
export function HoverTooltip({
  label,
  children,
  side = "top",
  className = "",
}: HoverTooltipProps) {
  const position =
    side === "top"
      ? "bottom-full left-1/2 mb-2 -translate-x-1/2"
      : "top-full left-1/2 mt-2 -translate-x-1/2";

  return (
    <div className={`group/tooltip relative inline-flex ${className}`}>
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute ${position} z-[80] whitespace-nowrap rounded-md border border-white/12 bg-[#121214] px-2 py-1 text-[10px] font-medium tracking-wide text-white/90 opacity-0 shadow-lg transition-opacity duration-150 group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100`}
      >
        {label}
        <span
          className={`absolute left-1/2 h-1.5 w-1.5 -translate-x-1/2 rotate-45 border border-white/12 bg-[#121214] ${
            side === "top" ? "-bottom-[5px] border-t-0 border-l-0" : "-top-[5px] border-b-0 border-r-0"
          }`}
          aria-hidden
        />
      </span>
    </div>
  );
}
