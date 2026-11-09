// Phase 7 demo cohort: adds 36 more trainees (with their progress, feedback,
// AI Assistant questions and logins) and three more KPIs, so Trainer
// Overview and Analytics & ROI have a realistic amount of data to show.
//
//   npm run db:seed        (runs db/seed.js, then this file)
//
// ALL OF THIS IS INVENTED DEMO DATA. It is generated, not random: a seeded
// number generator gives the same cohort every time, so the demo and the
// screenshots in the GP2 document always match.
//
// It is kept apart from db/seed.js on purpose: the automated tests run
// db/seed.js alone and assert exact counts, so they never see this cohort.
// After `npm test`, run `npm run db:seed` again to get the cohort back.
//
// What it adds:
//   - 36 trainees: Cabin Crew 16, Customer Service 10, Ground Operations 10
//     (sign in with the same seed password, e.g. reem.abbadi@rj.com)
//   - one more plan for Ground Operations (Ramp Operations Safety)
//   - assignments and progress that depend on how far each plan has run and
//     on an "engagement" level per trainee, so a few trainees fall behind
//   - feedback with ratings and comments; the comments' sentiment_score is
//     pre-filled (the 4 comments from db/seed.js are left for the AI to score)
//   - AI Assistant sessions from the last 30 days, linked to courses, so
//     Trainer Overview shows knowledge gaps
//   - LOGIN rows in audit_logs (User Management "Last active")
require('dotenv').config();
const bcrypt = require('bcrypt');
const db = require('./index');

const SEED_PASSWORD = process.env.SEED_PASSWORD || 'RJtraining#2026';
const DAY = 86400000;

