# Schema changes from GP1

`backend/db/schema.sql` is the GP1 baseline (Tables 16–29, 14 tables). Every
change after it is a numbered file in `backend/db/migrations/`, applied once and
in order by `npm run db:migrate`. This file explains each deviation for the GP2
document.

---

## 001_user_management.sql — Phase 4a (User Management)

Approved by the team before implementation.

| Change | Why |
|---|---|
| `users.is_active BOOLEAN NOT NULL DEFAULT TRUE` | **FR19** requires deactivating accounts. A hard `DELETE` would cascade through `progress`, `feedback`, `plan_assignments` and `chat_sessions` (all `ON DELETE CASCADE`) and erase training history that Analytics & ROI needs. A flag keeps the history and makes reactivation possible. |
| `users.password_hash` becomes **nullable** | **FR1** is invite-only: an admin creates the account, then the employee chooses their own password. Between those two moments there is no password. `NULL` is the honest value. Storing a fake placeholder hash would have hidden the state. Sign-in still runs bcrypt against a dummy hash when the column is NULL, so response timing gives nothing away. |
| `users.setup_token_hash CHAR(64) NULL UNIQUE`, `users.setup_token_expires_at TIMESTAMP NULL`, `CHECK` that both are set or both are NULL | **FR1** without an email service: the admin gets a one-time link to send manually (decision (a) in planning). Only the SHA-256 of the token is stored, so a database leak gives no working links. The same two columns serve admin-issued password-reset links, which is why they are named "setup" rather than "invite". There is one active link per user, and issuing a new one replaces the old one. A separate tokens table would have been more normalised, but it would store history nobody reads. |
| New table `audit_logs (log_id, actor_id → users, action, target_user_id → users, details JSONB, created_at)` with indexes on `created_at`, `target_user_id`, `(actor_id, action, created_at)` | **FR2** needs an audit log of admin actions, and none of the 14 GP1 tables can hold one. It records invitations, edits (with from→to values), deactivations, reactivations, setup links, password set, and sign-ins (successful and failed, real accounts only). The FKs use `ON DELETE SET NULL` so log rows outlive the users they mention. `action` is checked in code (`services/audit.js`) rather than by a `CHECK` constraint, so later phases can add actions without a migration. |
| "Last active" on User Management is **derived**, with no new column | It is the newest `LOGIN` row for that user in `audit_logs`. The `(actor_id, action, created_at)` index keeps the lookup fast. A `last_login_at` column would duplicate data the log already has. |
| Account status is **derived**, with no status column | `inactive` when `is_active` is false. `invited` when there is no password and a valid link. `invite_expired` when there is no password and the link has expired. Otherwise `active`. Computed in SQL (`services/users.js`), so it can never drift out of sync. |

### Bookkeeping table (not domain data)

`schema_migrations (filename PK, applied_at)` is created by the migration
runner (`db/migrate.js`) to record which files in `db/migrations/` have run. It
holds no application data and is not part of the GP1 ER model.

### Table count after 001

14 GP1 tables + `audit_logs` + `schema_migrations` = 16 tables.

---

## 002_training_management.sql — Phase 4b (Training Management)

Approved by the team before implementation. The goal was the smallest change
that makes FR7–FR9 possible, so GP1's model is kept: **a course belongs to
exactly one plan** (`courses.plan_id`). A link table (`plan_courses`) was
considered and rejected: it would let one course appear in several plans, but
no requirement asks for that, and it would have meant dropping a GP1 column.
The cost of this choice: using the same material in two plans means two
course rows, each with its own copy of the file and its own progress.

| Change | Why |
|---|---|
| `courses.sequence_order INT NOT NULL`, `CHECK (sequence_order >= 1)` | **FR8**: a training plan is an *ordered* list of courses, and GP1 stores no order. Existing rows were numbered alphabetically within each plan. |
| `UNIQUE (plan_id, sequence_order)` on `courses`, `DEFERRABLE INITIALLY IMMEDIATE` | Two courses cannot share a position. Deferrable because PostgreSQL otherwise checks a unique constraint row by row, and a reorder that swaps positions 1 and 2 in a single `UPDATE` would collide halfway through. Deferred, it is checked once at the end of the statement. |
| `UNIQUE (plan_id, trainee_id)` on `plan_assignments` | **FR8** says to prevent duplicate assignments. A check in code alone can be beaten by two trainers assigning at the same moment; the constraint cannot. The API uses `INSERT ... ON CONFLICT DO NOTHING` and reports who was already assigned. |

### What is deliberately *not* a schema change

| Need | How it is met with the GP1 columns |
|---|---|
| Material type (PDF, DOCX, PPTX, MP4, link) | Derived from `courses.material_url`: `https://...` is a link; `upload:<uuid>.<ext>` is a file in `backend/uploads/materials/`, and its extension is the type. |
| Plan due date | `training_plans.end_date`. |
| Completion %, last activity, overdue (**FR9**) | Computed from `progress` in `services/progress.js`: the average of the plan's courses (a course with no progress row counts as 0%), the newest `progress.last_accessed`, and overdue = `end_date` has passed and completion is under 100%. Nothing is stored, so it cannot go stale. |
| Who created / changed a course | Recorded in `audit_logs` (`COURSE_CREATED`, `COURSE_UPDATED`, ...). Plans already have `training_plans.created_by`. |

`plan_assignments.status` (GP1) is not updated by Phase 4b; the trainee side
(Phase 4c) owns course completion. The Trainer screens show the derived
status from `services/progress.js`.

### Table count after 002

Unchanged: 14 GP1 tables + `audit_logs` + `schema_migrations` = 16 tables.
