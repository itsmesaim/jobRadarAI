# JobRadar AI

An AI-powered job hunting assistant. Upload your CV, set your preferences, hit **Search jobs**, and JobRadar crawls listings, rates each one against your profile (1–10) with strengths/gaps/tailoring tips, learns from the star ratings and notes you leave on its own ratings, and keeps your applications on a Kanban board.

---

## What You Built

**JobRadar AI** is a full-stack web app with two parts:

| Layer | Tech | Role |
|-------|------|------|
| **Backend** | FastAPI, Motor (MongoDB), LangChain, FAISS, PyMuPDF | Auth, CV parsing, job crawling, AI rating + calibration, REST API |
| **Frontend** | React 18, TypeScript, Vite, TanStack Query, Zustand, @dnd-kit | Landing page, dashboard, drag-and-drop Kanban, settings |

The rating engine isn't a one-shot prompt: a cosine-similarity pre-filter skips the LLM entirely for obvious mismatches, FAISS retrieves the most relevant JD chunks instead of truncating long postings, and every rating you correct with a star + note gets pulled back in as calibration context the next time a similar job shows up.

---

## System Architecture

### High-Level Overview

A React SPA talks to a FastAPI backend, which orchestrates MongoDB persistence, two job-board APIs, and a **split LLM provider** setup via LangChain — one model for CV parsing/apply-pack generation, a separate (often cheaper/faster) model for bulk job rating, controlled entirely through `.env`.

```mermaid
flowchart TB
    subgraph Client["Frontend — React SPA (Vite)"]
        Pages["Pages: Landing · Login · Dashboard · Kanban · Settings · Admin"]
        State["Zustand (auth) + TanStack Query (server state)"]
        Fetch["fetch()-based API client + JWT interceptor"]
    end

    subgraph Backend["Backend — FastAPI"]
        Routes["Routes: auth · cv · crawler · jobs · users · admin"]
        Deps["JWT auth dependency"]
        subgraph Services["Service Layer"]
            CVParser["cv_parser.py"]
            Rating["rating.py — prefilter + RAG + calibration"]
            Vectorstore["vectorstore.py — FAISS chunk/retrieve"]
            ApplyPack["apply_pack.py + cv_latex_boilerplate.py"]
            Crawlers["jooble_crawler.py · jobsapi_indeed_crawler.py"]
            LLM["llm.py — provider abstraction"]
        end
        Security["core/security.py — bcrypt + JWT"]
    end

    subgraph Data["Data Layer"]
        MongoDB[("MongoDB<br/>users · jobs")]
    end

    subgraph External["External Services"]
        Jooble["Jooble API"]
        JobsAPI["JobsAPI (Indeed)"]
        Ollama["Ollama (local, free)"]
        OpenAI["OpenAI (embeddings) / Mistral (EU, parsing + rating) / xAI"]
    end

    Pages --> State --> Fetch
    Fetch -->|"REST + Bearer JWT"| Routes
    Routes --> Deps --> Security
    Routes --> Services
    Services --> MongoDB
    CVParser --> LLM
    Rating --> Vectorstore
    Rating --> LLM
    ApplyPack --> LLM
    Crawlers --> Jooble & JobsAPI
    LLM --> Ollama & OpenAI
```

### Data Model

Jobs live in one shared MongoDB collection, but are not deduplicated across users — each user's crawl inserts its own job document (scoped by `crawled_by`), even for an identical URL another user already has. Per-user data (ratings, feedback, Kanban status, hidden flag) is embedded on that document keyed by `{user_id}`.

```mermaid
erDiagram
    USERS {
        ObjectId _id PK
        string name
        string email UK
        string password_hash
        object cv "raw_text + structured + cv_embedding"
        object preferences
        string about_me "LLM-cleaned free text"
        object skill_overrides
        object usage "search/rating/token counters"
    }

    JOBS {
        ObjectId _id PK
        string title
        string url_hash UK
        string full_text
        string source
        object jd_embedding "cosine pre-filter"
        object jd_chunks "FAISS chunks for RAG retrieval"
        object ratings "ratings.{user_id}"
        object rating_feedback "rating_feedback.{user_id}: stars + comment"
        string status_per_user
        bool hidden_per_user
    }

    USERS ||--o{ JOBS : "rates, tracks, and calibrates against via embedded fields"
```