// mulberry32: a tiny seeded random number generator (same numbers every run)
function generator(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = generator(2026);
const between = (min, max) => min + random() * (max - min);
const intBetween = (min, max) => Math.floor(between(min, max + 1));
const chance = p => random() < p;
const pick = list => list[Math.floor(random() * list.length)];
const daysAgo = d => new Date(Date.now() - d * DAY);

const TRAINEES = {
  'Cabin Crew': [
    'Reem Abbadi', 'Tariq Haddad', 'Dana Qasem', 'Faris Zoubi', 'Noor Hijazi', 'Khaled Masri',
    'Rasha Nimri', 'Hamza Obeidat', 'Leen Tawil', 'Bashar Khoury', 'Sara Majali', 'Yazan Rawashdeh',
    'Maya Shami', 'Anas Bataineh', 'Hala Sweis', 'Omar Fayez',
  ],
  'Customer Service': [
    'Rana Daoud', 'Zaid Hourani', 'Tala Kawar', 'Ibrahim Saadeh', 'Lama Hamdan', 'Mohammad Ayyoub',
    'Jana Qudah', 'Saif Azzam', 'Ruba Shboul', 'Kareem Nabulsi',
  ],
  'Ground Operations': [
    'Ahmad Momani', 'Laith Jaber', 'Hadeel Smadi', 'Mahmoud Tamimi', 'Wael Khasawneh', 'Ali Zu\'bi',
    'Nour Shdeifat', 'Fadi Halaseh', 'Osama Qaisi', 'Raed Hammouri',
  ],
};

// Plans each department is assigned, by plan name.
const DEPARTMENT_PLANS = {
  'Cabin Crew': ['Cabin Safety Recurrent 2026', 'Aviation Security Refresher'],
  'Customer Service': ['Customer Service Excellence', 'Aviation Security Refresher'],
  'Ground Operations': ['Ramp Operations Safety', 'Aviation Security Refresher'],
};

const NEW_PLAN = {
  name: 'Ramp Operations Safety',
  description: 'Marshalling, foreign object debris (FOD) prevention and safe fuelling on the apron.',
  start: -28, end: 24,
  courses: [['Marshalling and Hand Signals', 40], ['FOD Prevention', 30], ['Fuelling Safety Procedures', 45]],
};

// Average star rating per course, so some courses are clearly liked and
// others clearly need work (that is the story the dashboards should tell).
const COURSE_QUALITY = {
  'Emergency Evacuation Procedures': 4.6,
  'Fire Fighting On Board': 4.3,
  'In-Flight First Aid': 4.4,
  'Dangerous Goods Awareness': 3.1,
  'RJ Service Standards': 4.2,
  'Managing Flight Disruptions': 2.8,
  'Handling Passenger Complaints': 3.9,
  'AVSEC Awareness': 3.8,
  'Access Control and Reporting': 3.4,
  'Marshalling and Hand Signals': 4.4,
  'FOD Prevention': 4.0,
  'Fuelling Safety Procedures': 3.5,
};

const COMMENTS = {
  positive: [
    'Clear and well structured. The scenarios felt close to what we see on the line.',
    'Practical and to the point. I feel more confident handling this on a real flight.',
    'The video examples were excellent, much better than reading the manual alone.',
    'Good pace, and the checklists at the end of each section are really useful.',
    'Great refresher. It answered the questions I still had from last year.',
    'Very relevant to daily work. I would recommend it to new joiners.',
    'Short, focused and easy to follow during a layover.',
    'The step-by-step recaps helped me remember the key actions.',
  ],
  neutral: [
    'Content is fine, but much of it repeats last year\'s version.',
    'Useful overall. Some sections could be shorter.',
    'Okay as a refresher. I expected a few more practical examples.',
    'Covers the basics. The slides are a bit dense on a phone.',
  ],
  negative: [
    'Too theoretical. I wanted more real cases from our own operation.',
    'The module felt rushed and the practical part was missing.',
    'Too long for what it covers, and some references look outdated.',
    'Hard to follow on a phone; the diagrams are too small to read.',
    'A few steps differ from the current SOP, which was confusing.',
  ],
};
// Course-specific complaints, so the low ratings have a visible reason.
const COURSE_COMPLAINTS = {
  'Dangerous Goods Awareness': [
    'The lithium battery limits were confusing. A table with clear examples would help.',
    'Too much text on battery watt-hours and not enough examples of real bags.',
  ],
  'Managing Flight Disruptions': [
    'Needs real disruption cases, like rebooking a full flight during a long delay.',
    'Nothing on what we can actually offer passengers when a flight is delayed.',
  ],
};
const SCORE_RANGE = { positive: [0.45, 0.92], neutral: [-0.15, 0.2], negative: [-0.88, -0.35] };

// AI Assistant questions. course = the course the answer is linked to.
// outcome 'not_found' = the SOP library had no answer (no citation).
const QUESTIONS = [
  {
    course: 'Dangerous Goods Awareness', askers: { 'Cabin Crew': 9 }, outcome: 'answered',
    q: ['Can a passenger keep a 160 Wh power bank in cabin baggage?',
      'What is the watt-hour limit for spare lithium batteries?',
      'Do spare lithium batteries need to be protected from short circuit?'],
    a: 'Spare lithium batteries and power banks must be in cabin baggage only, with the terminals protected. Batteries over 100 Wh and up to 160 Wh need airline approval, and anything above 160 Wh is not accepted [1].',
    source: { title: 'Dangerous Goods in Passenger Baggage — Check-in Acceptance', section: '3. Lithium batteries' },
  },
  {
    course: 'Fire Fighting On Board', askers: { 'Cabin Crew': 5 }, outcome: 'answered',
    q: ['What do I do if the lavatory door is hot?',
      'Who do I tell first when a lavatory smoke detector goes off?'],
    a: 'Do not open a hot door. Keep it closed, inform the SCCM and wait for the fire-fighting team [1].',
    source: { title: 'Lavatory Smoke Detection and Fire Response', section: '3. Response to a smoke detector alarm' },
  },
  {
    course: 'Emergency Evacuation Procedures', askers: { 'Cabin Crew': 3 }, outcome: 'answered',
    q: ['How do I check the slide before the first flight of the day?'],
    a: 'Check that the slide pressure gauge is in the green band and that the girt bar indicator matches the door mode [1].',
    source: { title: 'Cabin Crew Pre-Flight Safety Equipment Check', section: '6. Emergency exits and slides' },
  },
  {
    course: 'In-Flight First Aid', askers: { 'Cabin Crew': 2 }, outcome: 'answered',
    q: ['What do I check on the AED during the pre-flight check?'],
    a: 'Check that the AED is in its stowage, the status indicator shows ready, and the pads are sealed and in date [1].',
    source: { title: 'Cabin Crew Pre-Flight Safety Equipment Check', section: '5.7 Automated external defibrillator' },
  },
  {
    course: 'Managing Flight Disruptions', askers: { 'Customer Service': 4 }, outcome: 'not_found',
    q: ['What can I offer a passenger whose flight is delayed by five hours?',
      'How do I rebook a passenger who missed a connection because of our delay?',
      'Are meal vouchers given for every delay over two hours?'],
  },
  {
    course: 'Access Control and Reporting', askers: { 'Ground Operations': 2 }, outcome: 'not_found',
    q: ['Who do I report an unattended bag on the ramp to?'],
  },
];
const NOT_FOUND_TEXT = 'I couldn\'t find this in the SOP library, so I can\'t answer it reliably. Please check with your supervisor or trainer.';

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed a production database.');
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const one = async (sql, params) => (await client.query(sql, params)).rows[0];
    const { role_id: traineeRole } = await one("SELECT role_id FROM roles WHERE role_name = 'Trainee'");
    const trainer = await one("SELECT user_id FROM users WHERE email = 'trainer@rj.com'");
    if (!trainer) throw new Error('Run db/seed.js first (the demo cohort builds on it).');
    if (await one("SELECT 1 FROM users WHERE email = 'reem.abbadi@rj.com'")) {
      console.log('Demo cohort is already loaded.');
      await client.query('ROLLBACK');
      return;
    }

    const depts = {};
    (await client.query('SELECT dept_id, dept_name FROM departments')).rows
      .forEach((d) => { depts[d.dept_name] = d.dept_id; });

    // ---- The extra plan --------------------------------------------------
    const { plan_id: rampPlan } = await one(
      `INSERT INTO training_plans (created_by, plan_name, description, start_date, end_date)
       VALUES ($1, $2, $3, CURRENT_DATE + $4::int, CURRENT_DATE + $5::int) RETURNING plan_id`,
      [trainer.user_id, NEW_PLAN.name, NEW_PLAN.description, NEW_PLAN.start, NEW_PLAN.end]);
    for (const [i, [name, minutes]] of NEW_PLAN.courses.entries()) {
      await client.query(
        'INSERT INTO courses (plan_id, course_name, duration, sequence_order) VALUES ($1, $2, $3, $4)',
        [rampPlan, name, minutes, i + 1]);
    }

    // Plans with their dates (as days from today) and ordered courses.
    const plans = {};
    const { rows: planRows } = await client.query(
      `SELECT tp.plan_id, tp.plan_name, tp.start_date - CURRENT_DATE AS start_day,
              tp.end_date - CURRENT_DATE AS end_day,
              json_agg(json_build_object('id', c.course_id, 'name', c.course_name, 'minutes', c.duration)
                       ORDER BY c.sequence_order) AS courses
         FROM training_plans tp JOIN courses c ON c.plan_id = tp.plan_id
        GROUP BY tp.plan_id`);
    planRows.forEach((p) => { plans[p.plan_name] = p; });
    const courseByName = {};
    planRows.forEach(p => p.courses.forEach((c) => { courseByName[c.name] = c; }));

    // The base seed assigned its trainees "today"; date them from the plan start instead.
    await client.query(
      `UPDATE plan_assignments pa SET assigned_date = tp.start_date
         FROM training_plans tp
        WHERE tp.plan_id = pa.plan_id AND tp.start_date < CURRENT_DATE`);

    // ---- Trainees ------------------------------------------------------
    const hash = await bcrypt.hash(SEED_PASSWORD, 12);
    const people = [];
    for (const [dept, names] of Object.entries(TRAINEES)) {
      for (const fullName of names) {
        const email = `${fullName.toLowerCase().replace(/[^a-z ]/g, '').replace(' ', '.')}@rj.com`;
        const { user_id: id } = await one(
          `INSERT INTO users (role_id, dept_id, full_name, email, password_hash, created_at)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING user_id`,
          [traineeRole, depts[dept], fullName, email, hash, daysAgo(intBetween(70, 400))]);
        // engagement 0.35 … 1: how quickly this person works through training
        people.push({ id, fullName, dept, engagement: between(0.35, 1), lastActive: null, started: [] });
      }
    }
    // Three Customer Service trainees joined this week.
    const newJoiners = people.filter(p => p.dept === 'Customer Service').slice(-3);

    // ---- Assignments and progress ---------------------------------------
    for (const person of people) {
      const planNames = [...DEPARTMENT_PLANS[person.dept]];
      // Some Ground Operations staff are already enrolled in the upcoming plan.
      if (person.dept === 'Ground Operations' && chance(0.5)) planNames.push('Ground Handling Fundamentals');

      for (const planName of planNames) {
        const plan = plans[planName];
        const isNew = newJoiners.includes(person) && planName === 'Customer Service Excellence';
        if (newJoiners.includes(person) && planName === 'Aviation Security Refresher') continue;

        const assignedDay = isNew ? -intBetween(2, 5) : Math.min(plan.start_day + intBetween(0, 3), 0);
        const length = plan.end_day - plan.start_day;
        const elapsed = Math.max(0, Math.min(1, -assignedDay / length));

        // Share of the plan done: how far the plan has run × how engaged the trainee is.
        let done = Math.min(1, elapsed * (0.55 + person.engagement * 0.9));
        if (plan.end_day < 0) done = chance(0.85) ? 1 : between(0.3, 0.8);   // past due: most finished
        if (plan.start_day > 0) done = 0;                                      // not begun yet

        const completed = done >= 1;
        await client.query(
          'INSERT INTO plan_assignments (plan_id, trainee_id, assigned_date, status) VALUES ($1, $2, CURRENT_DATE + $3::int, $4)',
          [plan.plan_id, person.id, assignedDay, completed ? 'completed' : 'active']);

        // Courses are done in order: e.g. done = 0.6 of 4 courses = 2.4 →
        // 100, 100, 25 (rounded down to a progress step), 0.
        const units = done * plan.courses.length;
        const steps = plan.courses.map((_, i) => {
          const left = units - i;
          if (left >= 1) return 100;
          return left > 0 ? Math.floor(left * 4) * 25 : null;   // null = not touched
        });
        // The first course not yet begun: opened (0%, "started") for some.
        const firstUntouched = steps.indexOf(null);
        if (done > 0 && firstUntouched > 0 && steps[firstUntouched - 1] === 100 && chance(0.4)) {
          steps[firstUntouched] = 0;
        }
        const touched = steps.filter(s => s !== null).length;

        // Spread the activity from the assignment day up to today. A finished
        // plan took 55–95% of its window, which drives Time-to-Competency.
        const span = completed ? Math.max(3, Math.round(length * between(0.55, 0.95))) : -assignedDay;
        for (const [i, course] of plan.courses.entries()) {
          const pctDone = steps[i];
          if (pctDone === null) continue;
          const day = Math.max(0, -(assignedDay + Math.round(span * ((i + 1) / touched))));
          const when = new Date(daysAgo(day).getTime() - intBetween(1, 10) * 3600000);
          await client.query(
            'INSERT INTO progress (trainee_id, course_id, completion_pct, last_accessed) VALUES ($1, $2, $3, $4)',
            [person.id, course.id, pctDone, when]);
          person.started.push({ course, pct: pctDone, when });
          if (!person.lastActive || when > person.lastActive) person.lastActive = when;
        }
      }
    }

    // ---- Feedback ------------------------------------------------------
    let feedbackCount = 0;
    for (const person of people) {
      for (const { course, pct } of person.started) {
        if (pct < 50 || !chance(0.6)) continue;
        const quality = COURSE_QUALITY[course.name] ?? 3.8;
        const rating = Math.max(1, Math.min(5, Math.round(quality + between(-1.1, 1.1))));
        let comment = null;
        let score = null;
        if (chance(0.75)) {
          const mood = rating >= 4 ? 'positive' : rating === 3 ? 'neutral' : 'negative';
          const specific = mood === 'negative' && COURSE_COMPLAINTS[course.name];
          comment = specific && chance(0.7) ? pick(specific) : pick(COMMENTS[mood]);
          const [lo, hi] = SCORE_RANGE[mood];
          score = Math.round(between(lo, hi) * 100) / 100;
        }
        await client.query(
          `INSERT INTO feedback (trainee_id, course_id, rating, comment, sentiment_score)
           VALUES ($1, $2, $3, $4, $5)`,
          [person.id, course.id, rating, comment, score]);
        feedbackCount += 1;
      }
    }

    // ---- AI Assistant questions (knowledge gaps) -----------------------
    let questionCount = 0;
    for (const topic of QUESTIONS) {
      const course = courseByName[topic.course];
      for (const [dept, howMany] of Object.entries(topic.askers)) {
        // Only trainees who have that course in one of their plans.
        const askers = people.filter(p => p.dept === dept && DEPARTMENT_PLANS[dept].some(
          name => plans[name].courses.some(c => c.id === course.id))).slice(0, howMany);
        for (const person of askers) {
          const askedAt = daysAgo(between(1, 26));
          const { session_id: sessionId } = await one(
            'INSERT INTO chat_sessions (user_id, started_at) VALUES ($1, $2) RETURNING session_id',
            [person.id, askedAt]);
          const question = pick(topic.q);
          const answered = topic.outcome === 'answered';
          const citations = answered
            ? [{ n: 1, docId: null, title: topic.source.title, section: topic.source.section,
              page: null, excerpt: topic.a.replace(/\s*\[1\]$/, ''), similarity: 0.86 }]
            : [];
          await client.query(
            `INSERT INTO chat_messages (session_id, sender_role, message_text, created_at)
             VALUES ($1, 'user', $2, $3)`,
            [sessionId, question, askedAt]);
          await client.query(
            `INSERT INTO chat_messages (session_id, sender_role, message_text, created_at,
                                        outcome, citations, related_course_ids)
             VALUES ($1, 'bot', $2, $3, $4, $5, $6::uuid[])`,
            [sessionId, answered ? topic.a : NOT_FOUND_TEXT, new Date(askedAt.getTime() + 3000),
             topic.outcome, JSON.stringify(citations), [course.id]]);
          questionCount += 1;
        }
      }
    }

    // ---- KPIs ------------------------------------------------------------
    const kpis = [
      ['Customer Service',  'Passenger complaints (per 10k pax)', 9.4, 6.8],
      ['Ground Operations', 'Baggage mishandling (per 1k bags)',  6.2, 5.1],
      ['Ground Operations', 'Average turnaround delay (minutes)', 14,  11],
    ];
    for (const [dept, name, before, after] of kpis) {
      await client.query(
        'INSERT INTO kpis (dept_id, kpi_name, value_before, value_after) VALUES ($1, $2, $3, $4)',
        [depts[dept], name, before, after]);
    }

    // ---- Logins (User Management "Last active") ------------------------
    for (const person of people) {
      const at = person.lastActive || daysAgo(between(1, 20));
      await client.query(
        `INSERT INTO audit_logs (actor_id, action, target_user_id, details, created_at)
         VALUES ($1, 'LOGIN', $1, '{}', $2)`,
        [person.id, new Date(at.getTime() - 5 * 60000)]);
    }

    await client.query('COMMIT');
    console.log(`\nDemo cohort added: ${people.length} trainees, 1 plan, ${feedbackCount} feedback, `
      + `${questionCount} AI Assistant questions, ${kpis.length} KPIs.`);
    console.log('  Cohort trainees use the same password, e.g. reem.abbadi@rj.com');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

main()
  .catch((err) => {
    console.error('Demo cohort failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
