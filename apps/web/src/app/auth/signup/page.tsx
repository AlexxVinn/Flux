"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { displayNameSchema, signUpSchema } from "@/lib/auth/validation";
import { useAuthStore } from "@/store/authStore";

export default function SignUpPage() {
  const router = useRouter();
  const signUp = useAuthStore((s) => s.signUp);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const base = signUpSchema.safeParse({
      email,
      password,
      displayName: displayName.trim() || undefined,
    });
    if (!base.success) {
      setError(base.error.errors[0]?.message ?? "Invalid input");
      return;
    }
    if (displayName.trim()) {
      const nameCheck = displayNameSchema.safeParse(displayName.trim());
      if (!nameCheck.success) {
        setError(nameCheck.error.errors[0]?.message ?? "Invalid display name");
        return;
      }
    }

    setLoading(true);
    try {
      await signUp(
        base.data.email,
        base.data.password,
        displayName.trim() || undefined,
      );
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign up failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-flux-bg px-4">
      <form
        onSubmit={(e) => void submit(e)}
        className="w-full max-w-sm space-y-4 rounded-xl border border-flux-border bg-flux-panel p-6"
      >
        <h1 className="text-lg font-semibold text-flux-text">Create account</h1>
        <p className="text-xs text-flux-muted">
          You get a unique name like <span className="font-mono">U_XXXXX</span> until you pick
          your own.
        </p>
        {error && <p className="text-xs text-red-400">{error}</p>}
        <label className="block space-y-1">
          <span className="text-[11px] text-flux-muted">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-flux-border bg-flux-elevated px-3 py-2 text-sm outline-none focus:border-flux-focus"
            autoComplete="email"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-[11px] text-flux-muted">Password (min 6 characters)</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-flux-border bg-flux-elevated px-3 py-2 text-sm outline-none focus:border-flux-focus"
            autoComplete="new-password"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-[11px] text-flux-muted">Display name (optional)</span>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Leave blank for U_XXXXX"
            className="w-full rounded-lg border border-flux-border bg-flux-elevated px-3 py-2 text-sm outline-none focus:border-flux-focus"
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-flux-text py-2 text-sm font-medium text-flux-bg disabled:opacity-50"
        >
          {loading ? "Creating…" : "Sign up"}
        </button>
        <p className="text-center text-xs text-flux-muted">
          Already have an account?{" "}
          <Link href="/auth/login" className="text-flux-text underline">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
