-- =====================================================================
-- 003 — Trainee feedback (Phase 4c)
-- Deviations from GP1 are explained in docs/schema-changes.md.
-- Runs once, inside a transaction, via db/migrate.js.
-- =====================================================================

-- FR6: a trainee gives ONE piece of feedback per course and can edit it.
-- GP1 does not stop a second row for the same (trainee, course), which would
-- count that trainee twice in the course's average rating. The constraint
-- makes the database enforce it, and lets the API save with
-- INSERT ... ON CONFLICT (trainee_id, course_id) DO UPDATE.
--
-- Any duplicates from before this rule are removed first, keeping one row
-- per pair (the one with the highest feedback_id, an arbitrary but stable
-- choice: GP1 stores no creation time).
DELETE FROM feedback a
 USING feedback b
 WHERE a.trainee_id = b.trainee_id
   AND a.course_id = b.course_id
   AND a.feedback_id < b.feedback_id;

ALTER TABLE feedback
    ADD CONSTRAINT uq_feedback_trainee_course UNIQUE (trainee_id, course_id);
