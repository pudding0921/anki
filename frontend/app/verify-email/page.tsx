"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { API_URL } from "@/lib/api";

type VerifyState = "loading" | "success" | "error";

export default function VerifyEmailPage() {
  const [state, setState] = useState<VerifyState>("loading");
  const [message, setMessage] = useState("Verifying your email...");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");

    if (!token) {
      setState("error");
      setMessage("Missing verification token. Please use the link from your email.");
      return;
    }

    async function verifyEmail() {
      try {
        const res = await fetch(`${API_URL}/api/auth/verify-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          setState("success");
          setMessage(data.message || "Email verified. You can now log in.");
        } else {
          setState("error");
          setMessage(data.detail || "Verification failed. Please request a new verification email.");
        }
      } catch {
        setState("error");
        setMessage("Could not reach the server. Please try again.");
      }
    }

    verifyEmail();
  }, []);

  return (
    <main className="min-h-screen bg-background flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-indigo-400/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 left-1/3 w-[400px] h-[300px] bg-violet-400/4 rounded-full blur-3xl pointer-events-none" />

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
          <h1 className="text-2xl font-bold text-foreground">Email verification</h1>
        </div>

        <div className="glass rounded-2xl p-7 flex flex-col gap-5">
          {state === "loading" && (
            <div className="text-sm text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3">
              {message}
            </div>
          )}
          {state === "success" && (
            <div className="text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3">
              {message}
            </div>
          )}
          {state === "error" && (
            <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
              {message}
            </div>
          )}

          <Link
            href={state === "success" ? "/login" : "/login?registered=1"}
            className="h-10 rounded-lg gradient-btn font-semibold text-sm transition-all flex items-center justify-center"
          >
            Go to login
          </Link>
        </div>
      </div>
    </main>
  );
}
