"use client";

import { useState, useRef, useEffect } from "react";
import { useCollaborationStore } from "@/store/collaborationStore";
import { useCanWriteInRoom } from "@/store/roomSessionStore";

export function DiscussionPanel({ bare = false }: { bare?: boolean }) {
  const messages = useCollaborationStore((s) => s.messages);
  const connected = useCollaborationStore((s) => s.connected || s.supabaseConnected);
  const sendChat = useCollaborationStore((s) => s.sendChat);
  const canWrite = useCanWriteInRoom();
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    sendChat(draft);
    setDraft("");
  };

  return (
    <section className={bare ? "flex min-h-0 flex-1 flex-col" : "flex min-h-0 flex-1 flex-col border-t border-flux-border"}>
      {!bare && (
        <header className="flex items-center justify-between px-2 py-1.5">
          <h3 className="text-[9px] font-semibold uppercase tracking-widest text-flux-muted">
            Discussion
          </h3>
          <span
            className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-white/80" : "bg-white/20"}`}
            title={connected ? "Connected" : "Offline"}
          />
        </header>
      )}
      {bare && (
        <div className="flex items-center justify-end px-3 pt-1">
          <span
            className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-white/80" : "bg-white/20"}`}
            title={connected ? "Connected" : "Offline"}
          />
        </div>
      )}
      <div className="flux-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-1">
        {messages.length === 0 ? (
          <p className="py-2 text-[10px] text-flux-muted">
            Discuss the experiment with collaborators in this room.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {messages.map((m) => (
              <li key={m.id} className="text-[11px]">
                <span className="font-medium text-flux-text">{m.displayName}</span>
                {m.role === "admin" && (
                  <span className="ml-1 rounded bg-flux-elevated px-1 py-0.5 text-[8px] uppercase tracking-wider text-flux-muted">
                    admin
                  </span>
                )}
                <span className="ml-1.5 text-[9px] text-flux-muted">
                  {new Date(m.timestamp).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <p className="mt-0.5 leading-snug text-flux-muted">{m.text}</p>
              </li>
            ))}
          </ul>
        )}
        <div ref={endRef} />
      </div>
      {canWrite ? (
        <form onSubmit={submit} className="border-t border-flux-border p-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Comment on the experiment…"
            className="w-full rounded border border-flux-border bg-flux-bg px-2 py-1 text-[11px] text-flux-text placeholder:text-flux-muted focus:border-flux-focus focus:outline-none"
          />
        </form>
      ) : (
        <p className="border-t border-flux-border p-2 text-[10px] text-flux-muted">
          Spectator mode — you can read the discussion but not post.
        </p>
      )}
    </section>
  );
}
