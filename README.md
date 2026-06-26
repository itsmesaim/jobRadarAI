# JobRadar AI

An AI-powered job hunting assistant that finds roles for you, rates them intelligently against your CV (with separate fast rating models), shows when jobs were posted, and helps you track applications — with built-in freemium limits and an admin panel.

---

## What You Built

**JobRadar AI** is a full-stack web app with two parts:

| Layer | Tech | Role |
|-------|------|------|
| **Backend** | FastAPI, Motor (MongoDB), LangChain, LangSmith, PyMuPDF | Auth, CV parsing, job crawling, AI rating, REST API |
| **Frontend** | React 18, TypeScript, Vite, TanStack Query, Zustand, @dnd-kit, Tailwind CSS | Login, job dashboard, drag-and-drop Kanban, settings |

The core idea: upload your CV once, set your preferences, hit **Search jobs**, and the system discovers listings, rates each one against your profile (1–10), and gives you strengths, gaps, and a verdict — so you spend time on roles that actually fit.

---

## System Architecture

### High-Level Overview

JobRadar is a three-tier system: a React SPA talks to a FastAPI backend, which orchestrates MongoDB persistence, external job APIs, and **split LLM providers** via LangChain.

You can use one model/provider for CV parsing and briefs, and a different (usually faster/cheaper) model for bulk job rating. xAI/Grok is fully supported for rating.

```mermaid
flowchart TB
    subgraph Client["Frontend — React SPA (Vite)"]
        Pages["Pages: Login · Dashboard · Kanban · Settings"]
        State["Zustand (auth) + TanStack Query (server state)"]
        Axios["Axios client + JWT interceptor"]
    end

    subgraph Backend["Backend — FastAPI"]
        Routes["API Routes<br/>auth · cv · crawler · jobs · users"]
        Deps["JWT auth dependency"]
        subgraph Services["Service Layer"]
            CVParser["cv_parser.py"]
            Rating["rating.py"]
            Crawlers["jooble · jobsapi · adzuna · tavily"]
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
        Adzuna["Adzuna API"]
        Tavily["Tavily Search"]
        Ollama["Ollama (local)"]
        OpenAI["OpenAI API"]
    end

    Pages --> State --> Axios
    Axios -->|"REST + Bearer JWT"| Routes
    Routes --> Deps --> Security
    Routes --> Services
    Services --> MongoDB
    CVParser --> LLM
    Rating --> LLM
    Crawlers --> Jooble & JobsAPI & Adzuna & Tavily
    LLM --> Ollama & OpenAI & xAI
```

### Backend Layered Architecture

The backend follows a thin-routes, fat-services pattern. Routes handle HTTP concerns; services own business logic; `llm.py` abstracts the AI providers.

A key design: **main LLM** (for CV parsing, briefs) vs **rating LLM** (for fast bulk job scoring). They can use completely different providers/models controlled only via `.env`.

```mermaid
flowchart TB
    subgraph Presentation["Presentation — FastAPI Routes"]
        auth_r["routes/auth.py"]
        cv_r["routes/cv.py"]
        crawler_r["routes/crawler.py"]
        jobs_r["routes/jobs.py"]
        users_r["routes/users.py"]
    end

    subgraph Business["Business — Services"]
        cv_s["cv_parser.py<br/>PDF → text → JSON"]
        rating_s["rating.py<br/>CV vs JD scoring"]
        jooble_s["jooble_crawler.py"]
        jobsapi_s["jobsapi_indeed_crawler.py"]
        adzuna_s["adzuna_crawler.py"]
        tavily_s["crawler.py (Tavily)"]
        llm_s["llm.py — main + rating LLM split + xAI support"]
    end

    subgraph Core["Core"]
        security["security.py"]
        deps["deps.py"]
        models["models/user.py"]
    end

    subgraph Infra["Infrastructure"]
        config["config.py"]
        database["database.py (Motor)"]
    end

    auth_r & cv_r & crawler_r & jobs_r & users_r --> Business
    auth_r --> security
    Presentation --> deps
    Business --> llm_s
    Business --> database
    database --> MongoDB[("MongoDB")]
    Infra --> database
```

### Frontend Architecture

