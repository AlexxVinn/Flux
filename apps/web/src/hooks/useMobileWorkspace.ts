"use client";

import { useEffect, useState } from "react";

/** Workspace uses stacked mobile chrome below this width (matches Tailwind `md`). */
export const MOBILE_WORKSPACE_MAX_PX = 767;

const QUERY = `(max-width: ${MOBILE_WORKSPACE_MAX_PX}px)`;

export function useIsMobileWorkspace(): boolean {
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const apply = () => setMobile(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  return mobile;
}
