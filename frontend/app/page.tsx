"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { API_URL } from "@/lib/api";

// ── Scroll-reveal hook ──────────────────────────────────────────────────────
function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold: 0.15 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return { ref, visible };
}

// ── Animated counter ────────────────────────────────────────────────────────
function Counter({ to, suffix = "" }: { to: number; suffix?: string }) {
  const { ref, visible } = useReveal();
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!visible) return;
    let start = 0;
    const step = Math.ceil(to / 60);
    const id = setInterval(() => {
      start += step;
      if (start >= to) { setCount(to); clearInterval(id); }
      else setCount(start);
    }, 16);
    return () => clearInterval(id);
  }, [visible, to]);
  return <span ref={ref}>{count.toLocaleString()}{suffix}</span>;
}

// ── Data ────────────────────────────────────────────────────────────────────
const STEPS = [
  {
    icon: "📸",
    title: "Upload anything",
    desc: "Lecture slides, textbook pages, handwritten notes — drop in a PDF or image and you're done.",
  },
  {
    icon: "⚡",
    title: "AI builds your deck",
    desc: "Our model reads every page, extracts key concepts, and generates accurate flashcards in seconds.",
  },
  {
    icon: "🧠",
    title: "Study & remember",
    desc: "Spaced repetition schedules each card at the exact moment your brain needs it — so nothing slips through.",
  },
];

const FEATURES = [
  {
    icon: "🖼️",
    label: "Image Occlusion",
    title: "Hide. Reveal. Remember.",
    desc: "Upload a slide and AI automatically blanks out every key term. Reveal them one by one during study — the same technique used by top med students worldwide.",
    accent: "from-indigo-400/20 to-blue-400/20",
    border: "border-indigo-400/20",
  },
  {
    icon: "✨",
    label: "AI Flashcards",
    title: "Paste notes. Get cards.",
    desc: "Drop in any text or image and get a full Q&A deck in under 10 seconds. No formatting, no manual work — just instant knowledge.",
    accent: "from-violet-400/20 to-purple-400/20",
    border: "border-violet-400/20",
  },
  {
    icon: "📅",
    label: "Spaced Repetition",
    title: "Study less, retain more.",
    desc: "The SM-2 algorithm (the same one behind Anki) shows you each card at the perfect moment — right before you forget it.",
    accent: "from-emerald-400/20 to-teal-400/20",
    border: "border-emerald-400/20",
  },
  {
    icon: "📦",
    label: "Anki Export",
    title: "Take your cards anywhere.",
    desc: "Export any deck as a .apkg file and import straight into Anki desktop. Your workflow, your way.",
    accent: "from-amber-400/20 to-orange-400/20",
    border: "border-amber-400/20",
  },
  {
    icon: "🗂️",
    label: "Folders & Decks",
    title: "Organized by design.",
    desc: "Group decks into folders, move cards between decks, and trash & restore anything within 30 days.",
    accent: "from-rose-400/20 to-pink-400/20",
    border: "border-rose-400/20",
  },
  {
    icon: "🔒",
    label: "Private & Secure",
    title: "Your cards. Only yours.",
    desc: "Every deck is locked to your account. Export or delete at any time — no lock-in, no hidden data collection.",
    accent: "from-cyan-400/20 to-sky-400/20",
    border: "border-cyan-400/20",
  },
];

const TESTIMONIALS = [
  {
    quote: "I went from cramming the night before to actually understanding the material. FlowCard generates a full deck from my lecture slides in seconds.",
    name: "Priya S.",
    role: "3rd-year Medical Student",
    avatar: "P",
    color: "bg-indigo-500/20 text-indigo-300",
  },
  {
    quote: "The image occlusion feature is a game-changer. It covers exactly the right terms — not just random words — and the spaced repetition keeps me on track.",
    name: "Marcus L.",
    role: "CS Undergrad",
    avatar: "M",
    color: "bg-violet-500/20 text-violet-300",
  },
  {
    quote: "I used to spend 2 hours making Anki cards. Now I upload my notes and get a full deck ready in 30 seconds. I genuinely don't know how I studied without this.",
    name: "Elena K.",
    role: "Law Student",
    avatar: "E",
    color: "bg-emerald-500/20 text-emerald-300",
  },
];

