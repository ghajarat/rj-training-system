# RJ Training System — Project Context for Claude Code

AI-powered employee training platform for Royal Jordanian Airlines. PSUT graduation project (GP2 = implementation phase). Supervisor: Dr. Mohammad Abu Snober.

Team: Ghaith (frontend + docs), Zaid Alsaleh (backend + database + docs), Ahmad Mashal (diagrams + docs).
Every line of code here will be questioned at an oral defense. Prefer clear, conventional code over clever code, and explain non-obvious decisions briefly.

## Stack

- Frontend: React + Vite, react-router-dom, axios, React Context for auth
- Backend: Node.js + Express, node-postgres, bcrypt, jsonwebtoken, dotenv
- Database: PostgreSQL (local v18 on Windows) + pgvector
- AI (later phases): OpenAI text-embedding-ada-002 (1536 dims), Claude/OpenAI for generation
- Dev machine: Windows, PowerShell, VS Code. Repo: ghajarat/rj-training-system
- Note: the GP1 document wrongly lists Python + FastAPI. The real stack is Node.js + Express. Never introduce Python.

## Codebase map & commands

Versions in use: React 19, Vite 8, react-router-dom 7, axios 1; Express 5 (CommonJS), pg 8, bcrypt 6, jsonwebtoken 9.

### Backend (`backend/`)

