"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { joinRoomBySlug } from "@/lib/rooms/api";
import { commitRoomMembership } from "@/lib/rooms/session";
import { useAuthStore } from "@/store/authStore";

/** Legacy URL — joins the public mechanics-default room then redirects. */
export default function LegacyMechanicsPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    void joinRoomBySlug("mechanics-default", { anonymous: !user })
      .then((m) => {
        commitRoomMembership(m, { anonymous: !user });
        router.replace(`/workspace/${m.module}/${m.slug}`);
      })
      .catch(() => router.replace("/"));
  }, [router, user]);

  return (
    <div className="flex h-screen items-center justify-center text-sm text-flux-muted">
      Joining mechanics lab…
    </div>
  );
}
