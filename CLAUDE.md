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
| `config.js` | Loads `.env` once and fails fast if `DATABASE_URL` / `JWT_SECRET` are missing or the secret is under 32 chars. Exposes `port`, `clientOrigin`, `jwt`, `login` (lock settings). |
| `db/index.js` | Shared `pg` Pool. Use `db.query(text, params)`; use `db.getClient()` + `BEGIN/COMMIT/ROLLBACK` for transactions. |
| `db/schema.sql` | The 14 GP1 tables, FK indexes, unique `progress(trainee_id, course_id)`, HNSW cosine index on `embeddings`. Idempotent (`IF NOT EXISTS`). |
| `db/migrate.js` | Applies `schema.sql`, then each not-yet-run file in `db/migrations/` in its own transaction, recorded in `schema_migrations`. `--reset` drops all tables first; refuses in production. |
| `db/migrations/001_user_management.sql` | Phase 4a: `users.is_active`, nullable `password_hash`, `setup_token_hash/_expires_at`, `audit_logs` table. Explained in `docs/schema-changes.md`. |
| `db/seed.js` | Truncates everything, then inserts roles, 4 departments, 7 users (incl. one pending invite and one deactivated), 3 plans with courses, assignments, progress, feedback, KPIs, notifications, audit rows. Prints a demo invite link. Refuses in production. |
| `middleware/auth.js` | `authenticate` (Bearer JWT, then loads current role + `is_active` from the DB every request → `req.user = { id, role, name }`; 401 `ACCOUNT_DEACTIVATED`) and `authorize(...roles)` (403 if role not allowed). |
| `routes/auth.js` | `POST /api/auth/login` → `{ token, user }` (403 `ACCOUNT_DEACTIVATED`, logs LOGIN / LOGIN_FAILED); `GET /api/auth/me`; public `POST /api/auth/setup/verify` and `POST /api/auth/setup` (one-time invite / reset links). |
| `routes/users.js` | Admin only. `GET /` (search, role, departmentId, status, page, pageSize), `POST /` (invite), `GET/PATCH /:id`, `POST /:id/setup-link`, `/:id/deactivate`, `/:id/reactivate`. Self-deactivate, self-role-change and last-active-admin guards. |
| `routes/departments.js` | `GET /api/departments` → `{ departments }`, Admin only. |
| `routes/auditLogs.js` | `GET /api/audit-logs` (action, userId, search, from, to, page), Admin only, read-only. |
| `services/users.js` | `USER_SELECT` (with derived `status` and `last_active_at`), `toUserDto` (the one user shape sent to the frontend; never includes secrets), `findUserById`. |
| `services/audit.js` | `ACTIONS` and `record(client, { actorId, action, targetUserId, details })` — call with the transaction's client. |
| `utils/setupToken.js` | Random one-time token, its SHA-256, the link URL, and `expirySql()` (expiry uses the DB clock). |
| `utils/validate.js` | `requireUuid`, `parsePagination`, `paginationDto`, `likePattern`, `isDate`, `EMAIL_RE`. |
| `test/userManagement.test.js` | `npm test`: node:test + supertest, 62 tests. **Re-seeds the dev database.** |
| `services/loginAttempts.js` | In-memory failed-login counter and temporary lock (resets on server restart). |
| `utils/httpError.js` | `throw new HttpError(status, code, message)` from any route; `app.js` turns it into the JSON error response. |
| `utils/jwt.js` | `signToken(userRow)` / `verifyToken(token)` — HS256, issuer `rj-training-system`, payload `{ sub, role, name }`. |
| `utils/password.js` | `hashPassword` / `verifyPassword` (bcrypt, 12 rounds) with a dummy hash so unknown emails take as long as wrong passwords; `checkPasswordStrength` (10–72 chars, letter + digit). |
| `.env.example` | `PORT`, `DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `CLIENT_ORIGIN` (also the base of invite links), `LOGIN_MAX_ATTEMPTS`, `LOGIN_LOCK_MINUTES`, `INVITE_EXPIRES_HOURS`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `SEED_PASSWORD`. |

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
| `src/components/` | Shared UI: `Button` (primary/accent/secondary/ghost/danger, sm/md, icon, loading), `Input` (label, icon, error/hint, password toggle), `Select`, `Modal` (native `<dialog>`), `ConfirmDialog`, `Badge` (tones), `Menu` (row action dropdown), `Pagination`, `Icon` (inline SVG set — add paths to `PATHS`), `BrandMark`. |
| `src/hooks/` | `useFetch(url, params)` → `{ data, error, loading, reload }` (ignores stale responses; null url = skip); `useDebouncedValue`. |
| `src/api/admin.js` | User-management and set-password API calls. |
| `src/utils/format.js` | `initials`, `formatDate`, `formatDateTime`, `timeAgo`, `plural`. |
| `src/pages/` | `SignIn`, `ForgotPassword` (tells users to ask an admin for a reset link), `SetPassword`, `MyDashboard`, `TrainerOverview` (shells), `ComingSoon`, `PageHeader`, shared `pages.css` (card, panel, stat-grid, table, empty-state, inline-error/success, modal-form, hide-sm). |
| `src/pages/admin/` | `UserManagement` (+ `InviteUserModal`, `EditUserModal`, `SetupLinkModal`, `UserBadges`, `userOptions`), `AuditLog` (+ `auditLabels`), `admin.css`. |
| `src/styles/` | `tokens.css` (design tokens), `global.css`. |
| `.env.example` | `VITE_API_URL=http://localhost:5000/api` |

### Commands (PowerShell, run each one on its own)

First-time setup: copy `backend/.env.example` → `backend/.env` and `frontend/.env.example` → `frontend/.env`, fill in `DATABASE_URL` and `JWT_SECRET`, then `npm install` in each folder.

From `backend/`:

- `npm run dev` — API with nodemon on http://localhost:5000 (there is no `start` script)
- `npm run db:migrate` — create any missing tables/indexes (safe to re-run)
- `npm run db:seed` — wipe all rows and load demo data
- `npm run db:reset` — drop all tables, migrate, then seed (dev only)

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
- SOP Library (Admin): keep, with a placeholder page saying it arrives in Phase 5 (FR13).
- System Health (Admin): keep, with a placeholder page saying it arrives in Phase 8 (reports).
- My Trainees (Trainer): built in Phase 4b as part of progress monitoring (FR9).
- Achievements and Schedule: removed. They are not in any requirement.

## Branches

- feature/phase3-rag-spike holds the RAG spike (backend/spikes/rag/). It stays on its own branch and is not merged into dev. Its eval output (last-eval.json) is gitignored.

## Decisions for Phase 4

Resolved in Phase 4a: audit log = audit_logs table; invite flow = option (a), one-time link plus /set-password, which also serves admin-issued password resets.

- Audit log (FR2): none of the 14 tables is an audit log. Options: add an audit_logs table (documented deviation) or log to a file. Recommendation: add the table.
- Invite flow (FR1): no email service in scope. Options: (a) admin gets a one-time invite link to copy and send manually, leading to a set-password page (reuses the Reset Password screen); (b) admin sets a temporary password. Recommendation: (a). The users table has no invite or active columns, so (a) needs the pending schema change.
- Material uploads (FR7): local disk (e.g. backend/uploads/, gitignored) via multer, metadata in the DB. Restrict file types and size.
- "Groups" for plan assignment (FR8): use departments as groups unless the schema says otherwise.