**`ratings.{user_id}`**: `score`, `matched_strengths`, `gaps`, `verdict`, `auto_reject`, `structural_mismatch`, `tailoring_tips`, `rated_at`.

**`rating_feedback.{user_id}`**: `stars` (1-5), `comment` (LLM-cleaned), `created_at` — surfaced back into the rating prompt the next time a similar job is rated.

**`status_{user_id}`**: `NEW` → `SAVED` → `HALF_APPLIED` → `APPLIED` → `FOLLOWUP` → `INTERVIEWING` → `OFFER` / `REJECTED`.

### Sequence: Job Discovery, Rating & Calibration

```mermaid
sequenceDiagram
    actor User
    participant FE as React Frontend
    participant API as FastAPI
    participant Crawler as Job Crawlers
    participant DB as MongoDB
    participant Rating as rating.py
    participant Vec as vectorstore.py (FAISS)
    participant LLM as Rating LLM

    User->>FE: Click "Search jobs"
    FE->>API: POST /crawler/search (JWT)
    API->>API: Check search + token quota
    par Parallel crawl
        API->>Crawler: crawl_jobs_for_user_jooble()
        API->>Crawler: crawl_jobs_for_user_jobsapi()
    end
    Crawler->>DB: Dedupe by url_hash, skip short JDs, insert new

    FE->>API: POST /jobs/rate-all (background)
    loop Each unrated job
        Rating->>DB: Load user CV + job
        Rating->>Rating: Embedding pre-filter (cosine similarity)
        alt Low similarity
            Rating->>DB: Cheap graduated low score (no LLM call)
        else
            Rating->>Vec: Retrieve most relevant JD chunks + user's similar past-rated jobs
            Vec-->>Rating: Ranked chunks + calibration context (past stars/comments)
            Rating->>LLM: Full rating prompt (CV + about_me + calibration + JD chunks)
            LLM-->>Rating: score, strengths, gaps, verdict, tailoring_tips
        end
        Rating->>DB: Set ratings.{user_id}
    end

    User->>FE: Rate the rating (stars + note)
    FE->>API: POST /jobs/{id}/rating-feedback
    API->>DB: Set rating_feedback.{user_id} (feeds the next similar rating)
```

---

## How It Works

### 1. Authentication
Email + password, bcrypt-hashed, JWT sessions (7-day expiry, `token_version` invalidates old tokens after a password change). Every protected route resolves the user from the Bearer token.

### 2. CV Upload & Parsing
Accepts PDF, Word (`.docx`), OpenDocument (`.odt`), plain text, and LaTeX (max 5MB, format detected from the file extension since browsers send inconsistent MIME types for the less common ones). PyMuPDF/`python-docx`/`odfpy` extract raw text depending on format — no API call for extraction itself. Contact details (email/phone) are redacted before the text goes to the LLM; the LLM returns structured JSON (skills, experience, projects, education); the real contact info is spliced back in locally. Both raw text and structured data are saved on the user document. On upload, four Settings fields that overlap 1:1 with parsed CV data (`primary_role`, `preferred_locations`, `key_skills`, `about_me`) are auto-filled from it — always overwriting with the latest CV's values, with a review banner in Settings — so the same data isn't typed twice.

### 3. Preferences & About Me
Settings (a tabbed layout: Profile & CV, AI models, Search preferences, Notifications, Account, Data & privacy — each tab shows a "cleared" stamp once its required fields are complete, plus an always-visible summary of anything still missing) captures target roles, locations, experience level, work mode, salary floor, key skills, nationality, visa/permit status, work authorization, and a free-text `about_me`. `about_me` and rating-feedback comments are run through an LLM cleanup pass on save (`services/text_cleanup.py`) — tidies messy free text into clear prose, falls back to the raw text if the LLM call fails. Nationality + visa status feed the rating engine's sponsorship/visa auto-reject check (below) — reasoned about by the LLM itself per nationality/country pair, not a hardcoded rule table, so it isn't limited to any one country.

