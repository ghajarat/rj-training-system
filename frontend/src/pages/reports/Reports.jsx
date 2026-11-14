// Reports (Phase 8, FR17), /reports, Trainer + Admin.
//
// Pick a report, set its filters, see a preview, then download it as PDF
// (FR17) or CSV. The preview, the PDF and the CSV are all built from the same
// GET /api/reports/:id answer on the backend, so they always agree.
//
// The chosen report and its filters live in the URL (?report=roi&planId=…),
// so other pages can link straight to a report (Trainer Overview → "Cohort
// report", Analytics & ROI → "Export"), and a refresh keeps the selection.
//
// There is no design screenshot for this page; it follows the layout of the
// other Phase 7 pages (header, filter bar, cards, tables).
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getErrorMessage } from '../../api/client';
import { downloadReport } from '../../api/reports';
import Badge from '../../components/Badge';
import Button from '../../components/Button';
import Icon from '../../components/Icon';
import Input from '../../components/Input';
import Select from '../../components/Select';
import StatCard from '../../components/StatCard';
import useFetch from '../../hooks/useFetch';
import { formatDateTime, plural } from '../../utils/format';
import PageHeader from '../PageHeader';
import { STATUS_OPTIONS, formatCell, isNumeric, statusTone } from './reportFormat';
import '../dashboard.css';
import './reports.css';

const FILTER_KEYS = ['planId', 'departmentId', 'status', 'from', 'to'];
const DEFAULT_REPORT = 'cohort-progress';

