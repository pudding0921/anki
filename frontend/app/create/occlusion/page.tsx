"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { API_URL } from "@/lib/api";
import { useAuthGuard } from "@/lib/useAuthGuard";

interface PageInfo {
  image_path: string;
  width: number;
  height: number;
  page: number;
}

interface PageResult {
  page: number;
  status: "created" | "skipped" | "error";
  zones?: number;
  reason?: string;
}

type Step = "upload" | "uploading" | "processing" | "done";

export default function OcclusionPage() {
  useAuthGuard();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const checklistRef = useRef<HTMLInputElement>(null);
  const [deckName, setDeckName] = useState("");
  const [checklistFile, setChecklistFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [step, setStep] = useState<Step>("upload");
  const [error, setError] = useState("");
  const [pageCount, setPageCount] = useState(0);
  const [results, setResults] = useState<{ created: number; skipped: number; results: PageResult[] }>({
    created: 0,
    skipped: 0,
    results: [],
  });

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(true);
  }
  function onDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false);
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) run(file);
  }

  async function run(file: File) {
    setError("");
    setStep("uploading");

    const token = localStorage.getItem("token");
    const authHeader: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

    try {
      // Step 1: Render PDF pages (or save image)
      const uploadForm = new FormData();
      uploadForm.append("file", file);
      const uploadRes = await fetch(`${API_URL}/api/cards/upload-pages`, {
        method: "POST",
        headers: authHeader,
        body: uploadForm,
      });
      if (!uploadRes.ok) {
        const d = await uploadRes.json().catch(() => ({}));
        throw new Error(d.detail || "Upload failed");
      }
      const { pages }: { pages: PageInfo[] } = await uploadRes.json();
      setPageCount(pages.length);

      // Step 2: AI creates cards for every page automatically
      setStep("processing");
      const batchForm = new FormData();
      batchForm.append("deck_name", deckName.trim() || file.name.replace(/\.[^.]+$/, "") || "Untitled deck");
      batchForm.append("pages_json", JSON.stringify(pages));
      if (checklistFile) batchForm.append("checklist_file", checklistFile);

      const batchRes = await fetch(`${API_URL}/api/cards/batch-occlusion`, {
        method: "POST",
        headers: authHeader,
        body: batchForm,
      });
      if (!batchRes.ok) {
        const d = await batchRes.json().catch(() => ({}));
        throw new Error(d.detail || "AI processing failed");
      }
      const data = await batchRes.json();
      setResults(data);
      setStep("done");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setStep("upload");
    }
  }

  return (
    <main className="min-h-screen bg-background">
      <nav className="flex items-center px-8 py-5 border-b gap-4">
        <button
          className="text-sm text-muted-foreground hover:text-foreground"
          onClick={() => step === "done" ? router.push("/dashboard") : router.push("/create")}
        >
          ← {step === "done" ? "Dashboard" : "Back"}
        </button>
        <span className="text-xl font-bold tracking-tight">Image Occlusion</span>
      </nav>

      <div className="max-w-2xl mx-auto px-8 py-12 flex flex-col gap-8">
        {error && (
          <p className="text-sm text-red-500 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            {error}
          </p>
        )}

        {/* ── Upload ── */}
        {step === "upload" && (
          <>
            <div className="flex flex-col gap-2">
              <label className="font-medium text-sm">Deck name</label>
              <input
                className="border rounded-lg px-4 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="e.g. Anatomy Chapter 4 (optional)"
                value={deckName}
                onChange={(e) => setDeckName(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-3">
              <label className="font-medium text-sm">
                Upload lecture slides{" "}
                <span className="text-muted-foreground font-normal">— PDF or image</span>
              </label>
              <div
                className={`border-2 border-dashed rounded-xl p-16 flex flex-col items-center gap-4 text-center cursor-pointer transition-colors ${
                  isDragging ? "border-primary bg-primary/5" : "hover:border-primary"
                }`}
                onClick={() => fileRef.current?.click()}
                onDragOver={onDragOver}
                onDragEnter={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
              >
                {isDragging ? (
                  <p className="text-primary font-medium">Drop to upload</p>
                ) : (
                  <>
                    <div className="text-4xl">📄</div>
                    <div>
                      <p className="font-medium">Drag & drop your slides here</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        or click to browse
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      PDF · PNG · JPG · WEBP
                    </p>
                  </>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*,.pdf,application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) run(f);
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                The AI will analyze every slide and automatically create occlusion cards — no manual work needed.
              </p>
            </div>

            {/* Optional study checklist */}
            <div className="flex flex-col gap-2">
              <label className="font-medium text-sm">
                Study checklist{" "}
                <span className="text-muted-foreground font-normal">— optional PDF</span>
              </label>
              <p className="text-xs text-muted-foreground">
                Upload your study guide or topic checklist and the AI will focus occlusions on those specific topics.
              </p>
              <div className="flex items-center gap-3">
                <button
                  className="text-sm border rounded-lg px-4 py-2 hover:bg-muted transition-colors"
                  onClick={() => checklistRef.current?.click()}
                >
                  {checklistFile ? checklistFile.name : "Choose checklist PDF"}
                </button>
                {checklistFile && (
                  <button
                    className="text-xs text-red-400 hover:text-red-600"
                    onClick={() => setChecklistFile(null)}
                  >
                    Remove
                  </button>
                )}
              </div>
              <input
                ref={checklistRef}
                type="file"
                accept=".pdf,application/pdf"
                className="hidden"
                onChange={(e) => setChecklistFile(e.target.files?.[0] ?? null)}
              />
            </div>
          </>
        )}

        {/* ── Uploading ── */}
        {step === "uploading" && (
          <div className="flex flex-col items-center gap-6 py-16 text-center">
            <div className="w-12 h-12 rounded-full border-4 border-primary border-t-transparent animate-spin" />
            <div>
              <p className="font-semibold text-lg">Uploading & rendering slides…</p>
              <p className="text-sm text-muted-foreground mt-1">Preparing your file for AI analysis</p>
            </div>
          </div>
        )}

        {/* ── Processing ── */}
        {step === "processing" && (
          <div className="flex flex-col items-center gap-6 py-16 text-center">
            <div className="w-12 h-12 rounded-full border-4 border-primary border-t-transparent animate-spin" />
            <div>
              <p className="font-semibold text-lg">AI is analyzing your slides…</p>
              <p className="text-sm text-muted-foreground mt-1">
                Processing {pageCount} page{pageCount !== 1 ? "s" : ""} — identifying key terms and creating cards
              </p>
              <p className="text-xs text-muted-foreground mt-3">
                This may take {Math.max(10, pageCount * 5)}–{Math.max(20, pageCount * 10)} seconds
              </p>
            </div>
          </div>
        )}

        {/* ── Done ── */}
        {step === "done" && (
          <div className="flex flex-col gap-6">
            <div className="border rounded-xl p-6 flex flex-col gap-2 bg-green-50 border-green-200">
              <p className="font-bold text-xl text-green-800">
                {results.created} card{results.created !== 1 ? "s" : ""} created!
              </p>
              <p className="text-sm text-green-700">
                {results.skipped > 0 && `${results.skipped} slide${results.skipped !== 1 ? "s" : ""} skipped (no readable content).`}
              </p>
            </div>

            {/* Per-page breakdown */}
            <div className="flex flex-col gap-2">
              {results.results.map((r) => (
                <div
                  key={r.page}
                  className={`flex items-center justify-between border rounded-lg px-4 py-2 text-sm ${
                    r.status === "created"
                      ? "border-green-200 bg-green-50"
                      : "border-muted bg-muted/30"
                  }`}
                >
                  <span className="text-muted-foreground">Page {r.page}</span>
                  {r.status === "created" ? (
                    <span className="text-green-700 font-medium">
                      ✓ {r.zones} zone{r.zones !== 1 ? "s" : ""}
                      {(r as any).diagrams > 0 && ` + ${(r as any).diagrams} diagram card${(r as any).diagrams !== 1 ? "s" : ""}`}
                    </span>
                  ) : (
                    <span className="text-muted-foreground text-xs">{r.reason ?? "skipped"}</span>
                  )}
                </div>
              ))}
            </div>

            <div className="flex gap-3">
              <Button onClick={() => router.push("/dashboard")}>
                Go to dashboard
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setStep("upload");
                  setResults({ created: 0, skipped: 0, results: [] });
                  setPageCount(0);
                  setChecklistFile(null);
                }}
              >
                Upload more slides
              </Button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
