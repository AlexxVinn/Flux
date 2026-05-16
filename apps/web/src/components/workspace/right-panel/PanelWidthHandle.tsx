"use client";

import { useCallback } from "react";

interface PanelWidthHandleProps {
  onDrag: (deltaX: number) => void;
}

export function PanelWidthHandle({ onDrag }: PanelWidthHandleProps) {
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      let lastX = e.clientX;

      const move = (ev: PointerEvent) => {
        const delta = ev.clientX - lastX;
        lastX = ev.clientX;
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
      aria-orientation="vertical"
      onPointerDown={onPointerDown}
      className="absolute left-0 top-0 z-20 h-full w-1.5 -translate-x-1/2 cursor-col-resize touch-none hover:bg-white/10 active:bg-white/15"
    />
  );
}
