"use client";

import { useMemo, useState } from "react";
import type { MemberRole } from "@flux/shared";
import { UserAvatar } from "@/components/collaboration/UserAvatar";
import { useRoomMembers } from "@/hooks/useRoomMembers";
import { kickRoomMember } from "@/lib/rooms/api";
import { formatJoinedAt, ROLE_LABELS, type EnrichedRoomMember } from "@/lib/rooms/members";
import { useIsRoomAdmin } from "@/store/roomSessionStore";
import { useRoomSessionStore } from "@/store/roomSessionStore";

type RoleFilter = "all" | MemberRole;

const ROLE_STYLES: Record<MemberRole, string> = {
  admin: "border-amber-400/35 bg-amber-400/10 text-amber-200",
  member: "border-white/15 bg-white/[0.06] text-white/75",
  spectator: "border-white/10 bg-white/[0.03] text-white/45",
};

const PRESENCE_STYLES: Record<EnrichedRoomMember["presence"], string> = {
  online: "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.55)]",
  away: "bg-amber-400/90",
  offline: "bg-white/20",
};

function MemberActions({
  member,
  onRemoved,
}: {
  member: EnrichedRoomMember;
  onRemoved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const remove = async () => {
    setBusy(true);
    try {
      await kickRoomMember(member.id);
      setOpen(false);
      setConfirmRemove(false);
      onRemoved();
    } catch {
      /* toast could go here */
    } finally {
      setBusy(false);
    }
  };

  if (member.role === "admin") return null;

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flux-btn flex h-7 w-7 items-center justify-center rounded-md text-white/40 hover:text-white/80"
        aria-label={`Actions for ${member.displayName}`}
        aria-expanded={open}
      >
        ⋮
      </button>
      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            aria-label="Close menu"
            onClick={() => {
              setOpen(false);
              setConfirmRemove(false);
            }}
          />
          <div className="absolute right-0 top-full z-50 mt-1 min-w-[168px] overflow-hidden rounded-lg border border-white/10 bg-[#0c0c0e] py-1 shadow-xl">
            {!confirmRemove ? (
              <button
                type="button"
                onClick={() => setConfirmRemove(true)}
                className="flex w-full px-3 py-2 text-left text-[11px] text-red-300 hover:bg-red-500/10"
              >
                Remove from room…
              </button>
            ) : (
              <div className="px-3 py-2">
                <p className="text-[10px] leading-snug text-white/55">
                  Remove <span className="text-white/85">{member.displayName}</span>?
                </p>
                <div className="mt-2 flex gap-1.5">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void remove()}
                    className="flex-1 rounded border border-red-500/40 bg-red-500/15 px-2 py-1 text-[10px] font-medium text-red-200 hover:bg-red-500/25 disabled:opacity-50"
                  >
                    {busy ? "…" : "Remove"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmRemove(false)}
                    className="flex-1 rounded border border-white/10 px-2 py-1 text-[10px] text-white/55 hover:text-white/80"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function MemberRow({
  member,
  isAdmin,
  onRemoved,
}: {
  member: EnrichedRoomMember;
  isAdmin: boolean;
  onRemoved: () => void;
}) {
  return (
    <li className="group flex items-center gap-2.5 rounded-lg border border-transparent px-2 py-2 transition hover:border-white/[0.06] hover:bg-white/[0.03]">
      <div className="relative shrink-0">
        <UserAvatar
          userId={member.avatarSeed}
          color={member.avatarColor}
          size={40}
          displayName={member.displayName}
        />
        <span
          className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-[#0a0a0c] ${PRESENCE_STYLES[member.presence]}`}
          title={
            member.presence === "online"
              ? "Online"
              : member.presence === "away"
                ? "Away"
                : "Offline"
          }
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-[12px] font-medium text-white/90">
            {member.displayName}
          </span>
          {member.isSelf && (
            <span className="rounded bg-white/10 px-1 py-0.5 text-[8px] font-semibold uppercase tracking-wider text-white/50">
              You
            </span>
          )}
          {member.isGuest && (
            <span className="rounded border border-white/10 px-1 py-0.5 text-[8px] uppercase tracking-wider text-white/35">
              Guest
            </span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2">
          <span
            className={`rounded border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide ${ROLE_STYLES[member.role]}`}
          >
            {ROLE_LABELS[member.role]}
          </span>
          <span className="text-[10px] text-white/35">
            {member.presence === "online" ? "Online" : member.presence === "away" ? "Away" : "Offline"}
            {member.joinedAt ? ` · ${formatJoinedAt(member.joinedAt)}` : ""}
          </span>
        </div>
      </div>

      {isAdmin && !member.isSelf && (
        <MemberActions member={member} onRemoved={onRemoved} />
      )}
    </li>
  );
}

export function MembersPanel({ bare = false }: { bare?: boolean }) {
  const membership = useRoomSessionStore((s) => s.membership);
  const isAdmin = useIsRoomAdmin();
  const { members, loading, error, reload, onlineCount, totalCount } = useRoomMembers(true);

  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [copied, setCopied] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return members
      .filter((m) => roleFilter === "all" || m.role === roleFilter)
      .filter((m) => !q || m.displayName.toLowerCase().includes(q))
      .sort((a, b) => {
        const roleOrder = { admin: 0, member: 1, spectator: 2 };
        if (roleOrder[a.role] !== roleOrder[b.role]) {
          return roleOrder[a.role] - roleOrder[b.role];
        }
        if (a.presence === "online" && b.presence !== "online") return -1;
        if (b.presence === "online" && a.presence !== "online") return 1;
        return a.displayName.localeCompare(b.displayName);
      });
  }, [members, query, roleFilter]);

  const copyCode = async () => {
    if (!membership?.joinCode) return;
    await navigator.clipboard.writeText(membership.joinCode);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  if (!membership) {
    return (
      <p className="px-3 py-4 text-[11px] text-white/40">
        Join or create a room to see the member roster.
      </p>
    );
  }

  return (
    <section className={bare ? "flex min-h-0 flex-1 flex-col" : "flex min-h-0 flex-1 flex-col border-t border-flux-border"}>
      <div className="shrink-0 space-y-2 border-b border-white/[0.06] px-3 py-2.5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[11px] font-medium text-white/85">Session roster</p>
            <p className="mt-0.5 text-[10px] text-white/40">
              {totalCount} member{totalCount === 1 ? "" : "s"} · {onlineCount} online
            </p>
          </div>
          <button
            type="button"
            onClick={() => void reload()}
            disabled={loading}
            className="flux-btn shrink-0 px-2 py-1 text-[10px] text-white/45 hover:text-white/75 disabled:opacity-40"
            title="Refresh roster"
          >
            {loading ? "…" : "↻"}
          </button>
        </div>

        <div className="flex gap-1.5">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name…"
            className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/40 px-2.5 py-1.5 text-[11px] text-white/90 placeholder:text-white/30 focus:border-white/25 focus:outline-none"
          />
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as RoleFilter)}
            className="max-w-[108px] shrink-0 rounded-md border border-white/10 bg-black/40 px-2 py-1.5 text-[11px] text-white/75 focus:border-white/25 focus:outline-none"
            aria-label="Filter by role"
          >
            <option value="all">All roles</option>
            <option value="admin">Admins</option>
            <option value="member">Members</option>
            <option value="spectator">Spectators</option>
          </select>
        </div>

        <div className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-2">
          <div className="min-w-0">
            <p className="text-[9px] font-semibold uppercase tracking-widest text-white/35">
              Invite code
            </p>
            <p className="font-mono text-sm tracking-wider text-white/90">{membership.joinCode}</p>
          </div>
          <button
            type="button"
            onClick={() => void copyCode()}
            className="flux-btn shrink-0 px-2.5 py-1.5 text-[10px] font-medium text-white/70 hover:text-white"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        {isAdmin && (
          <p className="text-[10px] leading-snug text-white/35">
            As admin you can remove members who are not admins. Role changes sync from room setup.
          </p>
        )}
      </div>

      <div className="flux-scroll min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {error && (
          <p className="mb-2 rounded-md border border-red-500/25 bg-red-500/10 px-2.5 py-2 text-[11px] text-red-200">
            {error}
          </p>
        )}

        {loading && members.length === 0 ? (
          <p className="py-6 text-center text-[11px] text-white/35">Loading members…</p>
        ) : filtered.length === 0 ? (
          <p className="py-6 text-center text-[11px] text-white/35">
            {members.length === 0 ? "No members in this room yet." : "No members match your filters."}
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {filtered.map((m) => (
              <MemberRow key={m.id} member={m} isAdmin={isAdmin} onRemoved={() => void reload()} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
