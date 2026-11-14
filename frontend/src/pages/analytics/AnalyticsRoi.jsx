// Analytics & ROI (Phase 7), /analytics, Trainer + Admin.
// Design: docs/designs/Anaytics.png, with these differences:
//   - Sentiment is shown per training plan, not per topic: feedback has no
//     topic, and adding one would be a schema change for little gain.
//   - No period picker or filters: the KPIs have no dates (GP1 Table 28).
//   - "Export" opens the KPI & Training ROI report (Phase 8, FR17), which
//     downloads as PDF or CSV.
//   - The money figures use stated demo assumptions (backend
//     services/roiModel.js). The "How ROI is calculated" panel shows them so
//     every number on this page can be traced back.
// All numbers come from GET /api/analytics/roi.
import { Link } from 'react-router-dom';
import Button from '../../components/Button';
import Icon from '../../components/Icon';
import StackedBar from '../../components/StackedBar';
import StatCard from '../../components/StatCard';
import useFetch from '../../hooks/useFetch';
import { formatChange, formatMoney, plural } from '../../utils/format';
import PageHeader from '../PageHeader';
import '../dashboard.css';
import './analytics.css';

export default function AnalyticsRoi() {
  const { data, error, reload } = useFetch('/analytics/roi');
  const s = data?.summary;
  const currency = data?.model.currency;
  const ttc = s?.timeToCompetency;
  const ttcDiff = ttc?.avgDays != null ? ttc.targetDays - ttc.avgDays : null;

  return (
    <>
      <PageHeader
        eyebrow="Training impact"
        title="Training Analytics & ROI"
        subtitle="The business impact of structured learning across the organisation."
        actions={(
          <Link to="/reports?report=roi" className="btn btn--secondary">
            <Icon name="download" size={16} />
            <span>Export</span>
          </Link>
        )}
      />

      {error && (
        <div className="inline-error inline-error--row page-alert" role="alert">
          <span>{error}</span>
          <Button variant="secondary" size="sm" onClick={reload}>Try again</Button>
        </div>
      )}

      <div className="stat-grid">
        <StatCard label="Training ROI" value={s && s.roiPct !== null ? formatChange(s.roiPct) : null}
          valueTone={s?.roiPct > 0 ? 'success' : s?.roiPct < 0 ? 'danger' : undefined}
          foot={s && `${formatMoney(s.benefit, currency)} benefit vs ${formatMoney(s.cost, currency)} cost`} />
        <StatCard label="Cost per Trainee" value={s && formatMoney(s.costPerTrainee, currency)}
          foot={s && `${plural(s.traineesInTraining, 'trainee')} · ${s.trainingHours} training hours`} />
        <StatCard label="Time-to-Competency" value={ttc?.avgDays != null ? `${ttc.avgDays}d` : null}
          foot={ttc && (ttcDiff === null
            ? 'No plan completed yet'
            : ttcDiff >= 0 ? `${ttcDiff}d faster than the ${ttc.targetDays}-day target`
              : `${-ttcDiff}d slower than the ${ttc.targetDays}-day target`)}
          footTone={ttcDiff === null ? undefined : ttcDiff >= 0 ? 'success' : 'danger'} />
        <StatCard label="Compliance Coverage" value={s?.compliance.pct != null ? `${s.compliance.pct}%` : null}
          foot={s && `${s.compliance.compliant} of ${plural(s.compliance.total, 'trainee')} with no overdue plan`} />
      </div>

      <div className="dashboard-grid">
        <KpiPanel data={data} />
        <SentimentByPlan data={data} />
      </div>

      <RoiBreakdown data={data} />
    </>
  );
}

function Loading({ data }) {
  return !data ? <p className="loading-text">Loading…</p> : null;
}

