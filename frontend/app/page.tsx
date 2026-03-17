import Link from "next/link";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";

const HOW_IT_WORKS = [
  {
    step: "1",
    title: "Upload your material",
    desc: "Take a photo of your notes, textbook page, or any study material and upload it.",
  },
  {
    step: "2",
    title: "AI generates your cards",
    desc: "Our AI reads the content and creates accurate Q&A flashcards automatically.",
  },
  {
    step: "3",
    title: "Study & retain",
    desc: "Study with spaced repetition. The SM-2 algorithm schedules reviews at the optimal time.",
  },
];

const FEATURES = [
  {
    title: "AI Flashcard Generation",
    desc: "Drop in a photo of your notes. Get a full deck of Q&A cards in seconds.",
  },
  {
    title: "Image Occlusion",
    desc: "Draw rectangles over diagrams to hide key regions. Perfect for anatomy and maps.",
  },
  {
    title: "Spaced Repetition (SM-2)",
    desc: "Rate cards as Again / Hard / Good / Easy. The algorithm schedules the next review for you.",
  },
  {
    title: "Export to Anki",
    desc: "Download your deck as a .apkg file and import directly into Anki desktop.",
  },
  {
    title: "Completely Free",
    desc: "No subscriptions. Runs on open-source AI (Ollama) with a free cloud fallback.",
  },
  {
    title: "Your data, your decks",
    desc: "All cards are private to your account. Delete or export at any time.",
  },
];

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-background flex flex-col">
      {/* Nav */}
      <nav className="flex items-center justify-between px-8 py-5 border-b">
        <span className="text-xl font-bold tracking-tight">AnkiAI</span>
        <div className="flex gap-3">
          <Link href="/login" className={buttonVariants({ variant: "ghost" })}>
            Log in
          </Link>
          <Link href="/register" className={buttonVariants({})}>
            Get started free
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="flex flex-col items-center justify-center text-center px-4 py-28 gap-6">
        <div className="inline-flex items-center gap-2 border rounded-full px-4 py-1.5 text-xs text-muted-foreground mb-2">
          100% free — powered by open-source AI
        </div>
        <h1 className="text-5xl font-extrabold tracking-tight max-w-2xl leading-tight">
          Turn any image into{" "}
          <span className="text-primary">flashcards instantly.</span>
        </h1>
        <p className="text-muted-foreground text-lg max-w-xl">
          Upload a photo of your notes or textbook. AnkiAI generates Q&A cards and
          image occlusions automatically — then schedules your reviews with spaced
          repetition.
        </p>
        <div className="flex gap-3 flex-wrap justify-center">
          <Link href="/register" className={cn(buttonVariants({ size: "lg" }))}>
            Get started — it&apos;s free
          </Link>
          <Link
            href="/login"
            className={cn(buttonVariants({ size: "lg", variant: "outline" }))}
          >
            Log in
          </Link>
        </div>
      </section>

      {/* How it works */}
      <section className="bg-muted/40 py-20 px-4">
        <div className="max-w-4xl mx-auto flex flex-col gap-12">
          <h2 className="text-3xl font-bold text-center">How it works</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {HOW_IT_WORKS.map((item) => (
              <div key={item.step} className="flex flex-col gap-3">
                <div className="w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm">
                  {item.step}
                </div>
                <h3 className="font-semibold text-lg">{item.title}</h3>
                <p className="text-muted-foreground text-sm">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features grid */}
      <section className="py-20 px-4">
        <div className="max-w-5xl mx-auto flex flex-col gap-12">
          <h2 className="text-3xl font-bold text-center">Everything you need</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {FEATURES.map((f) => (
              <div key={f.title} className="border rounded-xl p-6 flex flex-col gap-2">
                <h3 className="font-semibold">{f.title}</h3>
                <p className="text-muted-foreground text-sm">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t py-20 px-4 flex flex-col items-center gap-6 text-center">
        <h2 className="text-3xl font-bold">Ready to study smarter?</h2>
        <p className="text-muted-foreground max-w-md">
          Create an account in seconds. No credit card required.
        </p>
        <Link href="/register" className={cn(buttonVariants({ size: "lg" }))}>
          Create free account
        </Link>
      </section>

      {/* Footer */}
      <footer className="border-t px-8 py-6 text-xs text-muted-foreground flex items-center justify-between">
        <span>AnkiAI</span>
        <span>Built with open-source AI — zero cost to you.</span>
      </footer>
    </main>
  );
}
