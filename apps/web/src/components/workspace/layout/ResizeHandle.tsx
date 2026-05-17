"use client";

import { useCallback, useRef } from "react";

type ResizeAxis = "column" | "row";

interface ResizeHandleProps {
  axis: ResizeAxis;
  onDrag: (delta: number) => void;
  /** column: drag left edge of right panel; row: drag top edge of bottom panel */
  edge?: "start" | "end";
  /** Positioned over the parent edge; does not take space in a flex layout */
  overlay?: boolean;
  className?: string;
}

export function ResizeHandle({
  axis,
  onDrag,
  edge = "start",
  overlay = false,
  className = "",
}: ResizeHandleProps) {
  const draggingRef = useRef(false);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);
      draggingRef.current = true;

      const isCol = axis === "column";
      let last = isCol ? e.clientX : e.clientY;
      const sign = edge === "start" ? 1 : -1;

      const prevUserSelect = document.body.style.userSelect;
      const prevCursor = document.body.style.cursor;
      document.body.style.userSelect = "none";
      document.body.style.cursor = isCol ? "col-resize" : "row-resize";

      const move = (ev: PointerEvent) => {
        if (!draggingRef.current) return;
        const current = isCol ? ev.clientX : ev.clientY;
        const delta = (current - last) * sign;
        last = current;
        if (delta !== 0) onDrag(delta);
      };

      const end = (ev: PointerEvent) => {
        if (!draggingRef.current) return;
        draggingRef.current = false;
        document.body.style.userSelect = prevUserSelect;
        document.body.style.cursor = prevCursor;
        try {
          target.releasePointerCapture(ev.pointerId);
        } catch {
          /* already released */
        }
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", end);
        window.removeEventListener("pointercancel", end);
      };

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
    },
    [axis, edge, onDrag],
  );

  const isCol = axis === "column";
  const cursorClass = isCol ? "cursor-col-resize" : "cursor-row-resize";
  const baseClass = overlay
    ? `group z-40 flex touch-none select-none ${cursorClass} items-center justify-center`
    : `group relative z-40 flex shrink-0 touch-none select-none ${cursorClass}`;

  return (
    <div
      role="separator"
      aria-orientation={isCol ? "vertical" : "horizontal"}
      aria-label={isCol ? "Resize panel width" : "Resize panel height"}
      onPointerDown={onPointerDown}
      className={`${baseClass} ${className}`}
    >
      <div
        className={`rounded-full bg-white/15 transition group-hover:bg-white/40 group-active:bg-white/55 ${
          isCol ? "h-12 w-0.5" : "h-0.5 w-12"
        }`}
      />
    </div>
  );
}
