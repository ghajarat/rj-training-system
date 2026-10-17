-- =====================================================================
-- 001 — User Management (Phase 4a)
-- Deviations from GP1 are explained in docs/schema-changes.md.
-- Runs once, inside a transaction, via db/migrate.js.
-- =====================================================================

-- FR19: soft deactivation. Accounts are never hard-deleted, so training
-- history (progress, feedback, chat) stays intact.
ALTER TABLE users
    ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- FR1: an invited user has no password until they open their invite link.
-- NULL password_hash = "invitation not accepted yet".
ALTER TABLE users
    ALTER COLUMN password_hash DROP NOT NULL;

-- FR1: one-time setup link (used for invitations and admin-issued password
-- resets). Only the SHA-256 of the token is stored, so a database leak does
-- not expose working links.
ALTER TABLE users
    ADD COLUMN setup_token_hash      CHAR(64)  NULL UNIQUE,
    ADD COLUMN setup_token_expires_at TIMESTAMP NULL,
    ADD CONSTRAINT chk_setup_token_pair
        CHECK ((setup_token_hash IS NULL) = (setup_token_expires_at IS NULL));

-- FR2: audit log of admin actions and sign-ins.
-- action is validated in code (services/audit.js) rather than with a CHECK,
-- so later phases can log new actions without another migration.
CREATE TABLE audit_logs (
    log_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id        UUID NULL REFERENCES users(user_id) ON DELETE SET NULL,
    action          VARCHAR(50) NOT NULL,
    target_user_id  UUID NULL REFERENCES users(user_id) ON DELETE SET NULL,
    details         JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_created      ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_target       ON audit_logs(target_user_id);
-- "Last active" on User Management = latest LOGIN row per actor.
CREATE INDEX idx_audit_actor_action ON audit_logs(actor_id, action, created_at DESC);
