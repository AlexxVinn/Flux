"use client";

import { useCallback, useRef, useState } from "react";

interface PanelSplitterProps {
  onDrag: (deltaY: number) => void;
}

export function PanelSplitter({ onDrag }: PanelSplitterProps) {
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);
      draggingRef.current = true;
      setDragging(true);

      let lastY = e.clientY;
      const prevUserSelect = document.body.style.userSelect;
      const prevCursor = document.body.style.cursor;
      document.body.style.userSelect = "none";
      document.body.style.cursor = "row-resize";

      const move = (ev: PointerEvent) => {
        if (!draggingRef.current) return;
        const delta = ev.clientY - lastY;
        lastY = ev.clientY;
        if (delta !== 0) onDrag(delta);
      };

      const end = (ev: PointerEvent) => {
        if (!draggingRef.current) return;
        draggingRef.current = false;
        setDragging(false);
        document.body.style.userSelect = prevUserSelect;
        document.body.style.cursor = prevCursor;
        try {
          target.releasePointerCapture(ev.pointerId);
        } catch {
          /* released */
        }
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", end);
        window.removeEventListener("pointercancel", end);
      };

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
    },
    [onDrag],
  );

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize panels"
      onPointerDown={onPointerDown}
      className={`flux-panel-splitter ${dragging ? "flux-panel-splitter--dragging" : ""}`}
    />
  );
}