```mermaid
flowchart LR
    subgraph UI["UI Layer"]
        Login["Login.tsx"]
        Dashboard["Dashboard.tsx"]
        Kanban["Kanban.tsx"]
        Settings["Settings.tsx"]
        Components["JobCard · ManualJDModal · ScoreBadge · Navbar"]
    end

    subgraph DataLayer["Data Layer"]
        Zustand["Zustand — JWT token"]
        TQ["TanStack Query — jobs, crawl status"]
        API["api/client.ts + api/index.ts"]
    end

    Login --> Zustand
    Dashboard & Kanban & Settings --> TQ
    Dashboard & Kanban --> Components
    TQ --> API
    API -->|"http://localhost:8000"| FastAPI["FastAPI Backend"]
```

### Data Model

Jobs are stored in a shared collection; per-user data (ratings, Kanban status, hidden flag) is embedded on each job document using `{user_id}` keys. This lets multiple users rate the same listing independently without duplicating job records.

```mermaid
erDiagram
    USERS {
        ObjectId _id PK
        string name
        string email UK
        string password_hash
        datetime created_at
        string cv_raw_text
        object cv_parsed
        object preferences
        datetime last_crawl_at
        int manual_crawl_count_today
    }

    JOBS {
        ObjectId _id PK
        string title
        string url
        string url_hash UK
        string snippet
        string full_text
        string source
        string company
        string location
        datetime crawled_at
        datetime posted_at
        object ratings
        string status_per_user
        bool hidden_per_user
    }

    USERS ||--o{ JOBS : "rates and tracks via embedded fields"
```

**`ratings.{user_id}`** stores `score`, `matched_strengths`, `gaps`, `verdict`, `auto_reject`, `rated_at`.

**`status_{user_id}`** tracks Kanban pipeline: `NEW` → `SAVED` → `HALF_APPLIED` → `APPLIED` → `FOLLOWUP` → `INTERVIEWING` → `OFFER` / `REJECTED`.

### Deployment Topology

```mermaid
flowchart LR
    Browser["Browser"] --> Vite["Vite dev server<br/>:5173"]
    Vite --> FastAPI["FastAPI + Uvicorn<br/>:8000"]
    FastAPI --> Mongo["MongoDB<br/>:27017 or Atlas"]
    FastAPI --> Ollama["Ollama<br/>:11434"]
    FastAPI --> JobAPIs["Jooble · JobsAPI · Adzuna"]
    FastAPI -.->|"optional"| OpenAI["OpenAI API"]
    FastAPI -.->|"optional"| Tavily["Tavily API"]
```

### Sequence: Job Discovery & AI Rating

```mermaid
sequenceDiagram
    actor User
    participant FE as React Frontend
    participant API as FastAPI
    participant Crawler as Job Crawlers
    participant Ext as Jooble / JobsAPI
    participant DB as MongoDB
    participant Rating as rating.py (prefilter + concurrency)
    participant LLM as Main LLM + Rating LLM (split, xAI supported)

    User->>FE: Click "Search jobs"
    FE->>API: POST /crawler/search (JWT)
    API->>API: Check search + token quota

    par Parallel crawl
        API->>Crawler: crawl_jobs_for_user_jooble()
        Crawler->>Ext: Search with roles + skills
        Ext-->>Crawler: Listings
        API->>Crawler: crawl_jobs_for_user_jobsapi()
        Crawler->>Ext: Search with roles + skills
        Ext-->>Crawler: Listings
    end

    Crawler->>DB: Dedupe by url_hash, skip short JDs, insert new
    API-->>FE: found / stored / skipped

    FE->>API: POST /jobs/rate-all (background task)
    loop Each unrated job for user
        Rating->>DB: Load user CV + job
        Rating->>Rating: Embedding pre-filter (cosine similarity)
        alt Low similarity
            Rating->>DB: Cheap low score (no LLM)
        else
            Rating->>LLM: Rating LLM (can be different provider)
            LLM-->>Rating: score, strengths, gaps, verdict, tailoring_tips
        end
        Rating->>DB: Set ratings.{user_id}
    end

    FE->>API: GET /jobs (poll every 30s)
    API-->>FE: Rated job cards for dashboard
```

### Sequence: CV Upload & Parsing

