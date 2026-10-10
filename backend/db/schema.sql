-- =====================================================================
-- Royal Jordanian Training System — Database Schema
-- PostgreSQL 13+ with the pgvector extension
--
-- Mirrors GP1 Section 4.1.3, Tables 16–29 (14 tables, 3NF).
-- UUID primary keys are generated with gen_random_uuid() (built into PG 13+).
-- Documented denormalization: feedback.sentiment_score (GP1 Table 33).
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- ---------------------------------------------------------------------
-- USER MANAGEMENT
-- ---------------------------------------------------------------------

-- Table 16: Roles
CREATE TABLE IF NOT EXISTS roles (
    role_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_name   VARCHAR(50) NOT NULL UNIQUE
                CHECK (role_name IN ('Trainee', 'Trainer', 'Admin'))
);

-- Table 17: Departments
-- manager_id → users is added further down, after users exists
-- (departments and users reference each other).
CREATE TABLE IF NOT EXISTS departments (
    dept_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dept_name   VARCHAR(100) NOT NULL UNIQUE,
    manager_id  UUID NULL
);

-- Table 18: Users
CREATE TABLE IF NOT EXISTS users (
    user_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_id        UUID NOT NULL REFERENCES roles(role_id) ON DELETE RESTRICT,
    dept_id        UUID NULL     REFERENCES departments(dept_id) ON DELETE SET NULL,
    full_name      VARCHAR(100) NOT NULL,
    email          VARCHAR(255) NOT NULL UNIQUE,   -- UNIQUE also creates the index
    password_hash  VARCHAR(255) NOT NULL,          -- bcrypt
    created_at     TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- Close the departments ↔ users loop
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_departments_manager'
    ) THEN
        ALTER TABLE departments
            ADD CONSTRAINT fk_departments_manager
            FOREIGN KEY (manager_id) REFERENCES users(user_id) ON DELETE SET NULL;
    END IF;
END $$;

-- ---------------------------------------------------------------------
-- KNOWLEDGE & TRAINING
-- ---------------------------------------------------------------------

-- Table 19: Training_Plans
CREATE TABLE IF NOT EXISTS training_plans (
    plan_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_by   UUID NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    plan_name    VARCHAR(150) NOT NULL,
    description  TEXT NULL,
    start_date   DATE NOT NULL,
    end_date     DATE NOT NULL,
    CONSTRAINT chk_plan_dates CHECK (end_date >= start_date)
);

-- Table 20: Plan_Assignments
CREATE TABLE IF NOT EXISTS plan_assignments (
    assign_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id        UUID NOT NULL REFERENCES training_plans(plan_id) ON DELETE CASCADE,
    trainee_id     UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    assigned_date  DATE NOT NULL DEFAULT CURRENT_DATE,
    status         VARCHAR(20) NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'completed'))
);

-- Table 21: Courses
CREATE TABLE IF NOT EXISTS courses (
    course_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id       UUID NOT NULL REFERENCES training_plans(plan_id) ON DELETE CASCADE,
    course_name   VARCHAR(150) NOT NULL,
    material_url  VARCHAR(500) NULL,
    duration      INT NULL                         -- minutes
);

-- Table 22: Progress
CREATE TABLE IF NOT EXISTS progress (
    progress_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trainee_id      UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    course_id       UUID NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
    completion_pct  INT  NOT NULL DEFAULT 0
                    CHECK (completion_pct BETWEEN 0 AND 100),
    last_accessed   TIMESTAMP NULL
);

-- Table 23: Feedback
CREATE TABLE IF NOT EXISTS feedback (
    feedback_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trainee_id       UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    course_id        UUID NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
    rating           INT  NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment          TEXT NULL,
    sentiment_score  FLOAT NULL                    -- computed by the AI module
);

-- Table 24: Documents
CREATE TABLE IF NOT EXISTS documents (
    doc_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    uploaded_by  UUID NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    doc_name     VARCHAR(255) NOT NULL,
    file_url     VARCHAR(500) NOT NULL,
    upload_date  TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Table 25: Embeddings
CREATE TABLE IF NOT EXISTS embeddings (
    embed_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    doc_id       UUID NOT NULL REFERENCES documents(doc_id) ON DELETE CASCADE,
    vector_data  VECTOR(1536) NOT NULL,            -- text-embedding-ada-002
    chunk_text   TEXT NOT NULL
);

-- ---------------------------------------------------------------------
-- ANALYTICS & CHATBOT
-- ---------------------------------------------------------------------

-- Table 26: Chat_Sessions
CREATE TABLE IF NOT EXISTS chat_sessions (
    session_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    started_at  TIMESTAMP  NOT NULL DEFAULT NOW(),
    language    VARCHAR(5) NOT NULL DEFAULT 'EN' CHECK (language IN ('EN'))
);

-- Table 27: Chat_Messages
CREATE TABLE IF NOT EXISTS chat_messages (
    message_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id    UUID NOT NULL REFERENCES chat_sessions(session_id) ON DELETE CASCADE,
    sender_role   VARCHAR(20) NOT NULL CHECK (sender_role IN ('user', 'bot')),
    message_text  TEXT NOT NULL,
    created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Table 28: KPIs
CREATE TABLE IF NOT EXISTS kpis (
    kpi_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dept_id       UUID NOT NULL REFERENCES departments(dept_id) ON DELETE CASCADE,
    kpi_name      VARCHAR(100) NOT NULL,
    value_before  FLOAT NULL,
    value_after   FLOAT NULL
);

-- Table 29: Notifications
CREATE TABLE IF NOT EXISTS notifications (
    notif_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id   UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    message   TEXT NOT NULL,
    is_read   BOOLEAN NOT NULL DEFAULT FALSE
);

-- ---------------------------------------------------------------------
-- INDEXES
-- PostgreSQL does not index foreign keys automatically. These cover the
-- lookups the dashboards and chatbot will run most often.
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_users_role            ON users(role_id);
CREATE INDEX IF NOT EXISTS idx_users_dept            ON users(dept_id);
CREATE INDEX IF NOT EXISTS idx_assignments_trainee   ON plan_assignments(trainee_id);
CREATE INDEX IF NOT EXISTS idx_assignments_plan      ON plan_assignments(plan_id);
CREATE INDEX IF NOT EXISTS idx_courses_plan          ON courses(plan_id);
CREATE INDEX IF NOT EXISTS idx_progress_trainee      ON progress(trainee_id);
CREATE INDEX IF NOT EXISTS idx_progress_course       ON progress(course_id);
CREATE INDEX IF NOT EXISTS idx_feedback_course       ON feedback(course_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_doc        ON embeddings(doc_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user    ON chat_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_kpis_dept             ON kpis(dept_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user    ON notifications(user_id, is_read);

-- A trainee should have one progress row per course
CREATE UNIQUE INDEX IF NOT EXISTS uq_progress_trainee_course
    ON progress(trainee_id, course_id);

-- Approximate nearest-neighbour search for RAG retrieval (cosine distance).
-- Query with:  ORDER BY vector_data <=> $1 LIMIT k
CREATE INDEX IF NOT EXISTS idx_embeddings_vector
    ON embeddings USING hnsw (vector_data vector_cosine_ops);