### 4. Job Discovery
`POST /crawler/search` runs **Jooble** and **JobsAPI (Indeed)** in parallel — the only two crawlers currently wired into the live endpoint. Every job is deduplicated by SHA-256 of its URL, scoped per user. You can also paste a job description directly (**Paste JD**) via URL-fetch or manual text.

### 5. AI Rating — prefilter, RAG, and calibration
- **Cosine pre-filter**: low-similarity jobs get a cheap graduated score (1-4), no LLM call.
- **RAG chunk retrieval** (`services/vectorstore.py`): long JDs are chunked and FAISS retrieves the chunks most relevant to the candidate, instead of naive truncation losing tail content.
- **Calibration**: the user's own past-rated similar jobs (including any star rating + comment they left) are retrieved and injected into the prompt, so the LLM stays consistent with corrections made before.
- **Structured output**: `JobRating` Pydantic model — `score`, `matched_strengths`, `gaps`, `structural_mismatch`, `verdict`, `auto_reject`, `tailoring_tips`.
- **Sponsorship/visa reasoning**: the candidate's nationality, visa/permit status, and work authorization are reasoned about together against the job's country and stated sponsorship policy — using the LLM's own general knowledge, no fixed per-country rule table — and auto-rejects with score ≤ 2 when the candidate can't legally work there without sponsorship the JD says isn't offered.
- **Rate the rating**: every job's detail view has an always-visible star (1-5) + comment panel, feeding directly into the calibration loop above.