```mermaid
sequenceDiagram
    actor User
    participant FE as React Frontend
    participant API as FastAPI
    participant CV as cv_parser.py
    participant PDF as PyMuPDF
    participant LLM as Ollama / OpenAI
    participant DB as MongoDB

    User->>FE: Upload PDF (max 5 MB)
    FE->>API: POST /cv/upload (multipart)
    API->>CV: process_cv(pdf_bytes)
    CV->>PDF: extract_text_from_pdf()
    PDF-->>CV: Raw text
    CV->>LLM: parse_cv_with_llm() → structured JSON
    LLM-->>CV: name, skills, experience, projects, education
    CV->>DB: Save cv_raw_text + cv_parsed on user doc
    API-->>FE: Parsed CV summary
```

### Sequence: Authentication

```mermaid
sequenceDiagram
    actor User
    participant FE as React Frontend
    participant API as FastAPI
    participant DB as MongoDB

    User->>FE: Register or login
    FE->>API: POST /auth/register or /auth/login
    API->>DB: Lookup / create user (bcrypt hash)
    API-->>FE: JWT access_token (7-day expiry)
    FE->>FE: Store token in Zustand + localStorage

    Note over FE,API: All protected routes
    FE->>API: Request with Authorization: Bearer {token}
    API->>API: deps.py decodes JWT, loads user
    API-->>FE: Authenticated response
```

---

## How It Works (End-to-End Flow)

```mermaid
flowchart LR
    A[Register / Login] --> B[Upload CV PDF]
    B --> C[LLM parses CV to JSON]
    C --> D[Set preferences in Settings]
    D --> E[Search jobs]
    E --> F[Jooble + JobsAPI]
    F --> G[Store jobs in MongoDB]
    G --> H["Pre-filter + Rating LLM (split model) rates jobs"]
    H --> I["Dashboard (with posted date) + Kanban + usage pills"]
```

### 1. Authentication

- Users register and log in with email + password.
- Passwords are hashed with bcrypt; sessions use JWT (7-day expiry).
- Every protected route reads the Bearer token and loads the user from MongoDB.
- One account per email (enforced with a unique index).

### 2. CV Upload & Parsing

When you upload a PDF (max 5MB):

1. **PyMuPDF** extracts raw text from the PDF (no API call).
2. **LangChain LLM** turns that text into structured JSON: name, skills, experience, projects, education, etc.
3. Both raw text and structured data are saved on your user document in MongoDB.

The structured CV is what the rating engine uses later.

### 3. User Preferences

In **Settings**, you configure:

- Primary role and secondary roles (e.g. Full Stack Developer, AI Engineer)
- Preferred locations (e.g. Dublin Ireland)
- Job types: full-time, internship, contract, remote
- Key skills (used to build search queries)
- Minimum salary

These preferences drive how job searches are built for you.

### 4. Job Discovery (Crawlers)

Manual search (`POST /crawler/search`) runs **two APIs in parallel**:

| Source | How it works |
|--------|----------------|
| **Jooble** | POST API; keywords + Dublin, Ireland; jobs from last 7 days; fetches full JD from link if snippet is short |
| **JobsAPI (Indeed)** | GET API; searches by role + skills; returns structured title, company, location, salary, description |

**Adzuna** is also implemented (`adzuna_crawler.py`) but currently disabled in the live search endpoint.

**Shared logic for all crawlers:**

- Build search terms from your roles and skills
- Hash each job URL (SHA-256) for deduplication
- Skip jobs already in the database
- Skip listings with too little text (< 100–300 chars depending on source)
- Store: title, URL, company, location, full JD text, source, timestamp

There is also a **Tavily-based crawler** (`services/crawler.py`) that uses web search with personalised dork-style queries. It is implemented but the live search endpoint currently uses Jooble + Adzuna.

**Rate limit:** Free users get `FREE_SEARCH_LIMIT` manual searches per day (default **3**). Enforced in `services/limits.py` together with AI token caps.

### 5. AI Job Rating (LangChain + Performance)

After new jobs are stored, the frontend triggers `POST /jobs/rate-all` in the background.

The rating engine has several optimizations for speed and cost:

- **Embedding pre-filter**: Computes cosine similarity between your CV and each job. Low-similarity jobs get a cheap score (1-4) instantly with **no LLM call**.
- **Split LLMs**: You can use a fast/cheap model (e.g. xAI Grok) **only for rating**, while keeping another model for CV parsing and briefs.
- **Concurrency**: Up to 10 jobs rated in parallel.
- **Structured output**: Uses `JobRating` Pydantic model for reliable JSON.

**Rating fields** (returned by the rating LLM):

