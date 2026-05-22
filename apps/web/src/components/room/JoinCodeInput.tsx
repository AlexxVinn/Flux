"use client";

import { useRef, useState } from "react";

interface JoinCodeInputProps {
  onSubmit: (code: string) => void | Promise<void>;
  loading?: boolean;
  label?: string;
  centered?: boolean;
}

export function JoinCodeInput({
  onSubmit,
  loading = false,
  label = "Room code",
  centered = false,
}: JoinCodeInputProps) {
  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const submittingRef = useRef(false);

  const submitCode = (raw: string) => {
    const code = raw.replace(/\D/g, "").slice(0, 6);
    if (code.length !== 6 || loading || submittingRef.current) return;

    submittingRef.current = true;
    void Promise.resolve(onSubmit(code)).finally(() => {
      submittingRef.current = false;
    });
  };

  const update = (index: number, value: string) => {
    const d = value.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[index] = d;
    setDigits(next);
    if (d && index < 5) {
      document.getElementById(`join-digit-${index + 1}`)?.focus();
    }
    submitCode(next.join(""));
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (pasted.length !== 6) return;
    setDigits(pasted.split(""));
    submitCode(pasted);
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      document.getElementById(`join-digit-${index - 1}`)?.focus();
    }
  };

  return (
    <div className={`w-full min-w-0 space-y-2 ${centered ? "text-center" : ""}`}>
      {label ? (
        <p
          className={`text-[11px] font-medium uppercase tracking-widest text-flux-muted ${
            centered ? "text-center" : ""
          }`}
        >
          {label}
        </p>
      ) : null}
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
            autoComplete={i === 0 ? "one-time-code" : "off"}
            maxLength={1}
            value={d}
            disabled={loading}
            onChange={(e) => update(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            className="h-10 w-full min-w-0 rounded-md border border-[var(--flux-border)] bg-black text-center font-mono text-base text-white outline-none focus:border-[var(--flux-border-active)] sm:h-11 sm:text-lg"
          />
        ))}
      </div>
    </div>
  );
}