| Path | Purpose |
|---|---|
| `server.js` | Starts the HTTP server on `PORT` (default 5000). |
| `app.js` | Builds the Express app: CORS (`CLIENT_ORIGIN`), JSON body (1 MB), `GET /api/health`, route mounting, `/api` 404, central error handler. Kept apart from `server.js` so tests can import it. |
| `config.js` | Loads `.env` once and fails fast if `DATABASE_URL` / `JWT_SECRET` are missing or the secret is under 32 chars. Exposes `port`, `clientOrigin`, `jwt`, `login` (lock settings), `setup`, `materials.maxMb`. |
| `db/index.js` | Shared `pg` Pool. Use `db.query(text, params)`; for multi-step writes use `db.transaction(async (client) => ...)` (BEGIN/COMMIT, ROLLBACK on error). |
| `db/schema.sql` | The 14 GP1 tables, FK indexes, unique `progress(trainee_id, course_id)`, HNSW cosine index on `embeddings`. Idempotent (`IF NOT EXISTS`). |
| `db/migrate.js` | Applies `schema.sql`, then each not-yet-run file in `db/migrations/` in its own transaction, recorded in `schema_migrations`. `--reset` drops all tables first; refuses in production. |
| `db/migrations/001_user_management.sql` | Phase 4a: `users.is_active`, nullable `password_hash`, `setup_token_hash/_expires_at`, `audit_logs` table. Explained in `docs/schema-changes.md`. |
| `db/migrations/002_training_management.sql` | Phase 4b: `courses.sequence_order` + deferrable `UNIQUE (plan_id, sequence_order)`, `UNIQUE (plan_id, trainee_id)` on `plan_assignments`. A course still belongs to one plan (GP1). |
| `db/migrations/003_trainee_feedback.sql` | Phase 4c: `UNIQUE (trainee_id, course_id)` on `feedback` (one editable feedback per course). |
| `db/migrations/004_chatbot.sql` | Phase 5: `documents.status/error_message/embedding_model`, `embeddings.chunk_index/section/page` (+ `UNIQUE (doc_id, chunk_index)`), `chat_messages.citations` (JSONB snapshot), `outcome`, `related_course_ids`. |
| `db/seed.js` | Truncates everything, then inserts roles, 4 departments, 7 users (incl. one pending invite and one deactivated), 4 plans with ordered courses (one overdue plan, one demo PDF in `uploads/materials/`, one web link), assignments, progress, feedback, KPIs, notifications, audit rows. Clears old material files. Prints a demo invite link. Refuses in production. |
| `middleware/auth.js` | `authenticate` (Bearer JWT, then loads current role + `is_active` from the DB every request → `req.user = { id, role, name }`; 401 `ACCOUNT_DEACTIVATED`) and `authorize(...roles)` (403 if role not allowed). |
| `routes/auth.js` | `POST /api/auth/login` → `{ token, user }` (403 `ACCOUNT_DEACTIVATED`, logs LOGIN / LOGIN_FAILED); `GET /api/auth/me`; public `POST /api/auth/setup/verify` and `POST /api/auth/setup` (one-time invite / reset links). |
| `routes/users.js` | Admin only. `GET /` (search, role, departmentId, status, page, pageSize), `POST /` (invite), `GET/PATCH /:id`, `POST /:id/setup-link`, `/:id/deactivate`, `/:id/reactivate`. Self-deactivate, self-role-change and last-active-admin guards. |
| `routes/departments.js` | `GET /api/departments` → `{ departments }`, Trainer + Admin. |
| `routes/auditLogs.js` | `GET /api/audit-logs` (action, userId, search, from, to, page), Admin only, read-only. |
| `routes/courses.js` | FR7, Trainer + Admin. `GET /` (planId, type, search, page), `POST /` (multipart: planId, name, durationMinutes, link, file), `GET/PATCH/DELETE /:id`, `GET /:id/material` (authenticated download). Delete refused (409 `COURSE_HAS_PROGRESS`) once trainees started it. |
| `routes/plans.js` | FR8/FR9, Trainer + Admin. `GET /`, `POST /`, `GET/PATCH/DELETE /:id`, `PUT /:id/order`, `POST /:id/assignments` (`traineeIds` or `departmentId`), `DELETE /:id/assignments/:traineeId`, `GET /:id/progress`. |
| `routes/trainees.js` | FR8/FR9, Trainer + Admin. `GET /` (search, departmentId, planId → `assignedToPlan`), `GET /:id/progress`. Active trainees only. |
| `routes/me.js` | FR4–FR6, **Trainee only**. `GET /plans` → `{ summary, plans }` (courses with status, material, my feedback), `GET /courses/:id/material`, `PUT /courses/:id/progress` (`completionPct` 0/25/50/75/100), `PUT /courses/:id/feedback` (`rating` 1–5, `comment` ≤ 2000, stored as written). Trainee is always `req.user.id`; a course outside my plans is 404 `COURSE_NOT_FOUND`; feedback needs a started course (409 `COURSE_NOT_STARTED`). Writes return the refreshed `{ summary, plans }`. |
| `middleware/uploadMaterial.js` | multer 2 disk upload of one `file` to `uploads/materials/<uuid>.<ext>`: extension, size (`MATERIAL_MAX_MB`) and magic-byte checks; `discardUpload(req)` on failure. |
| `services/users.js` | `USER_SELECT` (with derived `status` and `last_active_at`), `toUserDto` (the one user shape sent to the frontend; never includes secrets), `findUserById`. |
| `services/audit.js` | `ACTIONS` and `record(client, { actorId, action, targetUserId, details })` — call with the transaction's client. |
| `services/materialFiles.js` | Where material files live, `material_url` format (`https://...` or `upload:<uuid>.<ext>`), `describe(url)` → `{ type, label, url }`, safe `pathFor`, `removeStored` (call after COMMIT). |
| `services/courses.js` | `COURSE_SELECT`, `toCourseDto`, `findCourseById`, `findCoursesByPlan`. |
| `services/plans.js` | `PLAN_SELECT` (with progress totals), `toPlanDto`, `findPlanById`, `lockPlan` (plan row `FOR UPDATE`; always lock plan before course). |
| `services/progress.js` | FR9 definitions in one place: `PROGRESS_CTE` (per assignment: completion % = FLOOR of course average, missing progress = 0; last activity; overdue; status), `PLAN_STATS_CTE`, `planProgress`, `traineeProgress` (`withFeedback` for the trainee), `COURSE_STATUS_SQL` (not_started / started / in_progress / completed), `syncAssignmentStatus` (keeps `plan_assignments.status` in step; called on progress change, course add/delete and assignment). Reuse for Phase 7. |
| `utils/setupToken.js` | Random one-time token, its SHA-256, the link URL, and `expirySql()` (expiry uses the DB clock). |
| `utils/validate.js` | `requireUuid`, `parsePagination`, `paginationDto`, `likePattern`, `isDate` (rejects impossible dates like 2026-02-30), `readText`, `readHttpUrl`, `EMAIL_RE`. |
| `test/userManagement.test.js` | `npm test`: node:test + supertest, Phase 4a. **Re-seeds the dev database.** |
| `test/trainingManagement.test.js` | Phase 4b (FR7–FR9), runs with `MATERIAL_MAX_MB=1`. |
| `test/traineeTraining.test.js` | Phase 4c (FR4–FR6): own-data-only access, progress steps, plan completion sync, feedback upsert. |
| `test/chatbot.test.js` | Phase 5 API (runs with `AI_FAKE=1`): SOP upload/validation/indexing (TXT, DOCX, PDF pages, scanned/damaged PDF), re-upload, re-index, delete, role access, grounded answers + citations, not-found, refusals, session ownership, rate limit. |
| `test/chatbotUnits.test.js` | Phase 5 unit tests, no DB: chunker, safety rules, citation mapping, prompt history. All five files: 237 tests. |
| `test/fixtures/` | `galley-equipment.docx` and `makePdf.js` (builds small text PDFs in memory). |
| `routes/documents.js` | FR13 SOP library, **Admin**: `GET /`, `POST /` (multipart `file`, `title?` → 202 processing), `GET/PUT/DELETE /:id`, `POST /:id/reindex`. `GET /:id/file` for any signed-in user (opening a citation). 409 `DOCUMENT_EXISTS` (same title), `DOCUMENT_PROCESSING`. |
| `routes/chat.js` | FR10–FR12, all roles, own sessions only (404 `SESSION_NOT_FOUND` otherwise): `GET/POST /sessions`, `GET /sessions/:id/messages`, `DELETE /sessions/:id`, `POST /sessions/:id/messages` (`text` ≤ 2000) → `{ userMessage, message, citations, relatedCourses, session, timings }`. Per-user rate limit (429 `RATE_LIMITED`). Refusals are normal replies with `outcome: 'refused'`. |
| `middleware/uploadSop.js` | Like `uploadMaterial.js` for SOPs: PDF/DOCX/TXT, `SOP_MAX_MB`, content check (TXT must be UTF-8 without NUL bytes) → `uploads/sops/`. |
| `services/sopFiles.js` | SOP files on disk (`file_url` = `upload:<uuid>.<ext>`), `typeOf`, safe `pathFor`, `sendSopFile` (PDF inline). |
| `services/ai/` | `clients.js` (OpenAI/Anthropic SDK clients, retries with backoff, 503 `AI_NOT_CONFIGURED` / `AI_UNAVAILABLE`), `embeddings.js` (batched ada-002), `moderation.js` (fails open), `llm.js` (`LLM_PROVIDER`/`LLM_MODEL`, default `claude-haiku-5-5`, effort low, handles `refusal`), `fake.js` (`AI_FAKE=1` stand-ins). |
| `services/rag/` | `extract.js` (pdf-parse pages, mammoth headings), `chunker.js` (section-aware, ~800 tokens, ~100 overlap), `ingest.js` (background queue, one transaction per document, `resumePending` on start), `retrieve.js` (pgvector top-k + similarity floor), `prompt.js` (system prompt, `NOT_IN_SOPS` token, 6-message history), `citations.js` (drop/renumber `[n]`), `safety.js` (rule layer), `relatedCourses.js` (course embeddings cached in memory), `answer.js` (the whole pipeline + per-stage timings). |
| `services/chatHistory.js` | Sessions (title = first question, derived) and messages, every query scoped to the owner; `saveExchange` writes question + answer in one transaction. |
| `scripts/ingest-sample-sops.js` | `npm run sop:samples`: loads the three **fictional** SOPs in `samples/sops/`. |
| `scripts/measure-chat-latency.js` | `npm run chat:latency`: 10 questions through the real pipeline, p50/p95 per stage vs the 5 s target. |
| `uploads/` | Uploaded materials (gitignored). Not served statically. |
| `services/loginAttempts.js` | In-memory failed-login counter and temporary lock (resets on server restart). |
| `utils/httpError.js` | `throw new HttpError(status, code, message)` from any route; `app.js` turns it into the JSON error response. |
| `utils/jwt.js` | `signToken(userRow)` / `verifyToken(token)` — HS256, issuer `rj-training-system`, payload `{ sub, role, name }`. |
| `utils/password.js` | `hashPassword` / `verifyPassword` (bcrypt, 12 rounds) with a dummy hash so unknown emails take as long as wrong passwords; `checkPasswordStrength` (10–72 chars, letter + digit). |
| `.env.example` | `PORT`, `DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `CLIENT_ORIGIN` (also the base of invite links), `LOGIN_MAX_ATTEMPTS`, `LOGIN_LOCK_MINUTES`, `INVITE_EXPIRES_HOURS`, `MATERIAL_MAX_MB`, `SEED_PASSWORD`; Phase 5: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `LLM_PROVIDER`, `LLM_MODEL`, `LLM_EFFORT`, `EMBEDDING_MODEL`, `MODERATION_MODEL`, `AI_TIMEOUT_MS`, `RAG_TOP_K`, `RAG_MIN_SIMILARITY`, `RAG_CHUNK_TOKENS`, `RAG_CHUNK_OVERLAP_TOKENS`, `SOP_MAX_MB`, `CHAT_RATE_LIMIT_PER_MIN`, `CHAT_LOG_TIMINGS`, `AI_FAKE`. |

Express 5 forwards errors thrown in async handlers to the error handler, so routes `throw` instead of calling `next(err)`.

### Frontend (`frontend/`)

| Path | Purpose |
|---|---|
| `index.html` | Loads Montserrat from Google Fonts. |
| `src/main.jsx` | Imports `tokens.css` + `global.css`, renders `<App />`. |
| `src/App.jsx` | **All routes.** Public: `/signin`, `/forgot-password`, `/set-password`. Everything else sits inside `<ProtectedRoute>` → `<AppShell>`, with per-route `<ProtectedRoute roles={[...]}>`. `*` → `RoleHomeRedirect`. |
| `src/api/client.js` | Shared axios instance (`VITE_API_URL`, 15 s timeout). Adds `Authorization: Bearer`; on a 401 (except login) clears the token and fires `rj:session-expired`. `getErrorMessage(err)` turns any error into a user-facing sentence. |
| `src/auth/AuthContext.jsx` | `AuthProvider`: `user`, `status` (`loading`/`authenticated`/`anonymous`), `notice`, `login(email, pw, remember)`, `logout()`, `clearNotice()`. Restores the session via `GET /auth/me` on load. |
| `src/auth/useAuth.js` | `AuthContext` + `useAuth()` hook. |
| `src/auth/ProtectedRoute.jsx` | Route guard (signed out → `/signin`; wrong role → own home) and `RoleHomeRedirect`. |
| `src/auth/roles.js` | `ROLES`, `ROLE_HOME`, `homeFor(role)`. Role strings must match `roles.role_name`. |
| `src/auth/tokenStorage.js` | JWT in `localStorage` ("Remember this device") or `sessionStorage`, key `rj.token`. |
| `src/layout/AppShell.jsx` | Signed-in layout: 240px sidebar, top bar (breadcrumb, disabled search, bell, user), `<Outlet />`. Sidebar becomes a drawer under 900px. |
| `src/layout/navigation.js` | `NAV_SECTIONS` (sidebar items + allowed roles), `navFor(role)`, `titleFor(path)`. Keep in sync with `App.jsx`. |
| `src/components/` | Shared UI: `Button` (primary/accent/secondary/ghost/danger, sm/md, icon, loading; `btn` classes also work on `<Link>`), `Input` (label, icon, error/hint, password toggle), `Textarea`, `Select`, `FileUpload` (drag-and-drop, type/size check), `ProgressBar` (tones), `Modal` (native `<dialog>`, sizes sm/md/lg), `ConfirmDialog`, `Badge` (tones), `Menu` (row action dropdown), `Pagination`, `StarRating` (radio-based 1–5 picker or read-only), `Icon` (inline SVG set — add paths to `PATHS`), `BrandMark`. |
| `src/hooks/` | `useFetch(url, params)` → `{ data, error, loading, reload }` (ignores stale responses; null url = skip); `useDebouncedValue`. |
| `src/api/admin.js` | User-management and set-password API calls. |
| `src/api/training.js` | Course (multipart, upload progress, no timeout), material download (blob; takes the URL so trainees can reuse it), plan, reorder and assignment calls. |
| `src/utils/format.js` | `initials`, `formatDate`, `formatDateTime`, `formatDay` (API `YYYY-MM-DD` as a local date), `todayIso`, `formatMinutes`, `formatBytes`, `timeAgo`, `plural`. |
| `src/pages/` | `SignIn`, `ForgotPassword` (tells users to ask an admin for a reset link), `SetPassword`, `MyDashboard` (Phase 4c: stats, learning paths, due dates, marked Phase 6 AI slot; `dashboard.css`), `TrainerOverview` (shell), `ComingSoon`, `PageHeader`, shared `pages.css` (card, panel, stat-grid, table, empty-state, inline-error/success, modal-form, hide-sm, toolbar, filters, user-cell, table__actions, back-link, table__link/sub, icon-button). |
| `src/pages/admin/` | `UserManagement` (+ `InviteUserModal`, `EditUserModal`, `SetupLinkModal`, `UserBadges`, `userOptions`), `AuditLog` (+ `auditLabels`), `admin.css`. |
| `src/pages/training/` | Phase 4b, Trainer + Admin: `TrainingMaterials` (`/materials`; Trainees get `MyMaterials`), `TrainingPlans` (`/plans`), `PlanDetail` (`/plans/:id`: course order, assign, progress), `MyTrainees` (`/trainees`) + `CourseFormModal`, `PlanFormModal`, `AssignPlanModal`, `TraineeProgressModal`, `trainingOptions`, `training.css`. Phase 4c, Trainee: `MyMaterials` (tabs, plan filter, search; `?plan=` / `?course=`), `CourseModal` (open material, progress steps, feedback), `useMyTraining` (+ `flattenCourses`, `nextCourse`). |
| `src/api/me.js` | Trainee calls: `setProgress`, `saveFeedback`, `downloadMyMaterial`, `PROGRESS_STEPS`. |
| `src/api/chat.js`, `src/api/documents.js` | Phase 5: chat sessions/messages (60 s timeout); SOP upload/update/re-index/delete and `openDocument` (blob in a new tab). |
| `src/pages/assistant/` | Phase 5, all roles, `/assistant`: `AIAssistant` (state; a session is created on the first question), `SessionList`, `ChatThread` (bubbles, `[n]` markers, typing indicator, empty state with examples, refused / not-found styles), `Citations`, `Composer` (Enter / Shift+Enter), `AssistantSidePanel` (sources of the last answer, related courses), `sources.js`, `assistant.css`. |
| `src/pages/admin/SopLibrary.jsx` | Phase 5, Admin, `/admin/sop-library`: table with status badges, polls every 3 s while indexing, `SopUploadModal` (upload, re-upload, rename). |
| `src/styles/` | `tokens.css` (design tokens), `global.css`. |
| `.env.example` | `VITE_API_URL=http://localhost:5000/api` |