| Field | Meaning |
|-------|---------|
| `score` | 1–10 fit score (honest, not inflated) |
| `matched_strengths` | Specific ways your profile matches the JD |
| `gaps` | Requirements you are missing or weak on |
| `verdict` | One-sentence summary + actionable suggestion |
| `auto_reject` | True if there are hard blockers (visa, location, etc.) |
| `tailoring_tips` | Concrete advice on what to emphasize when applying |

Ratings are stored per user (`ratings.{user_id}`).

**Configuration** (all via `.env` only):
- `LLM_PROVIDER` + `OPENAI_MODEL` / `OLLAMA_MODEL` (main LLM)
- `RATING_PROVIDER` + `RATING_MODEL` (can be `xai` + a fast Grok model)
- Full xAI support (native or OpenAI-compatible fallback)

### 6. Manual Job Entry

You can paste a job description directly (**Paste JD** on the dashboard):

1. Job is saved with `source: manual`
2. **Rating quota is reserved atomically** before the AI runs (`check_and_increment_rating`)
3. If daily rating or AI token limit is hit → job is saved **unrated**, user sees `LimitContactModal`
4. If rating fails (no CV, short JD, LLM error) → quota slot is **refunded**

The modal and rate button are disabled when the dashboard shows limit reached. Manual JD always uses the **full LLM path** (no embedding pre-filter).

### 7. Job Brief Export

For rated jobs, **Copy details** generates a formatted brief including:
- Score, matched strengths, gaps, verdict
- Actionable **tailoring tips** (new)
- Snapshot of your profile + constraints
- JD excerpt

### 8. Admin Panel & Freemium Limits

JobRadar has a three-layer quota system to control API cost:

| Layer | Default (free) | Resets | Enforced on |
|-------|----------------|--------|-------------|
| **Searches** | 3/day | Midnight UTC | `POST /crawler/search` |
| **Ratings** | 10/day | Midnight UTC | `POST /jobs/rate-all`, `POST /jobs/manual`, bulk background |
| **AI tokens** | 250k/day | Midnight UTC | All LLM + embedding calls (search, rate, CV parse) |

**Rating enforcement details:**
- Quota uses **max(stored counter, actual rated jobs today)** — fixes drift when counter falls behind DB
- Bulk rating **reserves 1 slot per job** before rating; stops mid-batch when exhausted
- Non-billable ratings (no CV, short JD, LLM failure) **refund** the reserved slot
- Admin email and `full_access` users bypass all limits

**User-facing UI (Dashboard):**
- Pills: searches left, ratings left, AI tokens used today
- `LimitContactModal` — dark-theme-safe; explains reset time + email admin (works for rating, search, token limits)
- Search no longer auto-rates in background when quota is exhausted

**Admin panel** (`/{ADMIN_SECRET_PATH}/…`, admin email only):
- User list with search/rating/token usage
- Per-user overrides: `search_limit`, `rating_limit`, `daily_token_limit`, `monthly_token_limit`
- Full access (permanent or 12h / 24h temporary)
- Platform AI summary (`GET /ai-summary`) — token totals + optional cost estimates via `AI_COST_PER_1K_*`

Limits reset daily at **midnight UTC**. See `handoff.md` for implementation notes and troubleshooting.

### 9. Job Freshness

Job cards now show **when the job was posted** (or first seen) using relative time (e.g. "2d ago", "5h ago").

This uses `posted_at` when the source provides it, falling back to `crawled_at`.

### 10. Application Tracking

Each user has their own Kanban status per job (`status_{user_id}`):

`NEW` → `SAVED` → `HALF_APPLIED` → `APPLIED` → `FOLLOWUP` → `INTERVIEWING` → `OFFER` / `REJECTED`

- **Dashboard:** card grid with score filters, status filters, text search, pagination, and a reminder when high-scoring jobs sit unapplied
- **Kanban:** drag-style columns to move jobs through your pipeline
  - `GET /jobs?kanban=true` always returns pipeline jobs (Saved, Applied, etc.) even after re-searching — older board cards are not dropped
  - **Desktop:** horizontal board with column scroll and drag-and-drop
  - **Mobile:** tabbed single-column view with a status dropdown per card (no awkward 8-column scroll)

### 11. Privacy, Data Transparency & Deletion

JobRadar stores personal data (CV, preferences, job history). Settings includes a **Your data** section that:

