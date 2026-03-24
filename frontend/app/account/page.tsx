"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, API_URL } from "@/lib/api";
import { useAuthGuard } from "@/lib/useAuthGuard";

interface User {
  id: number;
  email: string;
  subscription_status: string;
  created_at: string;
}

interface Subscription {
  status: string;
  plan: string | null;
  end: string | null;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="glass border border-border rounded-2xl p-6 flex flex-col gap-5">
      <h2 className="font-semibold text-foreground">{title}</h2>
      {children}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
      <span className="text-sm text-foreground">{value}</span>
    </div>
  );
}

export default function AccountPage() {
  useAuthGuard();

  const [user, setUser] = useState<User | null>(null);
  const [sub, setSub] = useState<Subscription | null>(null);

  // Email change
  const [emailPassword, setEmailPassword] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [emailMsg, setEmailMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [emailLoading, setEmailLoading] = useState(false);

  // Password change
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordMsg, setPasswordMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [passwordLoading, setPasswordLoading] = useState(false);

  // Cancel subscription
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [canceling, setCanceling] = useState(false);

  useEffect(() => {
    apiFetch("/api/auth/me").then((r) => r.json()).then(setUser);
    apiFetch("/api/stripe/subscription").then((r) => r.json()).then(setSub);
  }, []);

  async function handleEmailChange(e: React.FormEvent) {
    e.preventDefault();
    setEmailMsg(null);
    setEmailLoading(true);
    try {
      const res = await apiFetch("/api/auth/email", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: emailPassword, new_email: newEmail }),
      });
      if (res.ok) {
        const updated = await res.json();
        setUser(updated);
        setEmailPassword("");
        setNewEmail("");
        setEmailMsg({ ok: true, text: "Email updated successfully." });
      } else {
        const d = await res.json().catch(() => ({}));
        setEmailMsg({ ok: false, text: d.detail || "Failed to update email." });
      }
    } catch {
      setEmailMsg({ ok: false, text: "Could not reach the server." });
    } finally {
      setEmailLoading(false);
    }
  }

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    setPasswordMsg(null);
    if (newPassword !== confirmPassword) {
      setPasswordMsg({ ok: false, text: "New passwords don't match." });
      return;
    }
    setPasswordLoading(true);
    try {
      const res = await apiFetch("/api/auth/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      });
      if (res.ok) {
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        setPasswordMsg({ ok: true, text: "Password updated successfully." });
      } else {
        const d = await res.json().catch(() => ({}));
        setPasswordMsg({ ok: false, text: d.detail || "Failed to update password." });
      }
    } catch {
      setPasswordMsg({ ok: false, text: "Could not reach the server." });
    } finally {
      setPasswordLoading(false);
    }
  }

  async function handleCancel() {
    setCanceling(true);
    try {
      const res = await apiFetch("/api/stripe/cancel", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        // Reload subscription info to show updated status
        const subRes = await apiFetch("/api/stripe/subscription");
        if (subRes.ok) setSub(await subRes.json());
        setCancelConfirm(false);
        setCanceling(false);
        if (data.access_until) {
          alert(`Your subscription has been canceled. You will have access until ${formatDate(data.access_until)}.`);
        }
      } else {
        const d = await res.json().catch(() => ({}));
        alert(d.detail || "Failed to cancel subscription.");
        setCanceling(false);
        setCancelConfirm(false);
      }
    } catch {
      alert("Could not reach the server.");
      setCanceling(false);
      setCancelConfirm(false);
    }
  }

  function formatDate(iso: string | null | undefined) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  }

  function planLabel(plan: string | null) {
    if (plan === "monthly") return "Monthly ($4.99/mo)";
    if (plan === "biannual") return "6 Months ($19.99)";
    if (plan === "gifted") return "Gifted access";
    return plan || "—";
  }

  function statusBadge(status: string) {
    const map: Record<string, string> = {
      active: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
      trialing: "bg-blue-500/15 text-blue-400 border-blue-500/25",
      canceling: "bg-amber-500/15 text-amber-400 border-amber-500/25",
      canceled: "bg-red-500/15 text-red-400 border-red-500/25",
      free: "bg-muted text-muted-foreground border-border",
    };
    return map[status] || map.free;
  }

  function statusLabel(status: string) {
    if (status === "canceling") return "Canceling";
    return status.charAt(0).toUpperCase() + status.slice(1);
  }

  return (
    <main className="min-h-screen bg-background">
      {/* Navbar */}
      <nav className="sticky top-0 z-20 glass border-b border-border/60">
        <div className="max-w-3xl mx-auto flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors text-sm">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
              Dashboard
            </Link>
            <span className="text-border">·</span>
            <span className="text-sm font-semibold text-foreground">Account</span>
          </div>
          <button
            className="text-xs font-medium px-3 py-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground"
            onClick={() => { localStorage.removeItem("token"); window.location.href = "/login"; }}
          >
            Log out
          </button>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-6 py-10 flex flex-col gap-6">
        <h1 className="text-2xl font-bold text-foreground">Account</h1>

        {/* Subscription */}
        <Section title="Subscription">
          {sub ? (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</span>
                  <span className={`inline-flex w-fit text-xs font-semibold px-2.5 py-1 rounded-full border ${statusBadge(sub.status)}`}>
                    {statusLabel(sub.status)}
                  </span>
                </div>
                <Field label="Plan" value={planLabel(sub.plan)} />
                <Field label="Renews / Ends" value={formatDate(sub.end)} />
              </div>
              {sub.status === "active" && sub.end && (
                <p className="text-xs text-muted-foreground">
                  Your next billing date is <span className="text-foreground font-medium">{formatDate(sub.end)}</span>.
                </p>
              )}
              {sub.status === "canceling" && sub.end && (
                <p className="text-xs text-amber-400/80">
                  Your subscription is canceled. You have access until <span className="font-medium text-amber-400">{formatDate(sub.end)}</span>, after which your account will be deactivated.
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Loading…</p>
          )}
        </Section>

        {/* Account info */}
        <Section title="Account Info">
          <Field label="Email" value={user?.email || "…"} />
          <Field label="Member since" value={formatDate(user?.created_at)} />
        </Section>

        {/* Change email */}
        <Section title="Change Email">
          <form onSubmit={handleEmailChange} className="flex flex-col gap-4">
            {emailMsg && (
              <p className={`text-sm px-4 py-3 rounded-xl border ${emailMsg.ok ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" : "text-red-400 bg-red-500/10 border-red-500/20"}`}>
                {emailMsg.text}
              </p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">New Email</label>
                <input type="email" required className="input-base" placeholder="new@example.com" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Current Password</label>
                <input type="password" required className="input-base" placeholder="Confirm with your password" value={emailPassword} onChange={(e) => setEmailPassword(e.target.value)} />
              </div>
            </div>
            <button type="submit" disabled={emailLoading} className="w-fit h-10 px-5 rounded-xl gradient-btn font-semibold text-sm disabled:opacity-60">
              {emailLoading ? "Saving…" : "Update Email"}
            </button>
          </form>
        </Section>

        {/* Change password */}
        <Section title="Change Password">
          <form onSubmit={handlePasswordChange} className="flex flex-col gap-4">
            {passwordMsg && (
              <p className={`text-sm px-4 py-3 rounded-xl border ${passwordMsg.ok ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" : "text-red-400 bg-red-500/10 border-red-500/20"}`}>
                {passwordMsg.text}
              </p>
            )}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Current Password</label>
              <input type="password" required className="input-base" placeholder="Your current password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">New Password</label>
                <input type="password" required minLength={8} className="input-base" placeholder="At least 8 characters" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Confirm New Password</label>
                <input type="password" required className="input-base" placeholder="Repeat new password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
              </div>
            </div>
            <button type="submit" disabled={passwordLoading} className="w-fit h-10 px-5 rounded-xl gradient-btn font-semibold text-sm disabled:opacity-60">
              {passwordLoading ? "Saving…" : "Update Password"}
            </button>
          </form>
        </Section>

        {/* Danger zone */}
        <Section title="Danger Zone">
          <p className="text-sm text-muted-foreground">
            {sub?.status === "canceling"
              ? <>Your subscription is already canceled. Access ends on <span className="text-foreground font-medium">{formatDate(sub.end)}</span>.</>
              : <>Canceling will end your subscription at the end of the current billing period. You keep access until then.</>
            }
          </p>
          {sub?.status !== "canceling" && !cancelConfirm ? (
            <button
              onClick={() => setCancelConfirm(true)}
              className="w-fit h-10 px-5 rounded-xl border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 font-semibold text-sm transition-colors"
            >
              Cancel Subscription
            </button>
          ) : sub?.status !== "canceling" ? (
            <div className="flex flex-col gap-3 p-4 rounded-xl border border-red-500/30 bg-red-500/5">
              <p className="text-sm text-red-400 font-medium">Are you sure? This cannot be undone.</p>
              <div className="flex gap-3">
                <button
                  onClick={handleCancel}
                  disabled={canceling}
                  className="h-9 px-4 rounded-lg border border-red-500/40 bg-red-500/20 text-red-400 hover:bg-red-500/30 font-semibold text-sm transition-colors disabled:opacity-60"
                >
                  {canceling ? "Canceling…" : "Yes, cancel my subscription"}
                </button>
                <button
                  onClick={() => setCancelConfirm(false)}
                  className="h-9 px-4 rounded-lg border border-border hover:bg-muted text-muted-foreground font-semibold text-sm transition-colors"
                >
                  Keep my subscription
                </button>
              </div>
            </div>
          )}
        </Section>
      </div>
    </main>
  );
}
