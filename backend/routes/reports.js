// Phase 8 (FR17): admins and trainers generate training reports and export
// them as PDF (CSV too, for spreadsheets). Trainer + Admin.
//
//   GET /api/reports                       → { reports: [{ id, title, description, filters }] }
//   GET /api/reports/:id?<filters>          → the report (preview on screen)
//   GET /api/reports/:id/export?format=pdf|csv&<filters>
//                                           → the file, as a download
//
// Filters per report (anything else is ignored):
//   cohort-progress   planId, departmentId, status
//   feedback          planId
//   ai-usage          from, to (YYYY-MM-DD; default the last 30 days)
//
// Read-only. Each export is written to the audit log (REPORT_EXPORTED), since
// a file with trainee data is leaving the system.
const express = require('express');
const HttpError = require('../utils/httpError');
const { authenticate, authorize } = require('../middleware/auth');
const reports = require('../services/reports');
const reportExport = require('../services/reportExport');
const audit = require('../services/audit');

const router = express.Router();

router.use(authenticate, authorize('Trainer', 'Admin'));

const FORMATS = ['pdf', 'csv'];

router.get('/', (req, res) => {
  res.json({ reports: reports.list() });
});

router.get('/:id', async (req, res) => {
  res.json(await reports.build(req.params.id, req.query));
});

router.get('/:id/export', async (req, res) => {
  const format = String(req.query.format || 'pdf').toLowerCase();
  if (!FORMATS.includes(format)) {
    throw new HttpError(400, 'VALIDATION', 'format must be pdf or csv.');
  }
  const report = await reports.build(req.params.id, req.query);
  const body = format === 'pdf'
    ? await reportExport.toPdf(report, { generatedBy: req.user.name })
    : reportExport.toCsv(report);

  await audit.record(null, {
    actorId: req.user.id,
    action: audit.ACTIONS.REPORT_EXPORTED,
    details: { report: report.id, title: report.title, format, filters: report.filters },
  });

  res.attachment(reportExport.fileName(report, format));
  res.type(format === 'pdf' ? 'application/pdf' : 'text/csv; charset=utf-8');
  // Reports hold personal data: do not let the browser or a proxy keep a copy.
  res.set('Cache-Control', 'no-store');
  res.send(body);
});

module.exports = router;
