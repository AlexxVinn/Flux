"use client";

import { useEffect } from "react";
import { useAuthStore } from "@/store/authStore";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const initialize = useAuthStore((s) => s.initialize);
  const initialized = useAuthStore((s) => s.initialized);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  if (!initialized) {
    return (
      <div className="flex h-full min-h-screen items-center justify-center bg-flux-bg text-sm text-flux-muted">
        Loading…
      </div>
    );
  }

  return <div className="h-full min-h-0 w-full">{children}</div>;
}
