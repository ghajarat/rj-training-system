// /api/courses — training materials (FR7). Trainers and Admins only (NFR07).
//
//   GET    /api/courses                 list with plan / type / search filters
//   POST   /api/courses                 add a course to a plan (multipart)
//   GET    /api/courses/:id             one course
//   PATCH  /api/courses/:id             edit; replace or remove the material
//   DELETE /api/courses/:id             delete (refused once trainees started it)
//   GET    /api/courses/:id/material    download the stored file
//
// A course belongs to exactly one plan (GP1). Its material is either an
// uploaded file (PDF, DOCX, PPTX, MP4) or a web link, kept in material_url.
//
// POST and PATCH accept multipart/form-data (to carry the file) or JSON.
// Fields: planId (POST only), name, durationMinutes, link, and the file in
// "file". On PATCH, link = "" removes the material.
//
// Every change writes an audit row in the same transaction (FR2). Files are
// only deleted from disk AFTER the transaction commits.
const fs = require('fs');
const express = require('express');
const db = require('../db');
const HttpError = require('../utils/httpError');
const { authenticate, authorize } = require('../middleware/auth');
const { uploadMaterial, discardUpload } = require('../middleware/uploadMaterial');
const audit = require('../services/audit');
const materialFiles = require('../services/materialFiles');
const { COURSE_SELECT, toCourseDto, findCourseById } = require('../services/courses');
const { lockPlan } = require('../services/plans');
const {
  isUuid, requireUuid, parsePagination, paginationDto, likePattern, readText, readHttpUrl,
} = require('../utils/validate');

const MATERIAL_TYPES = ['pdf', 'docx', 'pptx', 'mp4', 'link', 'none'];

const router = express.Router();

// authenticate runs before multer, so a signed-out or Trainee request is
// rejected before any file is written to disk.
router.use(authenticate, authorize('Trainer', 'Admin'));

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function readName(value) {
  return readText(value, 'Course name', { min: 2, max: 150 });
}

// Minutes, optional. '' or null clears it.
function readDuration(value) {
  if (value === undefined || value === null || value === '') return null;
  const minutes = Number(value);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 10000) {
    throw new HttpError(400, 'VALIDATION', 'Duration must be a whole number of minutes between 1 and 10000.');
  }
  return minutes;
}

// When a route also locks the plan, it locks the plan FIRST (see lockPlan).
async function lockCourse(client, id) {
  const { rows } = await client.query(
    'SELECT * FROM courses WHERE course_id = $1 FOR UPDATE', [id]);
  if (!rows[0]) throw new HttpError(404, 'COURSE_NOT_FOUND', 'That course does not exist.');
  return rows[0];
}

const materialType = url => materialFiles.describe(url)?.type || 'none';

// Turns "Fire Fighting / On Board" into a safe download name.
function downloadName(courseName, ext) {
  const base = courseName.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'material';
  return `${base}.${ext}`;
}

// ---------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------