- Shows an honest disclaimer about what is stored and which third-party services are used (Jooble, JobsAPI, AI/LLM, MongoDB)
- Displays a live inventory: jobs saved/rated, CV details, skill overrides, usage counters
- Lets users **download** all their data as JSON (`GET /users/data-export`)
- Lets users **delete CV only** (`DELETE /cv/me`)
- Lets users **delete account & all data** (`DELETE /users/account`) — wipes jobs, prefs, and the account

> **Not legal advice.** For a public product you should add a proper Privacy Policy and Terms. Job listings come from third-party APIs (each has its own ToS). CV text may be sent to an AI provider for matching. EU users generally have rights to access and delete personal data — the endpoints above support that.

---

## Project Structure

```
JobRadar/
├── backend/
│   ├── main.py              # FastAPI app + scheduler + secret admin mount
│   ├── config.py            # Env settings (LLM, Mongo, JWT, freemium, AI cost)
│   ├── database.py          # MongoDB connection
│   ├── deps.py              # JWT auth dependency
│   ├── core/security.py     # Password hashing, JWT create/decode
│   ├── models/user.py       # Pydantic request/response schemas
│   ├── routes/
│   │   ├── auth.py          # Register, login, me (adminBasePath for admins)
│   │   ├── cv.py            # Upload, get, delete CV (token quota check)
│   │   ├── crawler.py       # Manual search, crawl status + quota fields
│   │   ├── jobs.py          # List, rate-all, manual JD, brief, status
│   │   ├── admin.py         # Secret-path admin (users, access, AI summary)
│   │   └── users.py         # Preferences, data summary/export, account deletion
│   └── services/
│       ├── llm.py           # Main LLM + Rating LLM split + xAI support
│       ├── cv_parser.py     # PDF → text → structured JSON
│       ├── rating.py        # CV vs JD scoring + pre-filter + briefs
│       ├── limits.py        # Search/rating/token quotas + admin overrides
│       ├── ai_usage.py      # Per-user token tracking + platform summary
│       ├── scheduler.py     # Auto crawl + rate (respects limits)
│       ├── adzuna_crawler.py
│       ├── jooble_crawler.py
│       ├── jobsapi_indeed_crawler.py
│       └── crawler.py       # Tavily-based discovery (alternate)
├── frontend/
│   └── src/
│       ├── pages/
│       │   ├── Login.tsx
│       │   ├── Dashboard.tsx    # Jobs, quotas, search, rate, Paste JD
│       │   ├── Kanban.tsx
│       │   ├── Admin.tsx        # Users, limits, AI usage
│       │   └── Settings.tsx     # CV, prefs, privacy (limit modal on CV upload)
│       ├── components/
│       │   ├── JobCard.tsx
│       │   ├── ScoreBadge.tsx
│       │   ├── ManualJDModal.tsx
│       │   └── LimitContactModal.tsx  # Limit-reached UX (dark theme safe)
│       └── api/                 # Axios client + API helpers
├── README.md
└── handoff.md               # Dev handoff — limits, recent fixes, ops notes
```

---

## API Overview

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/auth/register` | Create account, get JWT |
| POST | `/auth/login` | Login, get JWT |
| POST | `/auth/forgot-password` | Request password reset email (no email enumeration) |
| POST | `/auth/reset-password` | Set new password with reset token |
| POST | `/auth/change-password` | Change password (logged in) |
| GET | `/auth/me` | Current user profile |
| POST | `/cv/upload` | Upload & parse PDF CV |
| GET | `/cv/me` | Get parsed CV |
| DELETE | `/cv/me` | Delete uploaded CV |
| PATCH | `/users/preferences` | Update search preferences |
| GET | `/users/data-summary` | What data JobRadar stores for the current user |
| GET | `/users/data-export` | Download all user data as JSON |
| DELETE | `/users/account` | Permanently delete account and all associated data |
| POST | `/crawler/search` | Run job discovery |
| GET | `/crawler/status` | Crawl stats, search/rating usage, **token quota** fields |
| GET | `/jobs` | List jobs (filter by score, status, search; `kanban=true` for pipeline board) |
| POST | `/jobs/rate-all` | Rate all unrated jobs (background, with pre-filter) |
| POST | `/jobs/manual` | Add & rate a pasted JD |
| GET | `/jobs/{id}/brief` | Export job brief (now includes tailoring tips) |
| PATCH | `/jobs/{id}/status` | Update Kanban status |
| GET | `/{ADMIN_SECRET_PATH}/users` | List users + usage (admin only) |
| PATCH | `/{ADMIN_SECRET_PATH}/users/{id}/access` | Set limits, full access, token caps |
| GET | `/{ADMIN_SECRET_PATH}/ai-summary` | Platform-wide AI token/cost summary |

---

## Getting Started

### Prerequisites

- Python 3.11+
- Node.js 18+
- MongoDB (local, VPS with auth, or Atlas)
- Ollama running locally (or OpenAI API key)
- Jooble + JobsAPI API keys (for job search)

### Backend

```bash
cd backend
cp .env.example .env
# Edit .env with your Mongo URI, JWT secret, API keys, LLM settings

