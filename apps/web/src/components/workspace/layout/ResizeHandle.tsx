"use client";

import { useCallback } from "react";

type ResizeAxis = "column" | "row";

interface ResizeHandleProps {
  axis: ResizeAxis;
  onDrag: (delta: number) => void;
  /** column: drag left edge of right panel; row: drag top edge of bottom panel */
  edge?: "start" | "end";
  className?: string;
}

export function ResizeHandle({ axis, onDrag, edge = "start", className = "" }: ResizeHandleProps) {
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const isCol = axis === "column";
      let last = isCol ? e.clientX : e.clientY;
      const sign = edge === "start" ? 1 : -1;

      const move = (ev: PointerEvent) => {
        const current = isCol ? ev.clientX : ev.clientY;
        const delta = (current - last) * sign;
        last = current;
        if (delta !== 0) onDrag(delta);
      };

      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [axis, edge, onDrag],
  );

  const isCol = axis === "column";

  return (
    <div
      role="separator"
      aria-orientation={isCol ? "vertical" : "horizontal"}
      onPointerDown={onPointerDown}
      className={`group relative z-30 flex shrink-0 items-center justify-center touch-none ${
        isCol
          ? "w-1.5 cursor-col-resize hover:bg-white/10 active:bg-white/15"
          : "h-1.5 cursor-row-resize hover:bg-white/10 active:bg-white/15"
      } ${className}`}
    >
      <div
        className={`rounded-full bg-white/20 transition group-hover:bg-white/45 group-active:bg-white/60 ${
          isCol ? "h-8 w-0.5" : "h-0.5 w-10"
        }`}
      />
    </div>
  );
}
