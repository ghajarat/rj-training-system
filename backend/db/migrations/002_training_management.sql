-- =====================================================================
-- 002 — Training Management (Phase 4b)
-- Deviations from GP1 are explained in docs/schema-changes.md.
-- Runs once, inside a transaction, via db/migrate.js.
--
-- GP1 keeps its one-plan-per-course model (courses.plan_id). This file adds
-- only what FR8 cannot do without: an order for the courses in a plan, and a
-- guarantee that a trainee is assigned to a plan at most once.
-- =====================================================================

-- FR8: a plan is an ORDERED list of courses. Position 1 is taken first.
ALTER TABLE courses
    ADD COLUMN sequence_order INT NULL;

-- Number any existing courses 1, 2, 3... inside each plan. GP1 stored no
-- order, so alphabetical is the only stable choice; trainers can reorder.
UPDATE courses c
   SET sequence_order = numbered.n
  FROM (SELECT course_id,
               ROW_NUMBER() OVER (PARTITION BY plan_id ORDER BY course_name, course_id) AS n
          FROM courses) AS numbered
 WHERE numbered.course_id = c.course_id;

-- DEFERRABLE INITIALLY IMMEDIATE: PostgreSQL normally checks a UNIQUE
-- constraint after every row, so swapping positions 1 and 2 in one UPDATE
-- would collide halfway through. A deferrable constraint is checked once,
-- at the end of the statement, so a reorder is a single UPDATE.
ALTER TABLE courses
    ALTER COLUMN sequence_order SET NOT NULL,
    ADD CONSTRAINT chk_course_sequence CHECK (sequence_order >= 1),
    ADD CONSTRAINT uq_course_plan_sequence
        UNIQUE (plan_id, sequence_order) DEFERRABLE INITIALLY IMMEDIATE;

-- FR8: the same trainee cannot be assigned the same plan twice. Checked by
-- the database, so two trainers assigning at the same moment cannot both
-- succeed. Any duplicates from before this rule are removed first (they
-- carry no data of their own: progress is stored per course, not per
-- assignment).
DELETE FROM plan_assignments a
 USING plan_assignments b
 WHERE a.plan_id = b.plan_id
   AND a.trainee_id = b.trainee_id
   AND a.assign_id > b.assign_id;

ALTER TABLE plan_assignments
    ADD CONSTRAINT uq_plan_assignment UNIQUE (plan_id, trainee_id);
