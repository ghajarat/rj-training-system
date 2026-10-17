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
