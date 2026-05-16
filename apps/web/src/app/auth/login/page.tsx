"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { signInSchema } from "@/lib/auth/validation";
import { useAuthStore } from "@/store/authStore";

export default function LoginPage() {
  const router = useRouter();
  const signIn = useAuthStore((s) => s.signIn);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = signInSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError(parsed.error.errors[0]?.message ?? "Invalid input");
      return;
    }
    setLoading(true);
    try {
      await signIn(parsed.data.email, parsed.data.password);
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
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
        <h1 className="text-lg font-semibold text-flux-text">Sign in</h1>
        <p className="text-xs text-flux-muted">Join collaborative physics sessions on Flux.</p>
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
          <span className="text-[11px] text-flux-muted">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-flux-border bg-flux-elevated px-3 py-2 text-sm outline-none focus:border-flux-focus"
            autoComplete="current-password"
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-flux-text py-2 text-sm font-medium text-flux-bg disabled:opacity-50"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
        <p className="text-center text-xs text-flux-muted">
          No account?{" "}
          <Link href="/auth/signup" className="text-flux-text underline">
            Sign up
          </Link>
        </p>
        <Link href="/" className="block text-center text-xs text-flux-muted hover:text-flux-text">
          ← Back to home
        </Link>
      </form>
    </div>
  );
}
