"use client";

import { useState } from "react";

interface JoinCodeInputProps {
  onSubmit: (code: string) => void | Promise<void>;
  loading?: boolean;
  label?: string;
}

export function JoinCodeInput({
  onSubmit,
  loading = false,
  label = "Room code",
}: JoinCodeInputProps) {
  const [digits, setDigits] = useState(["", "", "", "", "", ""]);

  const update = (index: number, value: string) => {
    const d = value.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[index] = d;
    setDigits(next);
    if (d && index < 5) {
      document.getElementById(`join-digit-${index + 1}`)?.focus();
    }
    const code = next.join("");
    if (code.length === 6) void onSubmit(code);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (pasted.length === 6) {
      setDigits(pasted.split(""));
      void onSubmit(pasted);
    }
  };

  return (
    <div className="w-full min-w-0 space-y-2">
      <p className="text-[11px] font-medium uppercase tracking-widest text-flux-muted">{label}</p>
      <div
        className="grid w-full min-w-0 grid-cols-6 gap-1 sm:gap-1.5"
        onPaste={handlePaste}
      >
        {digits.map((d, i) => (
          <input
            key={i}
            id={`join-digit-${i}`}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={d}
            disabled={loading}
            onChange={(e) => update(i, e.target.value)}
            className="h-10 w-full min-w-0 rounded-md border border-[var(--flux-border)] bg-black text-center font-mono text-base text-white outline-none focus:border-[var(--flux-border-active)] sm:h-11 sm:text-lg"
          />
        ))}
      </div>
    </div>
  );
}