### Commands (PowerShell, run each one on its own)

First-time setup: copy `backend/.env.example` → `backend/.env` and `frontend/.env.example` → `frontend/.env`, fill in `DATABASE_URL` and `JWT_SECRET`, then `npm install` in each folder.

From `backend/`:

- `npm run dev` — API with nodemon on http://localhost:5000 (there is no `start` script)
- `npm run db:migrate` — create any missing tables/indexes (safe to re-run)
- `npm run db:seed` — wipe all rows and load demo data
- `npm run db:reset` — drop all tables, migrate, then seed (dev only)
- `npm run sop:samples` — load the fictional sample SOPs (needs `OPENAI_API_KEY`, or `AI_FAKE=1`)
- `npm run chat:latency` — time the chatbot per stage (needs the API keys)

From `frontend/`:

- `npm run dev` — Vite dev server on http://localhost:5173
- `npm run build` — production build to `dist/`
- `npm run lint` — ESLint
- `npm run preview` — serve the built `dist/`

From `backend/`, `npm test` runs the API tests (node:test + supertest). It migrates and **re-seeds the database in DATABASE_URL** first, so use it on a dev database only. The frontend has no tests yet.

## Database

14 tables, exactly as defined in GP1 Tables 16–29: roles, departments, users, training_plans, plan_assignments, courses, progress, feedback, documents, embeddings, chat_sessions, chat_messages, kpis, notifications.
UUID primary keys, CHECK constraints, VECTOR(1536) on embeddings, 3NF with one documented denormalization.