export default function Reports() {
  const [searchParams, setSearchParams] = useSearchParams();
  const catalogue = useFetch('/reports');
  const reports = catalogue.data?.reports || [];

  const reportId = searchParams.get('report') || DEFAULT_REPORT;
  const current = reports.find((r) => r.id === reportId);

  // Only the filters this report accepts are sent.
  const filters = {};
  for (const key of current?.filters || []) {
    const value = searchParams.get(key);
    if (value) filters[key] = value;
  }

  const report = useFetch(current ? `/reports/${current.id}` : null, filters);

  const choose = (id) => setSearchParams({ report: id });
  const setFilter = (key, value) => {
    const next = new URLSearchParams(searchParams);
    next.set('report', reportId);
    if (value) next.set(key, value); else next.delete(key);
    setSearchParams(next, { replace: true });
  };
  const clearFilters = () => setSearchParams({ report: reportId }, { replace: true });
  const isFiltered = FILTER_KEYS.some((k) => filters[k]);

  return (
    <>
      <PageHeader
        eyebrow="Reports"
        title="Training Reports"
        subtitle="Generate a report, check it on screen, then export it as PDF to share or file."
      />

      {catalogue.error && (
        <div className="inline-error inline-error--row page-alert" role="alert">
          <span>{catalogue.error}</span>
          <Button variant="secondary" size="sm" onClick={catalogue.reload}>Try again</Button>
        </div>
      )}

      <div className="reports-layout">
        <nav className="card reports-picker" aria-label="Reports">
          <h2 className="panel__title">Reports</h2>
          {!catalogue.data && !catalogue.error && <p className="loading-text">Loading…</p>}
          <ul>
            {reports.map((r) => (
              <li key={r.id}>
                <button type="button"
                  className={`reports-picker__item ${r.id === reportId ? 'is-active' : ''}`}
                  aria-current={r.id === reportId ? 'true' : undefined}
                  onClick={() => choose(r.id)}>
                  <span className="reports-picker__title">{r.title}</span>
                  <span className="reports-picker__desc">{r.description}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="reports-main">
          {catalogue.data && !current && (
            <div className="card panel empty-state">
              <strong>That report does not exist</strong>
              <Button variant="secondary" size="sm" onClick={() => choose(DEFAULT_REPORT)}>Open Cohort Progress</Button>
            </div>
          )}

          {current && (
            <section className="card panel" aria-labelledby="report-title">
              <div className="toolbar">
                <div className="toolbar__title">
                  <h2 id="report-title" className="panel__title">{current.title}</h2>
                  <p className="reports-desc">{current.description}</p>
                </div>
                <ExportButtons reportId={current.id} filters={filters} disabled={!report.data || Boolean(report.error)} />
              </div>

              {current.filters.length > 0 && (
                <ReportFilters report={current} values={filters} onChange={setFilter}
                  onClear={clearFilters} isFiltered={isFiltered} />
              )}

              <div className="panel__body">
                {report.error && (
                  <div className="inline-error inline-error--row" role="alert">
                    <span>{report.error}</span>
                    <Button variant="secondary" size="sm" onClick={report.reload}>Try again</Button>
                  </div>
                )}
                {!report.data && !report.error && <p className="loading-text">Generating report…</p>}
                {report.data && report.data.id === current.id && (
                  <ReportPreview data={report.data} loading={report.loading} />
                )}
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}

function ExportButtons({ reportId, filters, disabled }) {
  const [busy, setBusy] = useState(null);     // 'pdf' | 'csv' | null
  const [error, setError] = useState('');

  const run = async (format) => {
    setBusy(format);
    setError('');
    try {
      await downloadReport(reportId, format, filters);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="toolbar__controls reports-export">
      <Button icon="download" onClick={() => run('pdf')} loading={busy === 'pdf'} disabled={disabled || busy !== null}>
        Export PDF
      </Button>
      <Button variant="secondary" icon="download" onClick={() => run('csv')} loading={busy === 'csv'}
        disabled={disabled || busy !== null}>
        CSV
      </Button>
      {error && <p className="inline-error reports-export__error" role="alert">{error}</p>}
    </div>
  );
}

function ReportFilters({ report, values, onChange, onClear, isFiltered }) {
  const has = (key) => report.filters.includes(key);
  const plans = useFetch(has('planId') ? '/plans' : null, { pageSize: 100 });
  const departments = useFetch(has('departmentId') ? '/departments' : null);

  return (
    <div className="filters reports-filters">
      {has('planId') && (
        <Select label="Plan" value={values.planId || ''} placeholder="All plans"
          onChange={(e) => onChange('planId', e.target.value)}
          options={(plans.data?.plans || []).map((p) => ({ value: p.id, label: p.name }))} />
      )}
      {has('departmentId') && (
        <Select label="Department" value={values.departmentId || ''} placeholder="All departments"
          onChange={(e) => onChange('departmentId', e.target.value)}
          options={(departments.data?.departments || []).map((d) => ({ value: d.id, label: d.name }))} />
      )}
      {has('status') && (
        <Select label="Status" value={values.status || ''} placeholder="Any status"
          onChange={(e) => onChange('status', e.target.value)} options={STATUS_OPTIONS} />
      )}
      {has('from') && (
        <Input label="From" type="date" value={values.from || ''} max={values.to || undefined}
          onChange={(e) => onChange('from', e.target.value)} hint="Default: last 30 days" />
      )}
      {has('to') && (
        <Input label="To" type="date" value={values.to || ''} min={values.from || undefined}
          onChange={(e) => onChange('to', e.target.value)} />
      )}
      <Button variant="ghost" size="sm" onClick={onClear} disabled={!isFiltered}>Clear filters</Button>
    </div>
  );
}

function ReportPreview({ data, loading }) {
  return (
    <div className={`reports-preview ${loading ? 'is-loading' : ''}`} aria-busy={loading}>
      <p className="reports-meta">
        Generated {formatDateTime(data.generatedAt)}
        {' · '}
        {data.filters.length
          ? data.filters.map((f) => `${f.label}: ${f.value}`).join(' · ')
          : 'All data (no filters)'}
      </p>

      {data.summary.length > 0 && (
        <div className="stat-grid reports-summary">
          {data.summary.map((s) => (
            <StatCard key={s.label} label={s.label} value={s.value === null ? null : formatCell(s.value, s.type)} />
          ))}
        </div>
      )}

      {data.sections.map((section) => <ReportSection key={section.title} section={section} />)}

      {data.notes.length > 0 && (
        <div className="reports-notes">
          <h3>Notes</h3>
          <ul>{data.notes.map((n) => <li key={n}>{n}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

function ReportSection({ section }) {
  return (
    <div className="reports-section">
      <h3 className="reports-section__title">
        {section.title}
        {section.rows.length > 0 && <span className="toolbar__meta">{plural(section.rows.length, 'row')}</span>}
      </h3>
      {section.rows.length === 0 ? (
        <div className="empty-state">
          <Icon name="file" size={20} />
          <span>{section.empty || 'No data.'}</span>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table reports-table">
            <thead>
              <tr>
                {section.columns.map((c) => (
                  <th key={c.key} className={isNumeric(c.type) ? 'num' : undefined}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {section.rows.map((row, i) => (
                // Report rows have no id; their order is fixed by the backend.
                <tr key={i}>
                  {section.columns.map((c) => (
                    <td key={c.key} className={isNumeric(c.type) ? 'num' : undefined}>
                      {c.type === 'status' && row[c.key]
                        ? <Badge tone={statusTone(row[c.key])} dot>{row[c.key]}</Badge>
                        : formatCell(row[c.key], c.type)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