uv sync
uvicorn main:app --reload
```

API runs at `http://localhost:8000`.

**Useful for development**:
- `backend/test_llms.py` — test your main LLM and rating LLM directly (bypasses the app)
- `handoff.md` — detailed development notes and issue history from recent work

### Frontend

```bash
cd frontend
npm install
npm run dev
```

App runs at `http://localhost:5173`.

### Environment Variables

**Everything is configured via `.env`** — no model names are hardcoded.

See `backend/.env.example`. Important variables:

| Variable | Purpose |
|----------|---------|
| `MONGO_URI` | Full connection string (dev or Atlas). Ignored if `MONGO_USER` is set |
| `MONGO_DB` | Database name (default: `jobradar`) |
| `MONGO_HOST` | Mongo host for VPS auth mode (default: `localhost`) |
| `MONGO_USER` / `MONGO_PASSWORD` | Local/VPS Mongo with `authSource=admin` — builds URI automatically |
| `LLM_PROVIDER` | `ollama`, `openai`, or `xai` |
| `OPENAI_MODEL` / `OLLAMA_MODEL` | Model for CV parsing, briefs, etc. |
| `RATING_PROVIDER` | Separate provider for job rating (`xai` recommended for speed) |
| `RATING_MODEL` | Model used only for rating (e.g. fast Grok model) |
| `XAI_API_KEY` / `GROK_API_KEY` | For xAI rating |
| `OPENAI_API_KEY` | For main LLM + embeddings |
| `JWT_SECRET` | **Required in production** — long random string (`secrets.token_urlsafe(48)`) |
| `DEBUG` | `false` in production (avoids logging password-reset links) |
| `FRONTEND_URL` | Public app URL for reset + reminder emails |
| `SMTP_*` | Optional SMTP for password reset and job reminder emails |
| `ADMIN_EMAIL` | Admin account email (set in `.env` only — never commit real value) |
| `ADMIN_SECRET_PATH` | Random string for admin URL (e.g. `k9x7p2mQvL4r`) |
| `JOB_REMINDER_*` | Optional daily high-score apply reminder emails (see `.env.example`) |
| `FREE_SEARCH_LIMIT` / `FREE_RATING_LIMIT` | Daily search/rating caps (default 3 / 10) |
| `FREE_DAILY_TOKEN_LIMIT` / `FREE_MONTHLY_TOKEN_LIMIT` | AI token caps per user (0 = unlimited) |
| `AI_MONTHLY_BUDGET_USD` | Optional platform budget for admin dashboard |
| `AI_COST_PER_1K_*` | Optional cost estimates in admin |
| `JOOBLE_API_KEY`, `JOBSAPI_KEY`, etc. | Job sources |

**Key principle**: Change providers/models only in `.env`. The code stays the same.

---

## Security

JobRadar is a **personal/small-team tool**, not a hardened enterprise product. The codebase has intentional protections, but **production requires correct configuration** and awareness of data flows.

### What is already protected