// ── Reveal wrapper ──────────────────────────────────────────────────────────
function Reveal({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  const { ref, visible } = useReveal();
  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(28px)",
        transition: `opacity 0.6s ease ${delay}ms, transform 0.6s ease ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}

// ── Pricing button (redirects to Stripe checkout) ───────────────────────────
function PricingButton({ plan, label, className = "" }: { plan: string; label: string; className?: string }) {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
      const endpoint = token ? "/api/stripe/create-checkout" : "/api/stripe/create-checkout-guest";
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch(`${API_URL}${endpoint}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ plan }),
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
    } catch {
      alert("Could not start checkout. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className={`mt-auto w-full py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-60 disabled:cursor-not-allowed ${
        className || "gradient-btn"
      }`}
    >
      {loading ? "Redirecting…" : label}
    </button>
  );
}

// ── Contact form ─────────────────────────────────────────────────────────────
function ContactForm() {
  const [form, setForm] = useState({ name: "", email: "", subject: "", message: "" });
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_URL}/api/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        setSuccess(true);
        setForm({ name: "", email: "", subject: "", message: "" });
      } else {
        const d = await res.json().catch(() => ({}));
        setError(d.detail || "Something went wrong. Please try again.");
      }
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="glass border border-emerald-400/20 rounded-2xl p-10 flex flex-col items-center gap-4 text-center">
        <div className="w-14 h-14 rounded-full bg-emerald-400/15 border border-emerald-400/25 flex items-center justify-center text-2xl">✓</div>
        <h3 className="text-lg font-bold text-emerald-400">Message sent!</h3>
        <p className="text-sm text-muted-foreground">Thanks for reaching out. We will get back to you within 24 hours.</p>
        <button onClick={() => setSuccess(false)} className="text-xs text-muted-foreground hover:text-foreground transition-colors mt-2">
          Send another message
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="glass border border-border rounded-2xl p-8 flex flex-col gap-5">
      {error && (
        <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">{error}</div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Name</label>
          <input
            required
            className="input-base"
            placeholder="Your name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Email</label>
          <input
            required
            type="email"
            className="input-base"
            placeholder="you@example.com"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Subject</label>
        <input
          required
          className="input-base"
          placeholder="What is this about?"
          value={form.subject}
          onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Message</label>
        <textarea
          required
          rows={5}
          className="input-base resize-none h-auto py-3"
          placeholder="Tell us what you need..."
          value={form.message}
          onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
        />
      </div>
      <button
        type="submit"
        disabled={loading}
        className="h-11 rounded-xl gradient-btn font-semibold text-sm transition-all disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {loading ? "Sending…" : "Send message →"}
      </button>
    </form>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────
export default function LandingPage() {
  const [scrolled, setScrolled] = useState(false);
  const [showCanceledBanner, setShowCanceledBanner] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("subscription") === "canceled") {
      setShowCanceledBanner(true);
      window.history.replaceState({}, "", "/");
    }
  }, []);

  return (
    <main className="min-h-screen bg-background flex flex-col overflow-x-hidden">

      {/* ── Subscription canceled banner ────────────────────────────────── */}
      {showCanceledBanner && (
        <div className="w-full bg-red-500/10 border-b border-red-500/20 px-6 py-3 flex items-center justify-between gap-4 z-50">
          <p className="text-sm text-red-400">Your subscription has been canceled and your account access has been removed.</p>
          <button onClick={() => setShowCanceledBanner(false)} className="text-red-400/60 hover:text-red-400 transition-colors text-lg leading-none">×</button>
        </div>
      )}

      {/* ── Navbar ──────────────────────────────────────────────────────── */}
      <nav
        className="fixed top-0 left-0 right-0 z-50 transition-all duration-300"
        style={{
          background: scrolled ? "rgba(32,30,50,0.85)" : "transparent",
          backdropFilter: scrolled ? "blur(16px)" : "none",
          borderBottom: scrolled ? "1px solid rgba(255,255,255,0.07)" : "1px solid transparent",
        }}
      >
        <div className="max-w-6xl mx-auto flex items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-400 to-violet-500 flex items-center justify-center shadow-md shadow-indigo-500/20">
              <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18" />
              </svg>
            </div>
            <span className="text-lg font-bold gradient-brand">FlowCard</span>
          </Link>
          <div className="flex items-center gap-1">
            <a href="#pricing" className="hidden sm:block text-sm font-medium text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5">Pricing</a>
            <a href="#contact" className="hidden sm:block text-sm font-medium text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5">Contact</a>
            <Link href="/login" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5">Log in</Link>
            <a href="#pricing" className="text-sm font-semibold px-4 py-2 rounded-lg gradient-btn transition-all">Get started</a>
          </div>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <section className="relative flex flex-col items-center justify-center text-center px-4 pt-40 pb-32 gap-7 overflow-hidden">
        {/* Animated ambient orbs */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div
            className="absolute top-[-10%] left-1/2 -translate-x-1/2 w-[900px] h-[600px] rounded-full"
            style={{
              background: "radial-gradient(ellipse, rgba(99,102,180,0.18) 0%, transparent 70%)",
              animation: "pulse-slow 6s ease-in-out infinite",
            }}
          />
          <div
            className="absolute top-[20%] left-[10%] w-[400px] h-[400px] rounded-full"
            style={{
              background: "radial-gradient(ellipse, rgba(139,92,180,0.10) 0%, transparent 70%)",
              animation: "float-slow 8s ease-in-out infinite",
            }}
          />
          <div
            className="absolute top-[15%] right-[5%] w-[350px] h-[350px] rounded-full"
            style={{
              background: "radial-gradient(ellipse, rgba(56,189,190,0.08) 0%, transparent 70%)",
              animation: "float-slow 10s ease-in-out infinite reverse",
            }}
          />
        </div>

        {/* Badge */}
        <div
          className="relative z-10 inline-flex items-center gap-2 border border-indigo-400/25 bg-indigo-400/8 rounded-full px-4 py-1.5 text-xs font-medium text-indigo-300"
          style={{ animation: "fade-in-down 0.7s ease both" }}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
          AI-powered · Spaced Repetition · Image Occlusion
        </div>

        {/* Headline */}
        <h1
          className="relative z-10 text-5xl sm:text-6xl md:text-7xl font-extrabold tracking-tight max-w-3xl leading-[1.08]"
          style={{ animation: "fade-in-up 0.7s ease 0.1s both" }}
        >
          Study smarter.{" "}
          <span className="gradient-brand">Remember forever.</span>
        </h1>

        {/* Subhead */}
        <p
          className="relative z-10 text-muted-foreground text-lg md:text-xl max-w-xl leading-relaxed"
          style={{ animation: "fade-in-up 0.7s ease 0.2s both" }}
        >
          Upload your slides or notes and FlowCard instantly generates flashcards
          with image occlusion and spaced repetition — so you retain everything, effortlessly.
        </p>

        {/* CTAs */}
        <div
          className="relative z-10 flex gap-3 flex-wrap justify-center"
          style={{ animation: "fade-in-up 0.7s ease 0.3s both" }}
        >
          <a
            href="#pricing"
            className="flex items-center gap-2 px-7 py-3.5 rounded-xl gradient-btn text-sm font-bold shadow-xl shadow-indigo-500/20 hover:scale-105 active:scale-95 transition-transform"
          >
            See plans
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
          </a>
          <Link
            href="/login"
            className="flex items-center gap-2 px-7 py-3.5 rounded-xl border border-border text-sm font-semibold hover:bg-muted transition-colors"
          >
            Log in
          </Link>
        </div>

        <p
          className="relative z-10 text-xs text-muted-foreground/60"
          style={{ animation: "fade-in-up 0.7s ease 0.4s both" }}
        >
          Cancel anytime · Instant access · No hidden fees
        </p>

        {/* Floating flashcard mockup */}
        <div
          className="relative z-10 mt-6 w-full max-w-lg"
          style={{ animation: "fade-in-up 0.9s ease 0.5s both" }}
        >
          <div className="glass border border-white/8 rounded-2xl p-6 shadow-2xl shadow-black/30 text-left">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-2 h-2 rounded-full bg-red-400/60" />
              <div className="w-2 h-2 rounded-full bg-yellow-400/60" />
              <div className="w-2 h-2 rounded-full bg-green-400/60" />
              <span className="ml-2 text-xs text-muted-foreground/50 font-mono">FlowCard · Study Mode</span>
            </div>
            <div className="text-xs font-bold uppercase tracking-widest text-indigo-300 mb-2">Question</div>
            <p className="text-base font-medium leading-snug mb-5">What does the <span className="bg-indigo-500/30 text-indigo-200 px-1.5 py-0.5 rounded font-mono text-sm">@Override</span> annotation do in Java?</p>
            <div className="h-px bg-border/60 mb-4" />
            <div className="text-xs font-bold uppercase tracking-widest text-emerald-400 mb-2">Answer</div>
            <p className="text-sm text-muted-foreground leading-relaxed">It signals to the compiler that the method is intended to override a method in a superclass, triggering an error if no such method exists.</p>
            <div className="mt-5 flex gap-2">
              {["Again", "Hard", "Good", "Easy"].map((label, i) => (
                <div
                  key={label}
                  className={`flex-1 text-center text-xs font-semibold py-2 rounded-lg border ${
                    ["bg-red-500/10 border-red-500/20 text-red-400",
                     "bg-orange-500/10 border-orange-500/20 text-orange-400",
                     "bg-blue-500/10 border-blue-500/20 text-blue-400",
                     "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"][i]
                  }`}
                >
                  {label}
                </div>
              ))}
            </div>
          </div>
          {/* Floating badge */}
          <div className="absolute -top-4 -right-4 bg-emerald-500/15 border border-emerald-500/30 rounded-xl px-3 py-2 text-xs font-semibold text-emerald-400 shadow-lg"
            style={{ animation: "float-badge 3s ease-in-out infinite" }}
          >
            ✓ Card saved
          </div>
          <div className="absolute -bottom-4 -left-4 bg-indigo-500/15 border border-indigo-500/30 rounded-xl px-3 py-2 text-xs font-semibold text-indigo-300 shadow-lg"
            style={{ animation: "float-badge 3s ease-in-out infinite 1.5s" }}
          >
            ⚡ Generated in 4s
          </div>
        </div>
      </section>

      {/* ── Stats bar ───────────────────────────────────────────────────── */}
      <section className="border-y border-border/60 py-10 px-4 bg-card/30">
        <div className="max-w-4xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {[
            { value: 10, suffix: "s", label: "Avg. generation time" },
            { value: 30, suffix: "s", label: "First deck ready in" },
            { value: 50, suffix: "MB", label: "Max file size" },
            { value: 30, suffix: " days", label: "Trash recovery window" },
          ].map((stat) => (
            <Reveal key={stat.label} className="flex flex-col gap-1">
              <span className="text-3xl font-extrabold gradient-brand">
                <Counter to={stat.value} suffix={stat.suffix} />
              </span>
              <span className="text-xs text-muted-foreground font-medium uppercase tracking-widest">{stat.label}</span>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── How it works ────────────────────────────────────────────────── */}
      <section className="py-28 px-4">
        <div className="max-w-5xl mx-auto flex flex-col gap-16">
          <Reveal className="text-center flex flex-col gap-3">
            <p className="text-xs font-bold uppercase tracking-widest text-indigo-300">How it works</p>
            <h2 className="text-4xl font-extrabold tracking-tight">From upload to ready in 3 steps</h2>
            <p className="text-muted-foreground max-w-lg mx-auto">No setup. No manual card creation. Just upload and start studying.</p>
          </Reveal>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {STEPS.map((step, i) => (
              <Reveal key={step.title} delay={i * 120}>
                <div className="group glass border border-border rounded-2xl p-7 flex flex-col gap-4 hover:border-indigo-400/25 hover:bg-indigo-400/3 transition-all h-full">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-400/20 to-violet-400/20 border border-indigo-400/20 flex items-center justify-center text-xl">
                      {step.icon}
                    </div>
                    <span className="text-xs font-bold text-indigo-300 uppercase tracking-widest">Step {i + 1}</span>
                  </div>
                  <h3 className="font-bold text-lg">{step.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{step.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ────────────────────────────────────────────────────── */}
      <section className="py-28 px-4 bg-card/20 border-y border-border/40">
        <div className="max-w-6xl mx-auto flex flex-col gap-16">
          <Reveal className="text-center flex flex-col gap-3">
            <p className="text-xs font-bold uppercase tracking-widest text-violet-300">Features</p>
            <h2 className="text-4xl font-extrabold tracking-tight">Everything you need to ace any exam</h2>
            <p className="text-muted-foreground max-w-lg mx-auto">Built for students who want to learn faster and remember longer.</p>
          </Reveal>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((f, i) => (
              <Reveal key={f.title} delay={i * 80}>
                <div className={`group glass border ${f.border} rounded-2xl p-6 flex flex-col gap-4 hover:-translate-y-1 hover:shadow-xl transition-all h-full`}>
                  <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${f.accent} border ${f.border} flex items-center justify-center text-2xl`}>
                    {f.icon}
                  </div>
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">{f.label}</span>
                    <h3 className="font-bold text-base mt-0.5">{f.title}</h3>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Testimonials ────────────────────────────────────────────────── */}
      <section className="py-28 px-4">
        <div className="max-w-5xl mx-auto flex flex-col gap-16">
          <Reveal className="text-center flex flex-col gap-3">
            <p className="text-xs font-bold uppercase tracking-widest text-emerald-300">Testimonials</p>
            <h2 className="text-4xl font-extrabold tracking-tight">Students love it</h2>
            <p className="text-muted-foreground max-w-lg mx-auto">Real students. Real results.</p>
          </Reveal>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {TESTIMONIALS.map((t, i) => (
              <Reveal key={t.name} delay={i * 100}>
                <div className="glass border border-border rounded-2xl p-6 flex flex-col gap-5 h-full hover:border-white/10 transition-all">
                  <div className="flex gap-1">
                    {[...Array(5)].map((_, s) => (
                      <svg key={s} className="w-4 h-4 text-amber-400" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                    ))}
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed flex-1">&ldquo;{t.quote}&rdquo;</p>
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-full ${t.color} flex items-center justify-center text-sm font-bold`}>
                      {t.avatar}
                    </div>
                    <div>
                      <p className="text-sm font-semibold">{t.name}</p>
                      <p className="text-xs text-muted-foreground">{t.role}</p>
                    </div>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ─────────────────────────────────────────────────────── */}
      <section id="pricing" className="py-28 px-4 bg-card/20 border-y border-border/40">
        <div className="max-w-3xl mx-auto flex flex-col gap-14">
          <Reveal className="text-center flex flex-col gap-3">
            <p className="text-xs font-bold uppercase tracking-widest text-indigo-300">Pricing</p>
            <h2 className="text-4xl font-extrabold tracking-tight">Simple, transparent pricing</h2>
            <p className="text-muted-foreground max-w-md mx-auto">Full access to every feature. Pick the plan that works for you.</p>
          </Reveal>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
            {/* Monthly — highlighted */}
            <Reveal delay={0}>
              <div className="relative glass border-2 border-indigo-400/40 rounded-2xl p-7 flex flex-col gap-5 shadow-xl shadow-indigo-500/10">
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gradient-to-r from-indigo-400 to-violet-500 text-white text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full">
                  Most popular
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-indigo-300">Monthly</p>
                  <div className="flex items-end gap-1 mt-2">
                    <span className="text-4xl font-extrabold">$4.99</span>
                    <span className="text-muted-foreground text-sm mb-1">/mo</span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">Billed monthly. Cancel anytime.</p>
                </div>
                <ul className="flex flex-col gap-2.5 text-sm">
                  {["Unlimited decks & cards", "AI flashcard generation", "Image occlusion AI", "Spaced repetition (SM-2)", "Anki export (.apkg)", "Priority support"].map((f) => (
                    <li key={f} className="flex items-center gap-2.5">
                      <svg className="w-4 h-4 text-indigo-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                      {f}
                    </li>
                  ))}
                </ul>
                <PricingButton plan="monthly" label="Get started — $4.99/mo" />
              </div>
            </Reveal>

            {/* 6-month */}
            <Reveal delay={100}>
              <div className="relative glass border border-emerald-400/30 rounded-2xl p-7 flex flex-col gap-5">
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-emerald-400/15 border border-emerald-400/30 text-emerald-300 text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full">
                  Best value
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-emerald-300">6 Months</p>
                  <div className="flex items-end gap-1 mt-2">
                    <span className="text-4xl font-extrabold">$19.99</span>
                    <span className="text-muted-foreground text-sm mb-1">/6 mo</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-sm text-muted-foreground">~$3.33/mo</p>
                    <span className="text-[10px] font-bold bg-emerald-400/15 text-emerald-400 border border-emerald-400/25 px-2 py-0.5 rounded-full">Save 33%</span>
                  </div>
                </div>
                <ul className="flex flex-col gap-2.5 text-sm">
                  {["Everything in Monthly", "6 months for the price of 4", "Unlimited decks & cards", "All AI features", "Anki export (.apkg)", "Priority support"].map((f) => (
                    <li key={f} className="flex items-center gap-2.5">
                      <svg className="w-4 h-4 text-emerald-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                      {f}
                    </li>
                  ))}
                </ul>
                <PricingButton plan="biannual" label="Save 33% — 6 Months" className="border-emerald-400/30 bg-emerald-400/8 text-emerald-300 hover:bg-emerald-400/15" />
              </div>
            </Reveal>
          </div>

          <Reveal className="text-center">
            <p className="text-xs text-muted-foreground/60">Secure checkout via Stripe · Cancel anytime from your account settings</p>
          </Reveal>
        </div>
      </section>

      {/* ── Contact ──────────────────────────────────────────────────────── */}
      <section id="contact" className="py-28 px-4">
        <div className="max-w-2xl mx-auto flex flex-col gap-14">
          <Reveal className="text-center flex flex-col gap-3">
            <p className="text-xs font-bold uppercase tracking-widest text-violet-300">Contact</p>
            <h2 className="text-4xl font-extrabold tracking-tight">Get in touch</h2>
            <p className="text-muted-foreground max-w-md mx-auto">Have a question, feedback, or a bug to report? We read every message and usually reply within 24 hours.</p>
          </Reveal>
          <Reveal>
            <ContactForm />
          </Reveal>
        </div>
      </section>

      {/* ── CTA ─────────────────────────────────────────────────────────── */}
      <section className="py-28 px-4 relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at center, rgba(99,102,180,0.12) 0%, transparent 65%)" }} />
        </div>
        <Reveal className="relative z-10 max-w-2xl mx-auto flex flex-col items-center gap-7 text-center">
          <div className="inline-flex items-center gap-2 border border-indigo-400/25 bg-indigo-400/8 rounded-full px-4 py-1.5 text-xs font-medium text-indigo-300">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
            AI-powered · Spaced Repetition · Anki Export
          </div>
          <h2 className="text-4xl sm:text-5xl font-extrabold tracking-tight leading-tight">
            Stop making flashcards.<br />
            <span className="gradient-brand">Start remembering.</span>
          </h2>
          <p className="text-muted-foreground text-lg max-w-md">
            Pick a plan and generate your first AI flashcard deck in under 30 seconds.
          </p>
          <a
            href="#pricing"
            className="flex items-center gap-2 px-8 py-4 rounded-xl gradient-btn text-base font-bold shadow-xl shadow-indigo-500/20 hover:scale-105 active:scale-95 transition-transform"
          >
            View plans
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
          </a>
          <p className="text-xs text-muted-foreground/60">Cancel anytime · Instant access · Secure checkout</p>
        </Reveal>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="border-t border-border/40 px-8 py-8">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-indigo-400 to-violet-500 flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18" />
              </svg>
            </div>
            <span className="text-sm font-bold gradient-brand">FlowCard</span>
          </div>
          <p className="text-xs text-muted-foreground/60">© 2026 FlowCard. All rights reserved.</p>
          <div className="flex gap-5 text-xs text-muted-foreground">
            <a href="#pricing" className="hover:text-foreground transition-colors">Pricing</a>
            <a href="#contact" className="hover:text-foreground transition-colors">Contact</a>
            <Link href="/login" className="hover:text-foreground transition-colors">Log in</Link>
          </div>
        </div>
      </footer>

      {/* ── Keyframes ───────────────────────────────────────────────────── */}
      <style>{`
        @keyframes fade-in-up {
          from { opacity: 0; transform: translateY(24px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes fade-in-down {
          from { opacity: 0; transform: translateY(-12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse-slow {
          0%, 100% { opacity: 0.8; transform: translateX(-50%) scale(1); }
          50%       { opacity: 1;   transform: translateX(-50%) scale(1.08); }
        }
        @keyframes float-slow {
          0%, 100% { transform: translateY(0px); }
          50%       { transform: translateY(-30px); }
        }
        @keyframes float-badge {
          0%, 100% { transform: translateY(0px); }
          50%       { transform: translateY(-6px); }
        }
      `}</style>
    </main>
  );
}
