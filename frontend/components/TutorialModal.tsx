"use client";

import { useEffect, useState } from "react";

interface Step {
  icon: string;
  label: string;
  title: string;
  desc: string;
  tip?: string;
  color: string;
  bg: string;
  border: string;
  demo: React.ReactNode;
}

const STEPS: Step[] = [
  {
    icon: "👋",
    label: "Welcome",
    title: "Welcome to FlowCard",
    desc: "FlowCard turns your notes and slides into flashcards automatically — then schedules reviews so you remember everything long-term. This quick tour covers everything in under 2 minutes.",
    color: "text-indigo-300",
    bg: "bg-indigo-400/10",
    border: "border-indigo-400/20",
    demo: (
      <div className="flex flex-col items-center gap-4 py-2">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-400 to-violet-500 flex items-center justify-center shadow-xl shadow-indigo-500/20">
          <svg className="w-8 h-8 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18" />
          </svg>
        </div>
        <div className="flex gap-2 flex-wrap justify-center">
          {["AI Flashcards", "Image Occlusion", "Spaced Repetition", "Anki Export"].map((f) => (
            <span key={f} className="text-xs px-3 py-1 rounded-full bg-indigo-400/10 border border-indigo-400/20 text-indigo-300 font-medium">{f}</span>
          ))}
        </div>
      </div>
    ),
  },
  {
    icon: "⚡",
    label: "AI Flashcards",
    title: "Generate cards from anything",
    desc: "Paste your notes or upload an image of your textbook. The AI reads it and creates a full Q&A deck in seconds. No typing, no formatting — just instant knowledge.",
    tip: 'Hit "New Deck" → "Generate from text or image" to try it.',
    color: "text-violet-300",
    bg: "bg-violet-400/10",
    border: "border-violet-400/20",
    demo: (
      <div className="w-full rounded-xl border border-border bg-card/50 p-4 flex flex-col gap-3 text-left">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Preview — generated card</div>
        <div className="flex flex-col gap-1.5">
          <div className="text-[10px] font-bold text-violet-300 uppercase tracking-widest">Question</div>
          <p className="text-sm font-medium">What is the difference between TCP and UDP?</p>
        </div>
        <div className="h-px bg-border/60" />
        <div className="flex flex-col gap-1.5">
          <div className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">Answer</div>
          <p className="text-xs text-muted-foreground leading-relaxed">TCP is connection-oriented with guaranteed delivery. UDP is connectionless and faster but without delivery guarantees.</p>
        </div>
      </div>
    ),
  },
  {
    icon: "🖼️",
    label: "Image Occlusion",
    title: "Hide & reveal key terms",
    desc: "Upload lecture slides and the AI automatically places boxes over every important term. During study, you reveal them one by one — the same method used by top medical students.",
    tip: 'Hit "New Deck" → "Image Occlusion" to upload a PDF or image.',
    color: "text-blue-300",
    bg: "bg-blue-400/10",
    border: "border-blue-400/20",
    demo: (
      <div className="w-full rounded-xl border border-blue-400/20 bg-blue-400/5 p-4 flex flex-col gap-3">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Occlusion preview</div>
        <div className="relative rounded-lg bg-muted/40 border border-border p-3 font-mono text-xs leading-loose">
          <span className="text-muted-foreground">public </span>
          <span className="inline-block w-20 h-5 bg-indigo-500/80 rounded align-middle" />
          <span className="text-muted-foreground"> implements </span>
          <span className="inline-block w-16 h-5 bg-indigo-500/50 rounded align-middle" />
          <br />
          <span className="text-muted-foreground">  void </span>
          <span className="inline-block w-14 h-5 bg-indigo-500/50 rounded align-middle" />
          <span className="text-muted-foreground">() {"{"} ... {"}"}</span>
        </div>
        <p className="text-xs text-muted-foreground">Boxes hide key terms — space bar reveals them one by one.</p>
      </div>
    ),
  },
  {
    icon: "🧠",
    label: "Spaced Repetition",
    title: "Study smarter, not longer",
    desc: "After answering a card, rate it: Again, Hard, Good, or Easy. The SM-2 algorithm schedules the next review at exactly the right time — before you forget it.",
    tip: "Use keyboard shortcuts: Space to flip, ← → to navigate, 1–4 to rate.",
    color: "text-emerald-300",
    bg: "bg-emerald-400/10",
    border: "border-emerald-400/20",
    demo: (
      <div className="w-full flex flex-col gap-3">
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: "Again", sub: "< 1 min", cls: "bg-red-500/10 border-red-500/20 text-red-400" },
            { label: "Hard",  sub: "1 day",   cls: "bg-orange-500/10 border-orange-500/20 text-orange-400" },
            { label: "Good",  sub: "3 days",  cls: "bg-blue-500/10 border-blue-500/20 text-blue-400" },
            { label: "Easy",  sub: "7 days",  cls: "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" },
          ].map((r) => (
            <div key={r.label} className={`flex flex-col items-center gap-1 py-2.5 rounded-xl border text-xs font-semibold ${r.cls}`}>
              {r.label}
              <span className="text-[10px] opacity-70 font-normal">{r.sub}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground text-center">Next review is automatically scheduled based on your rating.</p>
      </div>
    ),
  },
  {
    icon: "🗂️",
    label: "Folders & Decks",
    title: "Keep everything organised",
    desc: "Group decks into folders — one per subject, course, or exam. Move decks between folders any time. Rename, delete, or restore anything from the trash within 30 days.",
    tip: 'Click "New Folder" in the top bar, then drag or move decks into it.',
    color: "text-amber-300",
    bg: "bg-amber-400/10",
    border: "border-amber-400/20",
    demo: (
      <div className="w-full flex flex-col gap-2 text-sm">
        {[
          { name: "Computer Science", decks: 4, color: "text-indigo-300" },
          { name: "Data Structures", decks: 2, color: "text-violet-300" },
          { name: "Operating Systems", decks: 3, color: "text-amber-300" },
        ].map((folder) => (
          <div key={folder.name} className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border bg-card/40">
            <svg className={`w-4 h-4 ${folder.color}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
            <span className="font-medium text-sm flex-1">{folder.name}</span>
            <span className="text-xs text-muted-foreground">{folder.decks} decks</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    icon: "🗑️",
    label: "Trash",
    title: "Nothing is gone for good",
    desc: "Deleted decks, folders, and cards go to the trash — not the void. You have 30 days to restore anything. After that, it's permanently removed.",
    tip: 'Click the trash icon in the top bar to view and restore deleted items.',
    color: "text-rose-300",
    bg: "bg-rose-400/10",
    border: "border-rose-400/20",
    demo: (
      <div className="w-full flex flex-col gap-2">
        {[
          { name: "Algorithms Deck", type: "Deck", days: 2, color: "text-red-400 bg-red-500/10 border-red-500/20" },
          { name: "Old Notes", type: "Deck", days: 12, color: "text-orange-400 bg-orange-500/10 border-orange-500/20" },
          { name: "Spring 2024", type: "Folder", days: 25, color: "text-muted-foreground bg-muted/40 border-border" },
        ].map((item) => (
          <div key={item.name} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-border bg-card/40 text-sm">
            <span className="flex-1 font-medium">{item.name}</span>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${item.color}`}>{item.days}d left</span>
            <span className="text-xs text-indigo-300 font-medium cursor-pointer hover:underline">Restore</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    icon: "📦",
    label: "Anki Export",
    title: "Take your cards anywhere",
    desc: "Export any deck as a .apkg file and import it straight into Anki desktop. Your work, your format — no lock-in.",
    tip: 'Click the download icon on any deck card to export it.',
    color: "text-cyan-300",
    bg: "bg-cyan-400/10",
    border: "border-cyan-400/20",
    demo: (
      <div className="w-full flex flex-col items-center gap-4 py-2">
        <div className="flex items-center gap-4">
          <div className="flex flex-col items-center gap-1.5">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-400/20 to-violet-400/20 border border-indigo-400/20 flex items-center justify-center">
              <span className="text-xl">🗃️</span>
            </div>
            <span className="text-xs text-muted-foreground">FlowCard</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <svg className="w-8 h-4 text-muted-foreground/40" viewBox="0 0 32 16" fill="none">
              <path d="M2 8h28M22 2l8 6-8 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span className="text-[10px] text-muted-foreground/50">.apkg</span>
          </div>
          <div className="flex flex-col items-center gap-1.5">
            <div className="w-12 h-12 rounded-xl bg-blue-400/10 border border-blue-400/20 flex items-center justify-center">
              <span className="text-xl">🎴</span>
            </div>
            <span className="text-xs text-muted-foreground">Anki</span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground text-center">One click to export · Works with Anki desktop &amp; mobile</p>
      </div>
    ),
  },
  {
    icon: "🎉",
    label: "You're ready!",
    title: "You're all set!",
    desc: "That's everything FlowCard has to offer. Start by creating your first deck — upload your notes or slides and let the AI do the work.",
    color: "text-emerald-300",
    bg: "bg-emerald-400/10",
    border: "border-emerald-400/20",
    demo: (
      <div className="flex flex-col items-center gap-4 py-2">
        <div className="text-5xl" style={{ animation: "bounce-slow 1.5s ease-in-out infinite" }}>🎓</div>
        <div className="flex flex-col gap-2 w-full">
          {[
            "Upload notes or slides",
            "AI generates your flashcards",
            "Study with spaced repetition",
            "Ace your exams",
          ].map((step, i) => (
            <div key={step} className="flex items-center gap-3 text-sm">
              <div className="w-5 h-5 rounded-full bg-emerald-400/15 border border-emerald-400/25 flex items-center justify-center text-[10px] font-bold text-emerald-400 shrink-0">{i + 1}</div>
              <span className="text-muted-foreground">{step}</span>
            </div>
          ))}
        </div>
      </div>
    ),
  },
];

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function TutorialModal({ isOpen, onClose }: Props) {
  const [step, setStep] = useState(0);
  const [animDir, setAnimDir] = useState<"forward" | "back">("forward");
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isOpen) { setStep(0); setTimeout(() => setVisible(true), 10); }
    else setVisible(false);
  }, [isOpen]);

  if (!isOpen) return null;

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const progress = ((step + 1) / STEPS.length) * 100;

  function goTo(next: number) {
    setAnimDir(next > step ? "forward" : "back");
    setStep(next);
  }

  function finish() {
    localStorage.setItem("flowcard_tutorial_done", "1");
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{
        background: "rgba(0,0,0,0.7)",
        backdropFilter: "blur(6px)",
        opacity: visible ? 1 : 0,
        transition: "opacity 0.25s ease",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) finish(); }}
    >
      <div
        className="w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{
          transform: visible ? "scale(1) translateY(0)" : "scale(0.95) translateY(16px)",
          transition: "transform 0.3s ease",
        }}
      >
        {/* Progress bar */}
        <div className="h-1 bg-muted w-full">
          <div
            className="h-full bg-gradient-to-r from-indigo-400/80 to-violet-400/80 transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-1">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-bold uppercase tracking-widest ${current.color}`}>
              {step + 1} / {STEPS.length}
            </span>
          </div>
          <button
            onClick={finish}
            className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-lg hover:bg-muted"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* Step content */}
        <div className="px-6 py-4 flex flex-col gap-5">
          {/* Title area */}
          <div className="flex items-start gap-4">
            <div className={`w-12 h-12 rounded-xl ${current.bg} border ${current.border} flex items-center justify-center text-2xl shrink-0`}>
              {current.icon}
            </div>
            <div className="flex flex-col gap-1">
              <span className={`text-[10px] font-bold uppercase tracking-widest ${current.color}`}>{current.label}</span>
              <h2 className="text-lg font-bold leading-snug">{current.title}</h2>
            </div>
          </div>

          <p className="text-sm text-muted-foreground leading-relaxed">{current.desc}</p>

          {/* Demo area */}
          <div className={`rounded-xl border ${current.border} ${current.bg} p-4`}>
            {current.demo}
          </div>

          {/* Tip */}
          {current.tip && (
            <div className="flex items-start gap-2.5 bg-muted/40 border border-border rounded-xl px-4 py-3">
              <span className="text-base shrink-0">💡</span>
              <p className="text-xs text-muted-foreground leading-relaxed">{current.tip}</p>
            </div>
          )}
        </div>

        {/* Step dots */}
        <div className="flex items-center justify-center gap-1.5 pb-2">
          {STEPS.map((_, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              className="transition-all duration-200"
              style={{
                width: i === step ? 20 : 6,
                height: 6,
                borderRadius: 9999,
                background: i === step ? "#818cf8" : "rgba(255,255,255,0.15)",
              }}
            />
          ))}
        </div>

        {/* Footer buttons */}
        <div className="flex items-center justify-between px-6 pb-5 pt-1 gap-3">
          <button
            onClick={() => step > 0 ? goTo(step - 1) : finish()}
            className="px-4 py-2 rounded-xl border border-border text-sm font-medium hover:bg-muted transition-colors"
          >
            {step === 0 ? "Skip tour" : "← Back"}
          </button>

          <button
            onClick={() => isLast ? finish() : goTo(step + 1)}
            className="px-5 py-2 rounded-xl gradient-btn text-sm font-semibold flex items-center gap-1.5"
          >
            {isLast ? "Let's go! 🚀" : "Next →"}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes bounce-slow {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }
      `}</style>
    </div>
  );
}