| Area | How |
|------|-----|
| **Passwords** | bcrypt hashing; hash never returned in API |
| **JWT** | Access vs reset token types (`typ`); `token_version` invalidates sessions after password change/reset |
| **JWT secret** | App refuses to start with `DEBUG=false` if secret is default or &lt; 48 chars |
| **Auth brute-force** | In-memory rate limits on login, register, forgot-password (`core/rate_limit.py`) |
| **Jobs (IDOR)** | All job routes scoped to `crawled_by == current user` |
| **Admin** | Server-side email check on every `/{ADMIN_SECRET_PATH}/` route; 403 if not admin |
| **Forgot password** | Same response whether email exists (no enumeration) |
| **Register conflict** | Generic 409 message (no “email already registered” leak) |
| **Account deletion** | Requires password re-entry, not JWT alone |
| **Paste JD URL fetch** | Server-side `POST /jobs/fetch-url` with SSRF checks (no third-party proxy) |
| **Quotas** | Server-enforced atomic Mongo increments; auto-crawl capped per cycle (`AUTO_CRAWL_MAX_STORED_PER_CYCLE`) |
| **OpenAPI** | `/docs` disabled when `DEBUG=false` |
| **Secrets in git** | `.env` gitignored; only `.env.example` with placeholders |

### Remaining risks (read before going public)

| Severity | Risk | Mitigation |
|----------|------|------------|
| **Critical** | `DEBUG=true` logs password-reset links | Set `DEBUG=false` in production |
| **Critical** | CV + preferences sent to **external LLMs** (OpenAI/xAI) | Use local Ollama for PII, or disclose + get consent; disable LangSmith tracing |
| **High** | JWT in `localStorage` (XSS → account takeover) | Keep dependencies updated; consider httpOnly cookies later |
| **High** | In-memory rate limits reset on process restart / don’t span workers | Also rate-limit at nginx/Cloudflare in production |
| **Medium** | Admin = email match + secret URL (not DB role) | Rotate `ADMIN_SECRET_PATH`; use strong admin password |
| **Medium** | Auto-crawl does not consume manual search quota | Capped per cycle; manual searches still limited separately |
| **Medium** | MongoDB without auth on localhost | Use `MONGO_USER`/`MONGO_PASSWORD` on VPS; TLS for Atlas |

### Data privacy

- Uploading a CV sends parsed text to your configured **LLM provider** for matching.
- Settings → data summary / export describes stored fields; account deletion removes user + jobs.
- Job reminder and password-reset emails require **SMTP**; links use `FRONTEND_URL`.

---

## Summary (TL;DR)

**JobRadar AI** — personalised job search with smart, fast AI rating:

1. Upload CV → structured parsing
2. Set preferences
3. Search jobs (Jooble + JobsAPI + others)
4. **Rate-all** → Uses embedding pre-filter + separate fast rating model (xAI supported) for hundreds of jobs
5. Get scores + **tailoring tips** + track in Kanban
6. Admin panel for limits & access control

**Major current capabilities**:
- Separate main LLM vs Rating LLM (configurable in `.env` only)
- Fast bulk rating via cosine pre-filter + concurrency
- **Three-layer freemium**: searches, ratings, AI tokens — admin-overridable per user
- Accurate quota enforcement (atomic reserve, DB sync, refund on failed ratings)
- `LimitContactModal` when limits hit (rating / search / token)
- Platform + per-user AI token tracking in admin
- Job posted date on cards, Kanban (desktop DnD + mobile tabs)
- User data export and account/CV deletion in Settings

**Ops + security:** see the **Security** section above and `backend/.env.example` for production checklist.

The system is deliberately **.env-driven** — no model names or providers are hardcoded in code.

---

## Tech Stack

| Category | Technologies |
|----------|--------------|
| **Language & runtime** | Python 3.11+ (backend), TypeScript (frontend) |
| **Backend framework** | FastAPI, Uvicorn, Pydantic v2, pydantic-settings, python-dotenv |
| **Auth & security** | bcrypt, PyJWT, email-validator |
| **Database** | MongoDB, Motor (async driver) |
| **AI / LLM** | LangChain, langchain-ollama, langchain-openai, langchain-xai, LangSmith (tracing), structured Pydantic output |
| **LLM providers** | Ollama, OpenAI, or xAI (Grok). Main LLM and Rating LLM can be different. |
| **PDF processing** | PyMuPDF (`fitz`) |
| **Job discovery** | Jooble API, JobsAPI (Indeed), Adzuna, Tavily Python SDK |
| **HTTP client** | httpx (async crawlers) |
| **Scheduling** | APScheduler |
| **Frontend framework** | React 18, Vite 5, React Router 6 |
| **Frontend state & data** | TanStack Query, Zustand, Axios |
| **Frontend UI** | Tailwind CSS, Lucide React (icons), react-hot-toast (notifications), @dnd-kit (Kanban drag-and-drop) |
| **Dev tooling** | uv (Python package manager), npm, Ruff (linting) |