function KpiPanel({ data }) {
  const kpis = data?.kpis;
  return (
    <section className="card panel dashboard-grid__main" aria-labelledby="kpi-title">
      <h2 id="kpi-title" className="panel__title">
        Operational KPIs — Before vs After Training
        {kpis && <span className="toolbar__meta">{plural(kpis.length, 'KPI')}</span>}
      </h2>
      <div className="panel__body">
        <Loading data={data} />
        {kpis?.length === 0 && (
          <div className="empty-state">
            <strong>No KPIs recorded yet</strong>
            <span>Department KPIs measured before and after training appear here.</span>
          </div>
        )}
        {kpis?.length > 0 && (
          <>
            <p className="kpi-legend">
              <span><i className="kpi-swatch--before" />Before</span>
              <span><i className="kpi-swatch--after" />After</span>
            </p>
            <ul className="kpi-list">
              {kpis.map((k) => <KpiRow key={k.id} kpi={k} />)}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}

function KpiRow({ kpi }) {
  const max = Math.max(kpi.before ?? 0, kpi.after ?? 0) || 1;
  const width = (v) => `${Math.round(((v ?? 0) / max) * 100)}%`;
  let changeClass = 'text-muted';
  if (kpi.improved === true) changeClass = 'text-success';
  if (kpi.improved === false) changeClass = 'text-danger';

  return (
    <li className="kpi-row">
      <div className="kpi-row__head">
        <span className="bar-row__name">
          {kpi.name}
          <span className="table__sub">{kpi.department}{kpi.lowerIsBetter && ' · lower is better'}</span>
        </span>
        <span className={`kpi-row__change ${changeClass}`}>
          {kpi.after === null ? 'Awaiting measurement' : formatChange(kpi.changePct)}
        </span>
      </div>
      <div className="kpi-bars" role="img"
        aria-label={`${kpi.name}: before ${kpi.before ?? 'not measured'}, after ${kpi.after ?? 'not measured yet'}`}>
        <div className="kpi-bar kpi-bar--before"><span style={{ width: width(kpi.before) }} /></div>
        <div className="kpi-bar kpi-bar--after"><span style={{ width: width(kpi.after) }} /></div>
      </div>
      <div className="kpi-row__values">
        <span>Before: {kpi.before ?? '—'}</span>
        <span>After: {kpi.after ?? '—'}</span>
      </div>
    </li>
  );
}

function SentimentByPlan({ data }) {
  const plans = data?.sentimentByPlan;
  return (
    <section className="card panel dashboard-grid__side" aria-labelledby="by-plan-title">
      <h2 id="by-plan-title" className="panel__title">
        Sentiment by Plan
        {plans && <span className="toolbar__meta">{plural(plans.reduce((n, p) => n + p.responses, 0), 'comment')}</span>}
      </h2>
      <div className="panel__body">
        <Loading data={data} />
        {plans?.length === 0 && (
          <div className="empty-state">
            <strong>No feedback yet</strong>
            <span>Trainees’ ratings and comments appear here per plan.</span>
          </div>
        )}
        {plans?.length > 0 && (
          <ul className="plan-sentiment">
            {plans.map((p) => (
              <li key={p.planId}>
                <div className="plan-sentiment__head">
                  <span>{p.planName}</span>
                  <span>{p.responses > 0 ? `${p.positivePct}% positive` : 'Not scored yet'}</span>
                </div>
                <StackedBar label={`Sentiment of ${p.planName}`} parts={p.responses > 0 ? [
                  { value: p.positivePct, tone: 'success', label: 'Positive' },
                  { value: p.neutralPct, tone: 'muted', label: 'Neutral' },
                  { value: p.negativePct, tone: 'danger', label: 'Negative' },
                ] : []} />
                <p className="plan-sentiment__foot">
                  {p.avgRating}★ average from {plural(p.ratings, 'rating')}
                  {p.pending > 0 && ` · ${p.pending} waiting for the AI`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function RoiBreakdown({ data }) {
  if (!data) return null;
  const { model, kpis, summary } = data;
  const valued = kpis.filter((k) => k.benefit !== null);
  const money = (v) => formatMoney(v, model.currency);

  return (
    <section className="card panel analytics-roi" aria-labelledby="roi-title">
      <h2 id="roi-title" className="panel__title">
        How ROI is calculated
        <span className="toolbar__meta">ROI = (benefit − cost) ÷ cost</span>
      </h2>
      <div className="panel__body analytics-grid analytics-grid--flush">
        <div className="table-wrap">
          <table className="table roi-table">
            <thead>
              <tr><th>Benefit (KPI improvement × value per unit)</th><th>{model.currency}</th></tr>
            </thead>
            <tbody>
              {valued.map((k) => (
                <tr key={k.id}>
                  <td>{k.name}: {k.unitsImproved} × {money(k.unitValue)}</td>
                  <td className={k.benefit < 0 ? 'text-danger' : undefined}>{money(k.benefit)}</td>
                </tr>
              ))}
              <tr className="roi-table__total"><td>Total benefit</td><td>{money(summary.benefit)}</td></tr>
            </tbody>
          </table>
        </div>
        <div className="table-wrap">
          <table className="table roi-table">
            <thead>
              <tr><th>Cost</th><th>{model.currency}</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>{summary.trainingHours} training hours × {money(model.costPerTrainingHour)}</td>
                <td>{money(model.trainingCost)}</td>
              </tr>
              <tr>
                <td>{plural(summary.traineesInTraining, 'trainee')} × {money(model.platformCostPerTrainee)} platform cost</td>
                <td>{money(model.platformCost)}</td>
              </tr>
              <tr className="roi-table__total"><td>Total cost</td><td>{money(summary.cost)}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <p className="panel__note">
        The value per KPI unit and the cost rates are demo assumptions, to be replaced with figures from RJ Finance.
        KPIs without a recorded “after” value are not counted.
      </p>
    </section>
  );
}
