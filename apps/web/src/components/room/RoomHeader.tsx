"use client";

import { useState } from "react";
import Link from "next/link";
import { useRoomSessionStore, useIsRoomAdmin } from "@/store/roomSessionStore";
import { useAuthStore } from "@/store/authStore";
import { fetchRoomMembers, kickRoomMember } from "@/lib/rooms/api";

export function RoomHeader() {
  const membership = useRoomSessionStore((s) => s.membership);
  const isAdmin = useIsRoomAdmin();
  const profile = useAuthStore((s) => s.profile);
  const [showMembers, setShowMembers] = useState(false);
  const [members, setMembers] = useState<
    Array<{ id: string; display_name: string; role: string }>
  >([]);
  const [copied, setCopied] = useState(false);

  if (!membership) return null;

  const copyCode = async () => {
    await navigator.clipboard.writeText(membership.joinCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const loadMembers = async () => {
    const rows = await fetchRoomMembers(membership.roomId);
    setMembers(
      rows.map((r) => ({
        id: r.id,
        display_name: r.display_name,
        role: r.role,
      })),
    );
    setShowMembers(true);
  };

  const kick = async (memberId: string) => {
    await kickRoomMember(memberId);
    await loadMembers();
  };

  return (
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-flux-border px-3 py-2">
      <div>
        <h1 className="text-sm font-medium text-flux-text">{membership.title}</h1>
        <p className="text-[10px] text-flux-muted">
          {membership.module} ·{" "}
          <span className="capitalize">{membership.role}</span>
          {profile ? ` · ${profile.displayName}` : ` · ${membership.displayName}`}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void copyCode()}
          className="rounded border border-flux-border bg-flux-elevated px-2.5 py-1 font-mono text-xs text-flux-text hover:border-flux-focus"
          title="Copy invite code"
        >
          {membership.joinCode}
          {copied ? " ✓" : ""}
        </button>
        {isAdmin && (
          <button
            type="button"
            onClick={() => void loadMembers()}
            className="rounded border border-flux-border px-2.5 py-1 text-xs text-flux-muted hover:text-flux-text"
          >
            Members
          </button>
        )}
        <Link
          href="/"
          className="rounded border border-flux-border px-2.5 py-1 text-xs text-flux-muted hover:text-flux-text"
        >
          Exit
        </Link>
      </div>
      {showMembers && isAdmin && (
        <div className="w-full rounded-lg border border-flux-border bg-flux-panel p-2">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-flux-muted">
            Room members
          </p>
          <ul className="space-y-1">
            {members.map((m) => (
              <li
                key={m.id}
                className="flex items-center justify-between text-xs text-flux-text"
              >
                <span>
                  {m.display_name}
                  {m.role === "admin" && (
                    <span className="ml-1.5 rounded bg-flux-elevated px-1 py-0.5 text-[9px] uppercase text-flux-muted">
                      admin
                    </span>
                  )}
                </span>
                {m.role !== "admin" && (
                  <button
                    type="button"
                    onClick={() => void kick(m.id)}
                    className="text-[10px] text-red-400 hover:underline"
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </header>
  );
}
