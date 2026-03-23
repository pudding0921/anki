"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { API_URL } from "@/lib/api";

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Read query params client-side to avoid Suspense requirement
  const [subscribed, setSubscribed] = useState<boolean | null>(null); // null = not yet read
  const [sessionId, setSessionId] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setSubscribed(params.get("subscribed") === "1");
    setSessionId(params.get("session_id") || "");
  }, []);

  const passwordMismatch = confirm.length > 0 && confirm !== password;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const body: Record<string, string> = { email, password };
      if (sessionId) body.stripe_session_id = sessionId;

      const res = await fetch(`${API_URL}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        window.location.href = "/login?registered=1";
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.detail || "Registration failed. Please try again.");
      }
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  // Still reading params — show nothing to avoid flash
  if (subscribed === null) return null;

  // No subscription — show gate
  if (!subscribed) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center p-4 relative overflow-hidden">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-violet-400/5 rounded-full blur-3xl pointer-events-none" />

        <div className="w-full max-w-sm relative z-10 text-center flex flex-col items-center gap-6">
          <div className="inline-flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-400 to-violet-500 flex items-center justify-center shadow-md shadow-indigo-400/20">
              <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18" />
              </svg>
            </div>
            <span className="text-xl font-bold gradient-brand">FlowCard</span>
          </div>

          <div className="glass rounded-2xl p-8 flex flex-col items-center gap-5 border border-border w-full">
            <div className="w-14 h-14 rounded-full bg-indigo-400/15 border border-indigo-400/25 flex items-center justify-center text-2xl">
              🔒
            </div>
            <div className="flex flex-col gap-1.5 text-center">
              <h1 className="text-xl font-bold text-foreground">Subscription required</h1>
              <p className="text-sm text-muted-foreground leading-relaxed">
                FlowCard requires an active subscription to create an account. Choose a plan to get started.
              </p>
            </div>
            <a
              href="/#pricing"
              className="w-full h-11 rounded-xl gradient-btn font-semibold text-sm flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-95 transition-transform shadow-lg shadow-indigo-500/20"
            >
              View plans
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
            </a>
            <p className="text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link href="/login" className="text-indigo-400 hover:text-indigo-300 font-medium transition-colors">
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </main>
    );
  }

  // Subscribed — show registration form
  return (
    <main className="min-h-screen bg-background flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-violet-400/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/3 w-[400px] h-[300px] bg-indigo-400/4 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-sm relative z-10">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2.5 mb-6">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-400 to-violet-500 flex items-center justify-center shadow-md shadow-indigo-400/20">
              <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18" />
              </svg>
            </div>
            <span className="text-xl font-bold gradient-brand">FlowCard</span>
          </div>
          <h1 className="text-2xl font-bold text-foreground">Create your account</h1>
          <p className="text-sm text-muted-foreground mt-1.5">Your subscription is ready — just set up your account.</p>
        </div>

        {/* Subscription confirmed badge */}
        <div className="flex items-center gap-2 bg-emerald-400/10 border border-emerald-400/25 rounded-xl px-4 py-3 mb-4">
          <svg className="w-4 h-4 text-emerald-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          <p className="text-xs text-emerald-400 font-medium">Subscription confirmed — create your account below.</p>
        </div>

        <div className="glass rounded-2xl p-7 flex flex-col gap-5">
          {error && (
            <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Email
              </label>
              <input
                type="email"
                required
                className="input-base"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Password
              </label>
              <input
                type="password"
                required
                minLength={8}
                className="input-base"
                placeholder="Min. 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Confirm password
              </label>
              <input
                type="password"
                required
                className={`input-base transition-all ${passwordMismatch ? "border-red-500/50 focus:ring-red-500/30 focus:border-red-500/50" : confirm.length > 0 && confirm === password ? "border-emerald-500/40 focus:ring-emerald-500/25" : ""}`}
                placeholder="Re-enter your password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
              {passwordMismatch && (
                <p className="text-xs text-red-400 mt-0.5">Passwords don&apos;t match</p>
              )}
              {confirm.length > 0 && confirm === password && (
                <p className="text-xs text-emerald-400 mt-0.5">✓ Passwords match</p>
              )}
            </div>

            <button
              type="submit"
              disabled={loading || passwordMismatch}
              className="mt-1 h-10 rounded-lg gradient-btn font-semibold text-sm transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? "Creating account…" : "Create account"}
            </button>
          </form>

          <p className="text-sm text-center text-muted-foreground">
            Already have an account?{" "}
            <Link href="/login" className="text-indigo-400 hover:text-indigo-300 font-medium transition-colors">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
