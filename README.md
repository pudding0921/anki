# AnkiAI

AI-powered flashcard generator. Upload lecture slides (PDF or image) and the AI automatically creates Anki-ready occlusion and Q&A flashcards.

---

## Repository structure

```
ankiai/
├── backend/          ← FastAPI + Python (AI pipeline, database, API)
├── frontend/         ← Next.js 16 (UI, pages, components)
├── docker-compose.yml
├── render.yaml       ← Render.com deploy config (backend)
└── README.md
```

---

## Frontend (`frontend/`)

**Stack:** Next.js 16 (App Router), TypeScript, Tailwind CSS, shadcn/ui v4

### Pages
| Route | File | Description |
|---|---|---|
| `/` | `app/page.tsx` | Landing page |
| `/login` | `app/login/page.tsx` | Login |
| `/register` | `app/register/page.tsx` | Register |
| `/dashboard` | `app/dashboard/page.tsx` | Deck list, export, delete |
| `/create` | `app/create/page.tsx` | AI flashcard creation (text + occlusion tabs) |
| `/create/occlusion` | `app/create/occlusion/page.tsx` | Image occlusion upload flow |
| `/study` | `app/study/page.tsx` | Spaced repetition study session |
| `/edit` | `app/edit/page.tsx` | Edit / delete cards and occlusion zones |

### Key files
| File | Purpose |
|---|---|
| `lib/api.ts` | `apiFetch()` wrapper — adds auth token, handles 401 redirect |
| `lib/useAuthGuard.ts` | Hook — redirects to `/login` if no token |
| `components/OcclusionEditor.tsx` | Canvas-based zone drawing tool |
| `components/ui/button.tsx` | shadcn Button (client component) |
| `components/ui/button-variants.ts` | CVA variants — safe to import in server components |
| `next.config.ts` | Static export config (`output: 'export'`) |

### Setup
```bash
cd frontend
npm install
npm run dev        # http://localhost:3000
```

Create `frontend/.env.local`:
```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

---

## Backend (`backend/`)

**Stack:** FastAPI, SQLAlchemy, SQLite, Python 3.9+

### API routes
| Method | Route | Description |
|---|---|---|
| GET | `/api/health` | Health check |
| POST | `/api/auth/register` | Register user |
| POST | `/api/auth/login` | Login → JWT token |
| GET | `/api/auth/me` | Current user |
| GET/POST | `/api/decks` | List / create decks |
| GET/DELETE | `/api/decks/{id}` | Get / delete deck |
| GET | `/api/decks/{id}/export` | Download `.apkg` Anki file |
| POST | `/api/cards/generate` | OCR + AI → text flashcards |
| POST | `/api/cards/upload-pages` | Render PDF pages to images |
| POST | `/api/cards/batch-occlusion` | AI occlusion cards from slides |
| PUT | `/api/cards/{id}` | Update card front/back |
| DELETE | `/api/cards/{id}` | Delete card |
| DELETE | `/api/cards/zones/{id}` | Delete occlusion zone |
| GET | `/api/study/due/{deck_id}` | Cards due today (SM-2) |
| POST | `/api/study/review` | Submit review rating |

### Setup
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # then fill in your keys
uvicorn app.main:app --reload --port 8000
```

### Environment variables (`backend/.env`)
```
SECRET_KEY=your-secret-key
GEMINI_API_KEY=        # Gemini 1.5 Flash — best quality vision
GROQ_API_KEY=          # Groq free tier fallback (https://console.groq.com)
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2
```

### Key service files
| File | Purpose |
|---|---|
| `app/services/ai_occlusion.py` | Zone detection — Gemini → Groq → Tesseract fallback |
| `app/services/llm.py` | Text flashcard generation — Ollama → Groq |
| `app/services/anki_export.py` | Export decks to `.apkg` (genanki) |
| `app/services/sm2.py` | SM-2 spaced repetition algorithm |

---

## Notes for frontend development

- The backend must be running locally on port 8000 for API calls to work
- Auth is JWT — token stored in `localStorage` as `"token"`
- `apiFetch()` in `lib/api.ts` automatically attaches the token; use it instead of raw `fetch`
- shadcn/ui v4 uses `@base-ui/react` — there is **no `asChild` prop**
- For links styled as buttons, import `buttonVariants` from `components/ui/button-variants.ts` (server-safe) and apply to a `<Link>`
