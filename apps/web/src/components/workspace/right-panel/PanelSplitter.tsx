"use client";

import { useCallback } from "react";

interface PanelSplitterProps {
  onDrag: (deltaY: number) => void;
}

export function PanelSplitter({ onDrag }: PanelSplitterProps) {
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      let lastY = e.clientY;

      const move = (ev: PointerEvent) => {
        const delta = ev.clientY - lastY;
        lastY = ev.clientY;
        if (delta !== 0) onDrag(delta);
      };

      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [onDrag],
  );

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      onPointerDown={onPointerDown}
      className="group relative z-10 flex h-2.5 shrink-0 cursor-row-resize items-center justify-center touch-none"
    >
      <div className="h-px w-14 rounded-full bg-white/15 transition group-hover:w-20 group-hover:bg-white/35 group-active:bg-white/50" />
    </div>
  );
}