Schema rule: do not edit schema.sql silently. If a feature truly needs a schema change, propose it during planning, wait for approval, implement it as a separate migration file, and log it in docs/schema-changes.md (what changed + why). The GP2 document must explain every deviation from GP1.

Migrations: `db/schema.sql` is the GP1 baseline. Approved changes go in numbered files in `db/migrations/` (`001_*.sql`, `002_*.sql`, ...), applied in order by `db/migrate.js`, which records them in `schema_migrations`. Each deviation is explained in `docs/schema-changes.md`.

Seeded demo accounts (password RJtraining#2026): admin@rj.com, trainer@rj.com, trainee@rj.com, trainee2@rj.com, trainee3@rj.com. Also huda.mansour@rj.com (deactivated) and sami.odeh@rj.com (pending invite; the seed prints its link).

## Roles & routing

- Three roles: Trainee, Trainer, Admin. Invite-only onboarding — there is NO self-signup.
- After login: Trainee → /dashboard (My Dashboard), Trainer → /trainer (Trainer Overview), Admin → /admin/users (User Management).
- Every new API route must use authenticate + authorize(...) with the correct roles. Every new page must sit behind ProtectedRoute with the correct roles.

## The 8 screens

Sign-In, Forgot/Reset Password, My Dashboard, AI Assistant, Training Materials, Trainer Overview, Analytics & ROI, User Management. Finished designs (made in Claude Design) exist for all 8, as PNGs in docs/designs/ (sign-in.png, user-management.png, ...). When building a screen, match its design rather than inventing a layout; ask for it if missing.

## Design system (locked — do not change)

- Flint Gray #5F6367 (primary), Prom Gold #A8854A (accent), Light Gray #F2F2F2 (page background), white cards/surfaces, Dark Slate #2A2D2F (text)
- Font: Montserrat. Sidebar: 240px. Border radius: 6px.
- Use the CSS variables from tokens.css only. No hardcoded hex values in components.
- Reuse existing Button / Input / Icon components; add new shared components (Table, Modal, Badge, Select, FileUpload, etc.) to the same components folder so later phases can reuse them.

## Coding conventions

- SQL: parameterized queries only ($1, $2), never string concatenation. Use transactions for multi-step writes.
- API errors as { "error": { "code": "<MACHINE_CODE>", "message": "<clear human-readable message>" } } with the right status code (400, 401, 403, 404, 409, 423, 500). Throw `new HttpError(status, code, message)`; the handler in app.js builds the response. The frontend shows `message` (via getErrorMessage) and can branch on `code` (e.g. TOKEN_EXPIRED, ACCOUNT_LOCKED). 423 is used only for a temporarily locked account. Clear error messages are a requirement (NFR12).
- Validate input on the backend even if the frontend validates too.
- Never return password_hash (or any secret) from any endpoint.
- Reference requirement IDs in code comments and commit messages, e.g. // FR19: deactivate user. Key IDs (GP1): FR1 = admins invite users and assign roles; FR2 = audit log of admin actions, viewable from User Management; FR19 = admins create, edit and deactivate accounts.
- Frontend: loading, empty and error states for every list/page. Layout must work at phone width (NFR10).

## Working rules

1. Plan before coding. Present the plan (endpoints, files, schema impact, open questions) and wait for approval.
2. One sub-phase per feature branch (feature/user-mgmt, feature/training-trainer, feature/training-trainee), branched off dev. PRs go into dev, never main.
3. Never commit .env. Never print or log secrets. The only exception is the demo seed password, which db/seed.js prints so the team knows how to sign in.
4. Do not git push and do not create PRs — the developer does that.
5. Give terminal commands one at a time (PowerShell syntax), never as a multi-line block.
6. After building, test every endpoint (success, validation failure, wrong role) and summarize the results.
7. End each sub-phase with: what was built, files touched, schema changes, known limitations, and what the developer should be ready to explain at the defense.

## Agreed for Phase 4a (User Management)

- First step: move every hardcoded colour in component/page/layout CSS into tokens.css. Replace the navy sidebar avatar (#2F4A6B in AppShell.css) with a palette colour (Flint Gray or Prom Gold).
- Build the numbered migration runner for db/migrations/ (see Database).
- Add an empty state to the User Management list.
- The Forgot Password placeholder will become the set-password page if invite option (a) is chosen.
- Deactivation (FR19) must take effect immediately: authenticate must load the user's current status and role from the database on every request instead of trusting the JWT alone.
- Schema changes (users.is_active, setup token columns, audit_logs table) were approved by the team and built as migration 001 (see docs/schema-changes.md).

## Agreed for Phase 4b (Training Management, FR7–FR9)

- Keep GP1's one-plan-per-course model. Migration 002 adds only `courses.sequence_order` and two unique constraints (approved). No `plan_courses` table and no category column; materials are filtered by plan instead of the design's categories.
- Material = one file (PDF/DOCX/PPTX/MP4) or one web link per course, in `courses.material_url`. Files on local disk, max `MATERIAL_MAX_MB` (100), downloaded only through the API.
- Any Trainer or Admin may edit any plan or course; `training_plans.created_by` and the audit log record who did what.
- Deletes are refused when they would erase history: a course with trainee progress or feedback (409 `COURSE_HAS_PROGRESS`), a plan with assignments (409 `PLAN_HAS_ASSIGNMENTS`) or with progress on its courses (409 `PLAN_HAS_PROGRESS`).
- Assigning a department assigns its active trainees at that moment. Duplicates are skipped. A plan past its due date cannot be assigned (409 `PLAN_PAST_DUE`).
- Progress is derived, never stored (`services/progress.js`); deactivated trainees are left out of progress views. `plan_assignments.status` is kept in step by Phase 4c (`syncAssignmentStatus`).
- Training Plans and My Trainees are open to Trainers and Admins.

### Design decisions (these override the screenshots in docs/designs/)

Where the code differs from the design screenshots because of a decision below, follow the decision.

Sign-In:
- Login is email + password only. No Employee ID field.
- No "request an account" link (invite-only). In its place, a short line: "Accounts are created by your administrator."

User Management:
- No Employee ID column. It is not in the schema and not worth another deviation.
- Last active: derived from the user's most recent login in audit_logs. No new column (depends on the pending audit_logs table, which must therefore also record logins).
- Active status: from users.is_active.
- Pending invitations: users with no password yet and an unexpired setup token.

Sidebar items not yet routed:
- SOP Library (Admin): built in Phase 5 as `/admin/sop-library` (FR13).
- System Health (Admin): keep, with a placeholder page saying it arrives in Phase 8 (reports).
- My Trainees (Trainer + Admin): built in Phase 4b as `/trainees` (FR9).
- Achievements and Schedule: removed. They are not in any requirement.

## Agreed for Phase 4c (Training Management for Trainees, FR4–FR6)

- Trainee API lives under `/api/me` (Trainee only). The trainee id always comes from `req.user.id`, never the URL or body. A course outside the trainee's plans answers 404, as if it did not exist.
- Migration 003 (approved): one feedback per (trainee, course), editable. Changing the comment resets `sentiment_score` to NULL for Phase 7.
- Progress steps: started 0, in progress 25/50/75, completed 100. Opening a material marks a course started. Moving back is allowed.
- Feedback opens once a course is started. Upcoming plans (start date ahead) can be opened; overdue plans can still be completed.
- `plan_assignments.status` is kept in step with progress (`syncAssignmentStatus`), including when a trainer adds or deletes a course.
- Dashboard cards: overall progress, courses completed, training time completed, next due. Up Next → Upcoming due dates. No Schedule, Achievements or Recent Activity. AI suggestions = empty Phase 6 slot.
- Seed: Omar (trainee@rj.com) also has Ground Handling Fundamentals, which starts 1 Nov 2026, to demo an upcoming plan. Older seeded progress values (30%, 60%, 45%, 20%) are not on the new steps; the course window shows the exact value.

## Agreed for Phase 5 (AI Chatbot, FR10–FR13, NFR18)

- Migration 004 (approved): SOP status, chunk section/page/index, citations snapshot, outcome and related course ids on chat messages. No new table. See `docs/schema-changes.md`.
- Upload answers 202; indexing runs in the API process, one document at a time. Chunks and `ready` are written in one transaction; failures are marked `failed` with a plain reason. A re-indexed SOP keeps answering from its old chunks until the new ones are in.
- Chat pipeline: rules → (moderation ‖ embed) → pgvector top 5 above a floor (none → "couldn't find", no LLM call) → LLM → citation mapping (an answer citing nothing counts as not found) → output moderation → related courses. Refusals and not-found are saved replies, not errors.
- LLM default: Anthropic `claude-haiku-5-5`, effort low; switchable with `LLM_PROVIDER`/`LLM_MODEL`. Embeddings: OpenAI `text-embedding-ada-002`.
- Related courses: by meaning (course "name — plan" embeddings cached in memory), trainees see only their own plans' courses with progress.
- Any signed-in user may open a cited SOP file. SOP audit actions: `SOP_UPLOADED`, `SOP_UPDATED`, `SOP_REINDEXED`, `SOP_DELETED`.
- Design differences: no Export button, no "quiz me" tip, no settings gear.
- `RAG_MIN_SIMILARITY` (0.78 for ada-002) is not yet calibrated with real keys.

## Branches

- feature/phase3-rag-spike holds the RAG spike (backend/spikes/rag/). It stays on its own branch and is not merged into dev. Its eval output (last-eval.json) is gitignored. Phase 5 (feature/phase5-chatbot) reuses its chunker, prompt and fake mode in `services/rag/` and `services/ai/`.

## Decisions for Phase 4

Resolved in Phase 4a: audit log = audit_logs table; invite flow = option (a), one-time link plus /set-password, which also serves admin-issued password resets.

- Audit log (FR2): none of the 14 tables is an audit log. Options: add an audit_logs table (documented deviation) or log to a file. Recommendation: add the table.
- Invite flow (FR1): no email service in scope. Options: (a) admin gets a one-time invite link to copy and send manually, leading to a set-password page (reuses the Reset Password screen); (b) admin sets a temporary password. Recommendation: (a). The users table has no invite or active columns, so (a) needs the pending schema change.
- Material uploads (FR7): resolved in Phase 4b — local disk (`backend/uploads/materials/`, gitignored) via multer, with type, size and content checks.
- "Groups" for plan assignment (FR8): resolved in Phase 4b — departments are the groups.
