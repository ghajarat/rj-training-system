// Seeds the database with reference data and demo content so the UI has
// something to render. Wipes all existing rows first — dev use only.
//
//   npm run db:seed
//
// Demo logins (password from SEED_PASSWORD in .env, default below):
//   admin@rj.com    → Admin    → User Management
//   trainer@rj.com  → Trainer  → Trainer Overview
//   trainee@rj.com  → Trainee  → My Dashboard
require('dotenv').config();
const bcrypt = require('bcrypt');
const db = require('./index');

const SEED_PASSWORD = process.env.SEED_PASSWORD || 'RJtraining#2026';
const BCRYPT_ROUNDS = 12;

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed a production database.');
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    await client.query(`
      TRUNCATE notifications, kpis, chat_messages, chat_sessions, embeddings,
               documents, feedback, progress, courses, plan_assignments,
               training_plans, users, departments, roles
      RESTART IDENTITY CASCADE`);

    // ---- Roles ---------------------------------------------------------
    const roles = {};
    for (const name of ['Trainee', 'Trainer', 'Admin']) {
      const { rows } = await client.query(
        'INSERT INTO roles (role_name) VALUES ($1) RETURNING role_id', [name]);
      roles[name] = rows[0].role_id;
    }

    // ---- Departments ---------------------------------------------------
    const depts = {};
    for (const name of ['Cabin Crew', 'Ground Operations', 'Customer Service', 'Training & Development']) {
      const { rows } = await client.query(
        'INSERT INTO departments (dept_name) VALUES ($1) RETURNING dept_id', [name]);
      depts[name] = rows[0].dept_id;
    }

    // ---- Users ---------------------------------------------------------
    const hash = await bcrypt.hash(SEED_PASSWORD, BCRYPT_ROUNDS);
    const addUser = async (fullName, email, role, dept) => {
      const { rows } = await client.query(
        `INSERT INTO users (role_id, dept_id, full_name, email, password_hash)
         VALUES ($1, $2, $3, $4, $5) RETURNING user_id`,
        [roles[role], dept ? depts[dept] : null, fullName, email.toLowerCase(), hash]);
      return rows[0].user_id;
    };

    const admin    = await addUser('System Administrator', 'admin@rj.com',    'Admin',   'Training & Development');
    const trainer  = await addUser('Rania Haddad',         'trainer@rj.com',  'Trainer', 'Training & Development');
    const trainee  = await addUser('Omar Khalil',          'trainee@rj.com',  'Trainee', 'Cabin Crew');
    const trainee2 = await addUser('Lina Saleh',           'trainee2@rj.com', 'Trainee', 'Customer Service');
    const trainee3 = await addUser('Yousef Nasser',        'trainee3@rj.com', 'Trainee', 'Ground Operations');

    await client.query(
      'UPDATE departments SET manager_id = $1 WHERE dept_id = $2',
      [trainer, depts['Training & Development']]);

    // ---- Training plans + courses -------------------------------------
    const plans = [
      {
        name: 'Cabin Safety Recurrent 2026',
        description: 'Annual recurrent training covering emergency procedures, evacuation, and first aid.',
        start: '2026-10-01', end: '2026-12-31',
        courses: [
          ['Emergency Evacuation Procedures', 90],
          ['Fire Fighting On Board', 60],
          ['In-Flight First Aid', 75],
          ['Dangerous Goods Awareness', 45],
        ],
      },
      {
        name: 'Customer Service Excellence',
        description: 'Service standards, handling disruptions, and communicating with passengers.',
        start: '2026-10-15', end: '2026-11-30',
        courses: [
          ['RJ Service Standards', 40],
          ['Managing Flight Disruptions', 50],
          ['Handling Passenger Complaints', 35],
        ],
      },
      {
        name: 'Ground Handling Fundamentals',
        description: 'Ramp safety, baggage handling, and turnaround coordination.',
        start: '2026-11-01', end: '2027-01-31',
        courses: [
          ['Ramp Safety Essentials', 60],
          ['Aircraft Turnaround Coordination', 70],
        ],
      },
    ];

    const courseIds = {};   // plan name → [course_id, ...]
    const planIds = {};
    for (const p of plans) {
      const { rows } = await client.query(
        `INSERT INTO training_plans (created_by, plan_name, description, start_date, end_date)
         VALUES ($1, $2, $3, $4, $5) RETURNING plan_id`,
        [trainer, p.name, p.description, p.start, p.end]);
      planIds[p.name] = rows[0].plan_id;
      courseIds[p.name] = [];
      for (const [courseName, minutes] of p.courses) {
        const c = await client.query(
          `INSERT INTO courses (plan_id, course_name, duration) VALUES ($1, $2, $3) RETURNING course_id`,
          [rows[0].plan_id, courseName, minutes]);
        courseIds[p.name].push(c.rows[0].course_id);
      }
    }

    // ---- Assignments + progress ---------------------------------------
    const assign = async (traineeId, planName, completions) => {
      const allDone = completions.every(pct => pct === 100);
      await client.query(
        `INSERT INTO plan_assignments (plan_id, trainee_id, status) VALUES ($1, $2, $3)`,
        [planIds[planName], traineeId, allDone ? 'completed' : 'active']);
      for (let i = 0; i < completions.length; i++) {
        await client.query(
          `INSERT INTO progress (trainee_id, course_id, completion_pct, last_accessed)
           VALUES ($1, $2, $3, $4)`,
          [traineeId, courseIds[planName][i], completions[i],
           completions[i] > 0 ? new Date(Date.now() - i * 86400000) : null]);
      }
    };

    await assign(trainee,  'Cabin Safety Recurrent 2026', [100, 100, 60, 0]);
    await assign(trainee,  'Customer Service Excellence', [30, 0, 0]);
    await assign(trainee2, 'Customer Service Excellence', [100, 100, 100]);
    await assign(trainee3, 'Ground Handling Fundamentals', [45, 0]);

    // ---- Feedback (sentiment_score left NULL for the AI module) -------
    const cabin = courseIds['Cabin Safety Recurrent 2026'];
    const service = courseIds['Customer Service Excellence'];
    const fb = [
      [trainee,  cabin[0],   5, 'Very clear walkthrough of the evacuation drills. The video scenarios helped a lot.'],
      [trainee,  cabin[1],   3, 'Content was fine but the practical part felt rushed.'],
      [trainee2, service[0], 4, 'Good overview of the service standards.'],
      [trainee2, service[1], 2, 'Too theoretical — I wanted more real disruption cases.'],
      [trainee2, service[2], 5, null],
    ];
    for (const row of fb) {
      await client.query(
        `INSERT INTO feedback (trainee_id, course_id, rating, comment) VALUES ($1, $2, $3, $4)`, row);
    }

    // ---- KPIs (before/after for the Analytics & ROI dashboard) --------
    const kpis = [
      ['Cabin Crew',        'Safety incidents (per quarter)',  12,  7],
      ['Cabin Crew',        'Compliance audit pass rate (%)',  84,  93],
      ['Customer Service',  'Customer satisfaction (CSAT %)',  78,  86],
      ['Ground Operations', 'On-time service delivery (%)',    81,  null],
    ];
    for (const [dept, name, before, after] of kpis) {
      await client.query(
        `INSERT INTO kpis (dept_id, kpi_name, value_before, value_after) VALUES ($1, $2, $3, $4)`,
        [depts[dept], name, before, after]);
    }

    // ---- Notifications ------------------------------------------------
    const notes = [
      [trainee,  'You have been assigned "Customer Service Excellence".', false],
      [trainee,  '"In-Flight First Aid" is 60% complete — keep going.',   false],
      [trainee2, 'Congratulations! You completed "Customer Service Excellence".', true],
      [trainer,  'Lina Saleh submitted feedback on "Managing Flight Disruptions".', false],
    ];
    for (const row of notes) {
      await client.query(
        `INSERT INTO notifications (user_id, message, is_read) VALUES ($1, $2, $3)`, row);
    }

    await client.query('COMMIT');

    const counts = await db.query(`
      SELECT 'roles' t, COUNT(*) FROM roles UNION ALL
      SELECT 'departments', COUNT(*) FROM departments UNION ALL
      SELECT 'users', COUNT(*) FROM users UNION ALL
      SELECT 'training_plans', COUNT(*) FROM training_plans UNION ALL
      SELECT 'courses', COUNT(*) FROM courses UNION ALL
      SELECT 'plan_assignments', COUNT(*) FROM plan_assignments UNION ALL
      SELECT 'progress', COUNT(*) FROM progress UNION ALL
      SELECT 'feedback', COUNT(*) FROM feedback UNION ALL
      SELECT 'kpis', COUNT(*) FROM kpis UNION ALL
      SELECT 'notifications', COUNT(*) FROM notifications`);
    console.log('Seed complete:');
    counts.rows.forEach(r => console.log(`  ${r.t.padEnd(18)} ${r.count}`));
    console.log(`\nDemo logins (password: ${SEED_PASSWORD})`);
    console.log('  admin@rj.com / trainer@rj.com / trainee@rj.com');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

main()
  .catch(err => {
    console.error('Seed failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
