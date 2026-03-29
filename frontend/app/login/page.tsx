"use client";

import { useEffect, useState } from "react";
import { API_URL } from "@/lib/api";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [justRegistered, setJustRegistered] = useState(false);
  const [warming, setWarming] = useState(false);
  const [resendingVerification, setResendingVerification] = useState(false);
  const [verificationNotice, setVerificationNotice] = useState("");

  const needsVerificationHelp =
    justRegistered || error.toLowerCase().includes("verify your email");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("registered") === "1") setJustRegistered(true);

    // Pre-warm the backend: ping health endpoint so cold-start happens while
    // the user types, not after they click "Log in".
    const warmStart = Date.now();
    let warmTimer: ReturnType<typeof setTimeout>;
    warmTimer = setTimeout(() => setWarming(true), 1500);
    fetch(`${API_URL}/api/ping`)
      .catch(() => {})
      .finally(() => {
        clearTimeout(warmTimer);
        if (Date.now() - warmStart > 1500) setWarming(false);
      });
    return () => clearTimeout(warmTimer);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setVerificationNotice("");
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        const { access_token } = await res.json();
        localStorage.setItem("token", access_token);
        window.location.href = "/dashboard";
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.detail || "Invalid email or password.");
      }
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleResendVerification() {
    setError("");
    setVerificationNotice("");
    setResendingVerification(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/resend-verification`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setVerificationNotice(
          data.message ||
            "If that account exists and is unverified, a new verification link has been sent.",
        );
      } else {
        setError(data.detail || "Could not resend verification email. Please try again.");
      }
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setResendingVerification(false);
    }
  }

  return (
    <main className="min-h-screen bg-background flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background glow effects */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-indigo-400/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 left-1/3 w-[400px] h-[300px] bg-violet-400/4 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-sm relative z-10">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2.5 mb-6">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-400 to-violet-500 flex items-center justify-center shadow-md shadow-indigo-400/20">
              <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18" />
              </svg>
            </div>
            <span className="text-xl font-bold gradient-brand">FlowCard</span>
          </div>
          <h1 className="text-2xl font-bold text-foreground">Welcome back</h1>
          <p className="text-sm text-muted-foreground mt-1.5">Log in to your account</p>
        </div>

        {/* Card */}
        <div className="glass rounded-2xl p-7 flex flex-col gap-5">
          {justRegistered && (
            <div className="text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3">
              Account created! Please verify your email from your inbox before signing in.
            </div>
          )}
          {warming && !error && (
            <div className="text-sm text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3">
              Server is waking up — login will be ready in a moment.
            </div>
          )}
          {error && (
            <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
              {error}
            </div>
          )}
          {verificationNotice && (
            <div className="text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3">
              {verificationNotice}
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
                className="input-base"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-1 h-10 rounded-lg gradient-btn font-semibold text-sm transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? "Logging in…" : "Log in"}
            </button>
          </form>

          {needsVerificationHelp && (
            <button
              type="button"
              onClick={handleResendVerification}
              disabled={resendingVerification || !email || !password}
              className="text-sm text-indigo-400 hover:text-indigo-300 font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed text-center"
              title={!email || !password ? "Enter email and password first" : undefined}
            >
              {resendingVerification ? "Sending verification email…" : "Resend verification email"}
            </button>
          )}

          <p className="text-sm text-center text-muted-foreground">
            No account?{" "}
            <a href="/#pricing" className="text-indigo-400 hover:text-indigo-300 font-medium transition-colors">
              Get started
            </a>
          </p>
        </div>
      </div>
    </main>
  );
}
