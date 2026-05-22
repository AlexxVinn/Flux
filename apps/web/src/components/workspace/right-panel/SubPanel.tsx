"use client";

import type { ReactNode } from "react";
import { InspectorSection } from "@/components/inspector/inspector-ui";

interface SubPanelProps {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}

/** Nested collapsible block inside the Scene region (Blender-style sub-panel). */
export function SubPanel({ title, open, onToggle, children }: SubPanelProps) {
  return (
    <InspectorSection
      title={title}
      open={open}
      onOpenChange={(next) => {
        if (next !== open) onToggle();
      }}
    >
      {children}
    </InspectorSection>
  );
}
