"use client";

import { useState } from "react";
import { API_URL } from "@/lib/api";

interface InviteCode {
  code: string;
  is_active: boolean;
  used_by_email: string | null;
  used_at: string | null;
  created_at: string;
}

export default function AdminPage() {
  const [secret, setSecret] = useState("");
  const [authed, setAuthed] = useState(false);
  const [authError, setAuthError] = useState("");

  const [codes, setCodes] = useState<InviteCode[]>([]);
  const [loadingCodes, setLoadingCodes] = useState(false);

  const [grantEmail, setGrantEmail] = useState("");
  const [grantMsg, setGrantMsg] = useState("");

  const [revokeEmail, setRevokeEmail] = useState("");
  const [revokeMsg, setRevokeMsg] = useState("");

  const [generating, setGenerating] = useState(false);
  const [newCode, setNewCode] = useState("");

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault();
    setAuthError("");
    const res = await fetch(`${API_URL}/api/admin/invite-codes`, {
      headers: { "x-admin-secret": secret },
    });
    if (res.ok) {
      const data = await res.json();
      setCodes(data);
      setAuthed(true);
    } else {
      setAuthError("Invalid admin secret.");
    }
  }

  async function loadCodes() {
    setLoadingCodes(true);
    const res = await fetch(`${API_URL}/api/admin/invite-codes`, {
      headers: { "x-admin-secret": secret },
    });
    if (res.ok) setCodes(await res.json());
    setLoadingCodes(false);
  }

  async function generateCode() {
    setGenerating(true);
    setNewCode("");
    const res = await fetch(`${API_URL}/api/admin/invite-codes`, {
      method: "POST",
      headers: { "x-admin-secret": secret },
    });
    if (res.ok) {
      const data = await res.json();
      setNewCode(data.code);
      loadCodes();
    }
    setGenerating(false);
  }

  async function revokeCode(code: string) {
    await fetch(`${API_URL}/api/admin/invite-codes/${code}`, {
      method: "DELETE",
      headers: { "x-admin-secret": secret },
    });
    loadCodes();
  }

  async function handleGrant(e: React.FormEvent) {
    e.preventDefault();
    setGrantMsg("");
    const res = await fetch(`${API_URL}/api/admin/grant-access`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-secret": secret },
      body: JSON.stringify({ email: grantEmail }),
    });
    const data = await res.json();
    setGrantMsg(res.ok ? `✓ Access granted to ${data.email}` : `✗ ${data.detail}`);
    setGrantEmail("");
  }

  async function handleRevoke(e: React.FormEvent) {
    e.preventDefault();
    setRevokeMsg("");
    const res = await fetch(`${API_URL}/api/admin/revoke-access`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-secret": secret },
      body: JSON.stringify({ email: revokeEmail }),
    });
    const data = await res.json();
    setRevokeMsg(res.ok ? `✓ Access revoked for ${data.email}` : `✗ ${data.detail}`);
    setRevokeEmail("");
  }

  if (!authed) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-bold text-foreground mb-6 text-center">Admin</h1>
          <form onSubmit={handleAuth} className="glass rounded-2xl p-7 flex flex-col gap-4">
            {authError && (
              <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">{authError}</p>
            )}
            <input
              type="password"
              className="input-base"
              placeholder="Admin secret"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              required
            />
            <button type="submit" className="h-10 rounded-lg gradient-btn font-semibold text-sm">
              Enter
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background p-6 max-w-2xl mx-auto flex flex-col gap-8">
      <h1 className="text-2xl font-bold text-foreground">Admin Panel</h1>

      {/* Invite Codes */}
      <section className="glass rounded-2xl p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-foreground">Invite Codes</h2>
          <button
            onClick={generateCode}
            disabled={generating}
            className="h-9 px-4 rounded-lg gradient-btn font-semibold text-sm disabled:opacity-60"
          >
            {generating ? "Generating…" : "+ Generate Code"}
          </button>
        </div>

        {newCode && (
          <div className="flex items-center gap-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3">
            <p className="text-sm text-emerald-400 font-medium">New code:</p>
            <code className="text-emerald-300 font-mono text-sm tracking-wider">{newCode}</code>
            <button
              onClick={() => navigator.clipboard.writeText(newCode)}
              className="ml-auto text-xs text-emerald-400/70 hover:text-emerald-400 transition-colors"
            >
              Copy
            </button>
          </div>
        )}

        <div className="flex flex-col gap-2">
          {loadingCodes && <p className="text-sm text-muted-foreground">Loading…</p>}
          {codes.length === 0 && !loadingCodes && (
            <p className="text-sm text-muted-foreground">No codes yet.</p>
          )}
          {codes.map((c) => (
            <div key={c.code} className="flex items-center gap-3 bg-card border border-border rounded-xl px-4 py-3">
              <code className="font-mono text-sm text-foreground tracking-wider flex-1">{c.code}</code>
              {c.used_by_email ? (
                <span className="text-xs text-muted-foreground">Used by {c.used_by_email}</span>
              ) : c.is_active ? (
                <span className="text-xs text-emerald-400">Available</span>
              ) : (
                <span className="text-xs text-red-400">Revoked</span>
              )}
              {c.is_active && !c.used_by_email && (
                <button
                  onClick={() => revokeCode(c.code)}
                  className="text-xs text-muted-foreground hover:text-red-400 transition-colors"
                >
                  Revoke
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Grant Access */}
      <section className="glass rounded-2xl p-6 flex flex-col gap-4">
        <h2 className="font-semibold text-foreground">Grant Free Access</h2>
        <p className="text-sm text-muted-foreground">Give any existing user free access without a subscription.</p>
        <form onSubmit={handleGrant} className="flex gap-3">
          <input
            type="email"
            className="input-base flex-1"
            placeholder="user@example.com"
            value={grantEmail}
            onChange={(e) => setGrantEmail(e.target.value)}
            required
          />
          <button type="submit" className="h-10 px-4 rounded-lg gradient-btn font-semibold text-sm whitespace-nowrap">
            Grant
          </button>
        </form>
        {grantMsg && <p className={`text-sm ${grantMsg.startsWith("✓") ? "text-emerald-400" : "text-red-400"}`}>{grantMsg}</p>}
      </section>

      {/* Revoke Access */}
      <section className="glass rounded-2xl p-6 flex flex-col gap-4">
        <h2 className="font-semibold text-foreground">Revoke Access</h2>
        <p className="text-sm text-muted-foreground">Remove access from a user immediately.</p>
        <form onSubmit={handleRevoke} className="flex gap-3">
          <input
            type="email"
            className="input-base flex-1"
            placeholder="user@example.com"
            value={revokeEmail}
            onChange={(e) => setRevokeEmail(e.target.value)}
            required
          />
          <button type="submit" className="h-10 px-4 rounded-lg bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-400 font-semibold text-sm rounded-lg transition-colors whitespace-nowrap">
            Revoke
          </button>
        </form>
        {revokeMsg && <p className={`text-sm ${revokeMsg.startsWith("✓") ? "text-emerald-400" : "text-red-400"}`}>{revokeMsg}</p>}
      </section>
    </main>
  );
}
