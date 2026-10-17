// Seeds the database with reference data and demo content so the UI has
// something to render. Wipes all existing rows first — dev use only.
//
//   npm run db:seed
//
// Demo logins (password from SEED_PASSWORD in .env, default below):
//   admin@rj.com    → Admin    → User Management
//   trainer@rj.com  → Trainer  → Trainer Overview
//   trainee@rj.com  → Trainee  → My Dashboard
//
// Also creates one pending invitation and one deactivated account so the
// User Management screen shows every status (Phase 4a), plus audit rows.
// Phase 4b: courses are ordered (sequence_order), one links to a web page,
// one has a small demo PDF in uploads/materials/, and one plan is overdue.
require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const db = require('./index');
const { createSetupToken, expirySql, expiresHours } = require('../utils/setupToken');
const materialFiles = require('../services/materialFiles');

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
      TRUNCATE audit_logs, notifications, kpis, chat_messages, chat_sessions, embeddings,
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
    const addUser = async (fullName, email, role, dept, extra = {}) => {
      const { rows } = await client.query(
        `INSERT INTO users (role_id, dept_id, full_name, email, password_hash,
                            is_active)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING user_id`,
        [roles[role], dept ? depts[dept] : null, fullName, email.toLowerCase(),
         extra.passwordHash === undefined ? hash : extra.passwordHash,
         extra.isActive ?? true]);
      return rows[0].user_id;
    };

    const admin    = await addUser('System Administrator', 'admin@rj.com',    'Admin',   'Training & Development');
    const trainer  = await addUser('Rania Haddad',         'trainer@rj.com',  'Trainer', 'Training & Development');
    const trainee  = await addUser('Omar Khalil',          'trainee@rj.com',  'Trainee', 'Cabin Crew');
    const trainee2 = await addUser('Lina Saleh',           'trainee2@rj.com', 'Trainee', 'Customer Service');
    const trainee3 = await addUser('Yousef Nasser',        'trainee3@rj.com', 'Trainee', 'Ground Operations');

    // Invited but has not set a password yet (FR1)
    const invite = createSetupToken();
    const invited = await addUser('Sami Odeh', 'sami.odeh@rj.com', 'Trainee', 'Cabin Crew',
      { passwordHash: null });
    const { rows: [inviteRow] } = await client.query(
      `UPDATE users SET setup_token_hash = $1, setup_token_expires_at = ${expirySql('$2')}
        WHERE user_id = $3 RETURNING setup_token_expires_at`,
      [invite.tokenHash, expiresHours(), invited]);
    // Deactivated account (FR19) — cannot sign in
    const former = await addUser('Huda Mansour', 'huda.mansour@rj.com', 'Trainee', 'Customer Service',
      { isActive: false });

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
      {
        // Due date already passed, so the Trainer screens show an overdue trainee (FR9)
        name: 'Aviation Security Refresher',
        description: 'Screening awareness, access control, and reporting suspicious activity.',
        start: '2026-09-01', end: '2026-10-10',
        courses: [
          ['AVSEC Awareness', 45],
          ['Access Control and Reporting', 30],
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
      for (const [index, [courseName, minutes]] of p.courses.entries()) {
        const c = await client.query(
          `INSERT INTO courses (plan_id, course_name, duration, sequence_order)
           VALUES ($1, $2, $3, $4) RETURNING course_id`,
          [rows[0].plan_id, courseName, minutes, index + 1]);
        courseIds[p.name].push(c.rows[0].course_id);
      }
    }

    // ---- Materials (FR7) ------------------------------------------------
    // Old files belong to courses the TRUNCATE above just removed.
    await materialFiles.removeAllStored();
    materialFiles.ensureDir();
    const pdfName = `${crypto.randomUUID()}.pdf`;
    fs.writeFileSync(path.join(materialFiles.MATERIALS_DIR, pdfName),
      demoPdf('Emergency Evacuation Procedures - demo material'));
    await client.query('UPDATE courses SET material_url = $1 WHERE course_id = $2',
      [materialFiles.toMaterialUrl(pdfName), courseIds['Cabin Safety Recurrent 2026'][0]]);
    await client.query('UPDATE courses SET material_url = $1 WHERE course_id = $2',
      ['https://www.iata.org/en/publications/dgr/', courseIds['Cabin Safety Recurrent 2026'][3]]);

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
    await assign(trainee,  'Aviation Security Refresher', [100, 100]);  // finished on time
    await assign(trainee,  'Ground Handling Fundamentals', [0, 0]);    // starts 1 Nov: upcoming (Phase 4c)
    await assign(trainee3, 'Aviation Security Refresher', [100, 20]);   // overdue

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

    // ---- Audit log (FR2) ----------------------------------------------
    const hoursAgo = h => new Date(Date.now() - h * 3600000);
    const auditRows = [
      [admin, 'USER_INVITED',     former,   { email: 'huda.mansour@rj.com', role: 'Trainee' }, 24 * 20],
      [admin, 'USER_DEACTIVATED', former,   {}, 24 * 3],
      [admin, 'USER_INVITED',     invited,  { email: 'sami.odeh@rj.com', role: 'Trainee' }, 5],
      [trainer, 'PLAN_CREATED',  null,     { planId: planIds['Aviation Security Refresher'], planName: 'Aviation Security Refresher' }, 24 * 40],
      [trainer, 'PLAN_ASSIGNED', trainee3, { planId: planIds['Aviation Security Refresher'], planName: 'Aviation Security Refresher', via: 'individual' }, 24 * 39],
      [trainee3, 'LOGIN', trainee3, {}, 24 * 2],
      [trainee2, 'LOGIN', trainee2, {}, 26],
      [trainer,  'LOGIN', trainer,  {}, 3],
      [trainee,  'LOGIN', trainee,  {}, 2],
      [admin,    'LOGIN', admin,    {}, 1],
    ];
    for (const [actor, action, target, details, hours] of auditRows) {
      await client.query(
        `INSERT INTO audit_logs (actor_id, action, target_user_id, details, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [actor, action, target, JSON.stringify(details), hoursAgo(hours)]);
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
      SELECT 'notifications', COUNT(*) FROM notifications UNION ALL
      SELECT 'audit_logs', COUNT(*) FROM audit_logs`);
    console.log('Seed complete:');
    counts.rows.forEach(r => console.log(`  ${r.t.padEnd(18)} ${r.count}`));
    console.log(`\nDemo logins (password: ${SEED_PASSWORD})`);
    console.log('  admin@rj.com / trainer@rj.com / trainee@rj.com / trainee2@rj.com / trainee3@rj.com');
    console.log('  huda.mansour@rj.com is deactivated and cannot sign in.');
    console.log(`\nDemo invitation for sami.odeh@rj.com (valid until ${inviteRow.setup_token_expires_at.toLocaleString()}):`);
    console.log(`  ${invite.url}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// A one-page PDF with a line of text, so the demo has a real file to open.
// Built by hand (no PDF library): the xref table needs each object's byte
// offset, which is why the parts are measured as they are joined.
function demoPdf(text) {
  const stream = `BT /F1 18 Tf 72 720 Td (${text.replace(/[()\\]/g, '')}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => {
    const offset = pdf.length;
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

main()
  .catch(err => {
    console.error('Seed failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