// GET /api/courses?planId=&type=&search=&page=&pageSize=
//   type: pdf | docx | pptx | mp4 | link | none
//   → { courses, pagination, total }
router.get('/', async (req, res) => {
  const q = req.query;
  const paging = parsePagination(q, { defaultSize: 24 });

  const where = [];
  const params = [];
  const param = (value) => { params.push(value); return `$${params.length}`; };

  if (q.planId) where.push(`c.plan_id = ${param(requireUuid(q.planId, 'plan id'))}`);
  if (q.type) {
    if (!MATERIAL_TYPES.includes(q.type)) {
      throw new HttpError(400, 'VALIDATION', `Type must be one of: ${MATERIAL_TYPES.join(', ')}.`);
    }
    if (q.type === 'none') where.push('c.material_url IS NULL');
    else if (q.type === 'link') where.push(`c.material_url ~* '^https?://'`);
    else where.push(`c.material_url LIKE ${param(`upload:%.${q.type}`)}`);
  }
  if (q.search !== undefined && String(q.search).trim()) {
    const search = String(q.search).trim();
    if (search.length > 100) throw new HttpError(400, 'VALIDATION', 'Search text is too long.');
    const p = param(likePattern(search));
    where.push(`(c.course_name ILIKE ${p} OR tp.plan_name ILIKE ${p})`);
  }

  const filter = where.length ? where.join(' AND ') : 'TRUE';

  const counts = await db.query(
    `SELECT COUNT(*) FILTER (WHERE ${filter})::int AS matched, COUNT(*)::int AS total
       FROM courses c JOIN training_plans tp ON tp.plan_id = c.plan_id`,
    params);
  const page = await db.query(
    `${COURSE_SELECT}
      WHERE ${filter}
      ORDER BY tp.plan_name, c.sequence_order
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, paging.pageSize, paging.offset]);

  res.json({
    courses: page.rows.map(toCourseDto),
    pagination: paginationDto(paging, counts.rows[0].matched),
    total: counts.rows[0].total,
  });
});

// POST /api/courses   { planId, name, durationMinutes?, link? } + file?
//   → 201 { course }                                                     FR7
// The new course goes to the end of its plan.
router.post('/', uploadMaterial, async (req, res) => {
  try {
    const body = req.body || {};
    if (!isUuid(body.planId)) throw new HttpError(400, 'VALIDATION', 'Please choose a training plan.');
    const name = readName(body.name);
    const duration = readDuration(body.durationMinutes);
    const hasLink = typeof body.link === 'string' && body.link.trim() !== '';
    if (req.file && hasLink) {
      throw new HttpError(400, 'VALIDATION', 'Choose either a file or a link, not both.');
    }
    const materialUrl = req.file ? req.file.materialUrl : (hasLink ? readHttpUrl(body.link) : null);

    const course = await db.transaction(async (client) => {
      const plan = await lockPlan(client, body.planId, { asInput: true });
      const { rows } = await client.query(
        `INSERT INTO courses (plan_id, course_name, material_url, duration, sequence_order)
         VALUES ($1, $2, $3, $4,
                 (SELECT COALESCE(MAX(sequence_order), 0) + 1 FROM courses WHERE plan_id = $1))
         RETURNING course_id`,
        [plan.plan_id, name, materialUrl, duration]);
      const courseId = rows[0].course_id;

      await audit.record(client, {
        actorId: req.user.id,
        action: audit.ACTIONS.COURSE_CREATED,
        details: {
          courseId, courseName: name, planId: plan.plan_id, planName: plan.plan_name,
          material: materialType(materialUrl), fileName: req.file?.originalname,
        },
      });
      return findCourseById(courseId, client);
    });

    res.status(201).json({ course: toCourseDto(course) });
  } catch (err) {
    await discardUpload(req);
    throw err;
  }
});

// GET /api/courses/:id  →  { course }
router.get('/:id', async (req, res) => {
  const course = await findCourseById(requireUuid(req.params.id, 'course id'));
  if (!course) throw new HttpError(404, 'COURSE_NOT_FOUND', 'That course does not exist.');
  res.json({ course: toCourseDto(course) });
});

// PATCH /api/courses/:id   { name?, durationMinutes?, link? } + file?
//   → { course }                                                         FR7
// A new file or link replaces the old material; link = "" removes it.
// The plan cannot be changed: progress belongs to this course in this plan.
router.patch('/:id', uploadMaterial, async (req, res) => {
  let oldMaterialUrl = null;
  let course;
  try {
    const id = requireUuid(req.params.id, 'course id');
    const body = req.body || {};
    if (body.planId !== undefined) {
      throw new HttpError(400, 'VALIDATION', 'A course cannot be moved to another plan. Add it to the other plan instead.');
    }
    if (req.file && typeof body.link === 'string' && body.link.trim() !== '') {
      throw new HttpError(400, 'VALIDATION', 'Choose either a file or a link, not both.');
    }
    const name = body.name !== undefined ? readName(body.name) : undefined;
    const duration = body.durationMinutes !== undefined ? readDuration(body.durationMinutes) : undefined;
    let materialUrl;                                    // undefined = unchanged
    if (req.file) materialUrl = req.file.materialUrl;
    else if (body.link !== undefined) materialUrl = String(body.link).trim() === '' ? null : readHttpUrl(body.link);

    if (name === undefined && duration === undefined && materialUrl === undefined) {
      throw new HttpError(400, 'VALIDATION', 'Nothing to update. Send name, durationMinutes, link or a file.');
    }

    course = await db.transaction(async (client) => {
      const current = await lockCourse(client, id);

      // Record only what actually changes, as { field: { from, to } }.
      const changes = {};
      if (name !== undefined && name !== current.course_name) {
        changes.name = { from: current.course_name, to: name };
      }
      if (duration !== undefined && duration !== current.duration) {
        changes.durationMinutes = { from: current.duration, to: duration };
      }
      if (materialUrl !== undefined && materialUrl !== current.material_url) {
        changes.material = { from: materialType(current.material_url), to: materialType(materialUrl) };
        if (req.file) changes.material.fileName = req.file.originalname;
        oldMaterialUrl = current.material_url;
      }

      if (Object.keys(changes).length > 0) {
        await client.query(
          `UPDATE courses SET course_name = $1, duration = $2, material_url = $3 WHERE course_id = $4`,
          [name ?? current.course_name,
           duration !== undefined ? duration : current.duration,
           materialUrl !== undefined ? materialUrl : current.material_url,
           id]);
        await audit.record(client, {
          actorId: req.user.id,
          action: audit.ACTIONS.COURSE_UPDATED,
          details: { courseId: id, courseName: name ?? current.course_name, planId: current.plan_id, changes },
        });
      }
      return findCourseById(id, client);
    });
  } catch (err) {
    await discardUpload(req);
    throw err;
  }

  // Committed: the old file is no longer referenced by any row.
  if (oldMaterialUrl) await materialFiles.removeStored(oldMaterialUrl);
  res.json({ course: toCourseDto(course) });
});

// DELETE /api/courses/:id  →  204                                         FR7
// Refused once any trainee has progress or feedback on the course: the
// GP1 foreign keys would cascade and erase that history. The trainer can
// replace the material instead.
router.delete('/:id', async (req, res) => {
  const id = requireUuid(req.params.id, 'course id');

  const deleted = await db.transaction(async (client) => {
    const found = await client.query('SELECT plan_id FROM courses WHERE course_id = $1', [id]);
    if (!found.rows[0]) throw new HttpError(404, 'COURSE_NOT_FOUND', 'That course does not exist.');
    const plan = await lockPlan(client, found.rows[0].plan_id);
    const course = await lockCourse(client, id);

    const { rows: [usage] } = await client.query(
      `SELECT (SELECT COUNT(*)::int FROM progress WHERE course_id = $1 AND completion_pct > 0) AS started,
              (SELECT COUNT(*)::int FROM feedback WHERE course_id = $1) AS feedback`,
      [id]);
    if (usage.started > 0 || usage.feedback > 0) {
      throw new HttpError(409, 'COURSE_HAS_PROGRESS',
        usage.started > 0
          ? `${usage.started} trainee(s) have already started this course, so deleting it would erase their progress. Replace its material instead.`
          : 'Trainees have left feedback on this course, so it cannot be deleted. Replace its material instead.');
    }

    await client.query('DELETE FROM courses WHERE course_id = $1', [id]);
    // Close the gap so positions stay 1, 2, 3...
    await client.query(
      `UPDATE courses SET sequence_order = sequence_order - 1
        WHERE plan_id = $1 AND sequence_order > $2`,
      [plan.plan_id, course.sequence_order]);
    await audit.record(client, {
      actorId: req.user.id,
      action: audit.ACTIONS.COURSE_DELETED,
      details: { courseId: id, courseName: course.course_name, planId: plan.plan_id, planName: plan.plan_name },
    });
    return course;
  });

  await materialFiles.removeStored(deleted.material_url);
  res.status(204).end();
});

// GET /api/courses/:id/material  →  the file, as a download               FR7
// Files are not served from a public static folder: every download goes
// through authenticate. (Phase 4c adds trainee access to assigned courses.)
router.get('/:id/material', async (req, res) => {
  const course = await findCourseById(requireUuid(req.params.id, 'course id'));
  if (!course) throw new HttpError(404, 'COURSE_NOT_FOUND', 'That course does not exist.');

  const filePath = materialFiles.pathFor(course.material_url);
  if (!filePath) {
    throw new HttpError(404, 'NO_FILE', course.material_url
      ? 'This course links to a web page, not an uploaded file.'
      : 'This course has no material yet.');
  }
  try {
    await fs.promises.access(filePath);
  } catch {
    throw new HttpError(404, 'FILE_MISSING', 'The file for this course could not be found on the server. Upload it again.');
  }

  // res.download sets Content-Type from the extension and
  // Content-Disposition: attachment with the readable name.
  const ext = materialFiles.describe(course.material_url).type;
  res.download(filePath, downloadName(course.course_name, ext));
});

module.exports = router;