### 6. Apply Packs (premium)
For jobs scoring 6+, `GET /jobs/{id}/apply-pack` streams progress over Server-Sent Events (live stage messages — drafting, ATS screening, revising, writing the fit brief — instead of one long silent wait) and generates ATS keyword matching, Google XYZ-format bullets (only where a real metric exists in the CV — never invented, and never borrowed from a different bullet's metric), a tailored cover-note opener, and a full one-shot prompt + LaTeX CV boilerplate you paste into ChatGPT/Claude/Grok to produce a compilable, tailored CV. The tailoring pass is a genuine three-call pipeline, not one call role-playing multiple steps: a draft call, an independent ATS-critique call that scores the draft cold against the JD and lists concrete rejection reasons, then a bounded single revision call (only fired if the critique found real issues) that fixes exactly those and reports what changed — surfaced back to the user as an "ATS screening" section and a results panel (alignment %, fixes, still-missing keywords) in the UI, not just buried in the copied text. The LaTeX bullet snippet is generated deterministically from the same XYZ bullets (not asked of the LLM a second time) so it can't drift into unrelated content. Re-requesting a pack for the same job/CV/rating serves the cached result instantly at no extra cost; a "Regenerate" action forces a fresh one. Project selection for the LaTeX résumé favors real production/deployed projects over academic or bundled toy projects, matches diversity to what the JD actually asks for, and never bundles unrelated small projects into one padding-looking bullet. Gated by score, daily quota, and AI token quota.

### 7. Freemium & Admin
Three-layer quota, enforced server-side with atomic Mongo increments: searches (default 3/day), ratings (10/day, reserved before the LLM call and refunded on failure), AI tokens (250k/day). Admin panel (`/{ADMIN_SECRET_PATH}/`) lists users, sets per-user overrides, grants temporary/permanent full access, and shows a platform-wide AI cost summary. Admin bypasses all limits.

### 8. Kanban & Freshness
Each job carries a per-user pipeline status. Dashboard shows relative post/crawl time ("2d ago"); Kanban gives desktop drag-and-drop and a mobile tabbed view.

### 9. Notifications
A small bell in the navbar, not a full notification history — computed live from signals that already exist rather than a separate stored event log: top matches ready to apply to, stale follow-ups, and new AI models added to the admin-managed catalog since you last checked (`GET /users/notifications`, `POST /users/notifications/seen`).

### 10. Privacy & Data Rights
Settings → Data & privacy: a live inventory of what's stored, a full JSON export (`GET /users/data-export`), CV-only deletion, and full account deletion (hard delete of the user doc + every job they crawled, password re-entry required). The Privacy Policy names every third party data actually goes to (Jooble, JobsAPI, your configured LLM provider, MongoDB) and states retention/rights. CV parsing and job rating default to Mistral, an EU-hosted provider, and the app itself is hosted on EU infrastructure — CV/JD content doesn't leave the EU for processing by default. Users can opt into OpenAI or DeepSeek per model (CV parsing / rating independently) from an admin-managed catalog in Settings; doing so sends that data outside the EU to that provider instead, and is treated as a consent action (confirmed in the UI, timestamped server-side). Server logs auto-rotate within 30 days (`pm2-logrotate`). **Not legal advice** — known gap: no formal DPA on file with any LLM provider.

---

## Project Structure

```
JobRadar/
├── backend/
│   ├── main.py                        # FastAPI app, scheduler, LangSmith wiring
│   ├── config.py                      # Env settings — LLM providers, quotas, JWT
│   ├── database.py                    # MongoDB connection (Motor)
│   ├── deps.py                        # JWT auth dependency
│   ├── core/security.py               # bcrypt + JWT
│   ├── models/user.py                 # Auth-related Pydantic schemas
│   ├── routes/
│   │   ├── auth.py                    # Register, login, password reset
│   │   ├── cv.py                      # Upload / get / delete CV
│   │   ├── crawler.py                 # Manual search, crawl status
│   │   ├── jobs.py                    # List, rate, rating-feedback, apply-pack, cleanup
│   │   ├── users.py                   # Preferences, skill overrides, data export/deletion
│   │   └── admin.py                   # Secret-path admin panel
│   └── services/
│       ├── llm.py                     # Main + rating LLM split (ollama/openai/xai/mistral)
│       ├── cv_parser.py                # PDF → text → structured JSON, PII redaction
│       ├── rating.py                  # Prefilter + RAG + calibration + brief/roast
│       ├── vectorstore.py             # FAISS chunking/embedding/retrieval helpers
│       ├── text_cleanup.py            # LLM cleanup for about_me / feedback text
│       ├── apply_pack.py              # ATS keywords, XYZ bullets, one-shot prompt
│       ├── cv_latex_boilerplate.py    # Compilable LaTeX CV template
│       ├── job_dedup.py               # URL hashing + content-fingerprint dedup
│       ├── jd_text.py                 # Incomplete-JD detection, URL enrichment
│       ├── url_fetch.py               # SSRF-safe server-side JD URL fetch
│       ├── prompt_safety.py           # Fences untrusted JD/CV text before it hits an LLM prompt
│       ├── limits.py                  # Search/rating/token quotas + admin overrides
│       ├── ai_usage.py                # Per-user token tracking + platform summary
│       ├── scheduler.py               # Auto crawl + rate (respects limits)
│       ├── email.py / job_reminders.py
│       ├── jooble_crawler.py
│       └── jobsapi_indeed_crawler.py
├── frontend/
│   └── src/
│       ├── pages/
│       │   ├── Landing.tsx / Login.tsx / ForgotPassword.tsx / ResetPassword.tsx
│       │   ├── Dashboard.tsx          # Jobs, quotas, search, rate, Paste JD
│       │   ├── Kanban.tsx
│       │   ├── Settings.tsx           # CV, preferences, privacy, skill overrides
│       │   ├── Admin.tsx
│       │   └── Privacy.tsx / Terms.tsx
│       ├── components/
│       │   ├── JobCard.tsx / JobDetailModal.tsx / ScoreBadge.tsx / StarRating.tsx
│       │   ├── ManualJDModal.tsx / WelcomeModal.tsx / LimitContactModal.tsx
│       │   ├── ProgressBar.tsx / StatTile.tsx      # shared dashboard/admin primitives
│       │   ├── ui/                    # Button / TextField / Card / ClearanceStamp — shared kit
│       │   └── Navbar.tsx / AuthPageShell.tsx / ThemeToggle.tsx / Logo.tsx
│       ├── utils/profileCompleteness.ts  # Shared "what's still missing" check (Dashboard gating + Settings)
│       └── api/                       # fetch-based client + API helpers
├── README.md
```

---

## API Overview

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/auth/register` / `/auth/login` | Create account / log in, get JWT |
| POST | `/auth/forgot-password` / `/auth/reset-password` | Password reset flow (no email enumeration) |
| POST | `/auth/change-password` | Change password while logged in |
| GET | `/auth/me` | Current user profile |
| POST/GET/DELETE | `/cv/upload`, `/cv/me` | Upload (PDF/DOCX/ODT/TXT/TeX), fetch, delete parsed CV |
| GET/PATCH | `/users/preferences` | Get/update search preferences + about_me |
| POST/GET/DELETE | `/users/skill-overrides[/{skill}]` | Per-skill candidate knowledge overrides |
| GET | `/users/data-summary` / `/users/data-export` | What's stored / full JSON export |
| GET/POST | `/users/notifications` / `/users/notifications/seen` | Notification bell feed / mark seen |
| DELETE | `/users/account` | Permanently delete account + all jobs |
| POST | `/crawler/search` | Run job discovery (Jooble + JobsAPI) |
| GET | `/crawler/status` | Crawl stats + quota fields |
| GET | `/jobs` | List jobs (filters; `kanban=true` for pipeline board) |
| POST | `/jobs/rate-all` | Rate all unrated jobs (background) |
| POST | `/jobs/{id}/rate` | Re-rate a single job |
| POST | `/jobs/{id}/rating-feedback` | Star rating (1-5) + comment on a job's AI rating |
| POST | `/jobs/manual` | Add & rate a pasted JD |
| POST | `/jobs/fetch-url` | Server-side JD URL fetch (SSRF-guarded) |
| GET | `/jobs/{id}/brief` | Fit-summary export |
| GET | `/jobs/{id}/apply-pack` | ATS keywords, XYZ bullets, LaTeX CV one-shot prompt (streams progress via SSE) |
| PATCH | `/jobs/{id}/status` | Update Kanban status |
| POST/DELETE | `/jobs/cleanup/preview`, `/jobs/cleanup` | Preview/delete jobs by filter (current user) |
| GET/PATCH/DELETE | `/{ADMIN_SECRET_PATH}/users[...]` | List, adjust access/limits, suspend/delete users |
| GET | `/{ADMIN_SECRET_PATH}/ai-summary` | Platform-wide AI token/cost summary |
| POST | `/{ADMIN_SECRET_PATH}/jobs/cleanup` | Admin: delete jobs for any user, scoped to `crawled_by` |

---

## Getting Started

### Prerequisites
- Python 3.11+, Node.js 18+
- MongoDB (local, VPS with auth, or Atlas)
- Ollama running locally, or an API key for OpenAI / xAI / Mistral
- Jooble + JobsAPI API keys (for job search)

### Backend
```bash
cd backend
cp .env.example .env
# Edit .env with your Mongo URI, JWT secret, API keys, LLM settings

uv sync
uv run uvicorn main:app --reload
```
API runs at `http://localhost:8000`. `backend/test_llms.py` and `backend/test_rag.py` test the LLM/RAG pieces directly, bypassing the app.

### Frontend
```bash
cd frontend
npm install
npm run dev      # :5173
npm run build     # tsc + vite build
```

### Environment Variables
Everything is `.env`-driven — no model names are hardcoded. See `backend/.env.example` for the full list; key ones:

| Variable | Purpose |
|----------|---------|
| `MONGO_URI` / `MONGO_HOST`+`MONGO_USER`+`MONGO_PASSWORD` | Connection (local, VPS-auth, or Atlas) |
| `LLM_PROVIDER` | `ollama`, `openai`, `xai`, or `mistral` — main LLM (CV parsing, apply packs) |
| `RATING_PROVIDER` / `RATING_MODEL` | Separate provider/model for bulk rating — e.g. run rating for free on local Ollama (`qwen3:8b`) while CV parsing stays on a hosted model |
| `MISTRAL_API_KEY` / `MISTRAL_MODEL` | EU-hosted, OpenAI-compatible provider — used by default for both CV parsing and rating |
| `XAI_API_KEY` / `GROK_API_KEY` | For xAI/Grok |
| `JWT_SECRET` | **Required in production** — refuses to start with `DEBUG=false` if weak/default |
| `ADMIN_EMAIL` / `ADMIN_SECRET_PATH` | Required to access the admin panel |
| `FREE_SEARCH_LIMIT` / `FREE_RATING_LIMIT` / `FREE_DAILY_TOKEN_LIMIT` | Freemium caps (defaults: 3 / 10 / 250k) |
| `LANGSMITH_TRACING` / `LANGSMITH_API_KEY` / `LANGSMITH_PROJECT` | Optional per-call LLM tracing (prompt/response/latency/errors) |
| `JOOBLE_API_KEY` / `JOBSAPI_KEY` | Job sources |
| `SMTP_*` | Optional — password reset + job reminder emails |

---

## Security

Intentional protections already in place: bcrypt password hashing, JWT with `token_version` invalidation, in-memory brute-force rate limiting on auth routes, all job routes scoped to `crawled_by == current user` (no IDOR), server-side admin email check, no email-enumeration on forgot-password, account deletion requires password re-entry, SSRF-guarded server-side URL fetch, atomic Mongo quota increments, `/docs` disabled when `DEBUG=false`, `.env` gitignored. Untrusted text handed to an LLM call (scraped job descriptions, uploaded CV text) is meant to be fenced (`services/prompt_safety.py`) with an explicit "this is data, not instructions" marker before being embedded in a prompt — this is applied at the main rating and apply-pack draft/critique/revision calls, but not yet at every call site (the roast/fit-brief endpoints, calibration-notes summarization, and the apply-pack job title/company block still interpolate raw text — open item).

**Known risks to be aware of**: CV text and job descriptions are sent to whichever external LLM provider is active for that user — default: Mistral, EU-hosted, for both parsing and rating; users can self-service switch either to OpenAI or DeepSeek via the admin-managed model catalog in Settings, and admin can grant a one-off provider/model per user. OpenAI is also always used for embeddings regardless of the above. Contact details are redacted from the CV before it's sent, but the rest of the CV isn't; use local Ollama if that matters for your users. JWT lives in `localStorage` (XSS risk, standard SPA tradeoff). Rate limits are in-memory and don't span restarts or multiple workers — add nginx/Cloudflare rate limiting for a public deployment; the in-app limiter also currently trusts `X-Forwarded-For` unconditionally, making it spoofable by anyone talking to the API directly. Two endpoints (rating-feedback text cleanup, calibration-notes regeneration) currently call an LLM with no quota check, and `/jobs/fetch-url` has no rate limit of its own (SSRF-guarded, but uncapped call volume). See the Privacy Policy (`frontend/src/pages/Privacy.tsx`) for the current data-flow disclosure. No formal DPA is on file with any LLM provider — not legal advice.

---

## Tech Stack

| Category | Technologies |
|----------|--------------|
| **Language & runtime** | Python 3.11+ (backend), TypeScript (frontend) |
| **Backend framework** | FastAPI, Uvicorn, Pydantic v2, pydantic-settings |
| **Auth & security** | bcrypt, PyJWT, email-validator |
| **Database** | MongoDB, Motor (async driver) |
| **AI / LLM** | LangChain, langchain-ollama, langchain-openai, langchain-xai, langchain-community, FAISS (RAG chunk retrieval), LangSmith (call tracing), structured Pydantic output |
| **LLM providers** | Ollama, OpenAI, xAI (Grok), or Mistral (EU-hosted, default) — main LLM and rating LLM configured independently |
| **CV file parsing** | PyMuPDF (`fitz`) for PDF, `python-docx` for Word, `odfpy` for OpenDocument |
| **Job discovery** | Jooble API, JobsAPI (Indeed) |
| **Scheduling** | APScheduler |
| **Frontend framework** | React 18, Vite 5, React Router 6 |
| **Frontend state & data** | TanStack Query, Zustand, native `fetch` |
| **Frontend UI** | Hand-rolled CSS design system (spacing/type/radius tokens, light+dark), Lucide React icons, react-hot-toast, @dnd-kit (Kanban drag-and-drop) |
| **Dev tooling** | uv (Python), npm, Ruff (lint), Prettier |
