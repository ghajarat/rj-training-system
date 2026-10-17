// Training Materials — Trainee side (FR4, FR5, FR6).
// Design: docs/designs/Training_material.png. The schema has no course
// categories (Phase 4b decision), so the design's category filters become a
// plan filter, and the status tabs become All / In progress / Not started /
// Completed. Clicking a card opens CourseModal: material, progress, feedback.
//
// A trainee's list is small (their own plans only) and comes in one request
// (GET /api/me/plans), so search and filters run in the browser.
//
// URL parameters, used by My Dashboard links:
//   ?plan=<id>     start with that plan selected
//   ?course=<id>   open that course's window
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Badge from '../../components/Badge';
import Button from '../../components/Button';
import Icon from '../../components/Icon';
import Input from '../../components/Input';
import ProgressBar from '../../components/ProgressBar';
import Select from '../../components/Select';
import { formatDay, formatMinutes } from '../../utils/format';
import PageHeader from '../PageHeader';
import CourseModal from './CourseModal';
import { COURSE_STATUS, MATERIAL_INFO, materialType, toneForStatus } from './trainingOptions';
import useMyTraining, { flattenCourses } from './useMyTraining';
import './training.css';

const TABS = [
  { key: 'all',     label: 'All courses', matches: () => true },
  { key: 'active',  label: 'In progress', matches: (c) => c.status === 'started' || c.status === 'in_progress' },
  { key: 'todo',    label: 'Not started', matches: (c) => c.status === 'not_started' },
  { key: 'done',    label: 'Completed',   matches: (c) => c.status === 'completed' },
];

export default function MyMaterials() {
  const training = useMyTraining();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [planId, setPlanId] = useState(() => params.get('plan') || '');

  const plans = useMemo(() => training.data?.plans || [], [training.data]);
  const allCourses = useMemo(() => flattenCourses(plans), [plans]);

  // Plan and search first; the tab counts then show what each tab would hold.
  const text = search.trim().toLowerCase();
  const filtered = allCourses.filter((c) => (!planId || c.planId === planId)
    && (!text || c.name.toLowerCase().includes(text) || c.planName.toLowerCase().includes(text)));
  const activeTab = TABS.find((t) => t.key === tab);
  const visible = filtered.filter(activeTab.matches);

  const openCourseId = params.get('course');
  const openCourse = allCourses.find((c) => c.id === openCourseId);

  const setCourseParam = (id) => {
    const next = new URLSearchParams(params);
    if (id) next.set('course', id); else next.delete('course');
    setParams(next, { replace: true });
  };

  const isFiltered = Boolean(text || planId || tab !== 'all');
  const clearFilters = () => { setSearch(''); setPlanId(''); setTab('all'); };

  return (
    <>
      <PageHeader
        eyebrow="My training"
        title="Training Materials"
        subtitle="Browse your curriculum, open a course, or pick up where you left off."
      />

      <section className="card panel">
        <div className="toolbar">
          <div className="tab-filter" role="group" aria-label="Show courses">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                className={`tab-filter__tab ${tab === t.key ? 'is-current' : ''}`}
                aria-pressed={tab === t.key}
                onClick={() => setTab(t.key)}
              >
                {t.label}
                {training.data && <span className="tab-filter__count">{filtered.filter(t.matches).length}</span>}
              </button>
            ))}
          </div>
        </div>

        <div className="filters filters--materials">
          <Select label="Plan" value={planId} onChange={(e) => setPlanId(e.target.value)} placeholder="All my plans"
            options={plans.map((p) => ({ value: p.planId, label: p.planName }))} />
          <Input icon="search" type="search" label="Search" placeholder="Course or plan…"
            value={search} onChange={(e) => setSearch(e.target.value)} maxLength={100} />
          <Button variant="ghost" size="sm" onClick={clearFilters} disabled={!isFiltered}>Clear filters</Button>
        </div>

        <div className="panel__body">
          {training.error && (
            <div className="inline-error inline-error--row" role="alert">
              <span>{training.error}</span>
              <Button variant="secondary" size="sm" onClick={training.reload}>Try again</Button>
            </div>
          )}
          {!training.data && !training.error && <p className="loading-text">Loading your courses…</p>}

          {training.data && allCourses.length === 0 && (
            <div className="empty-state">
              <strong>No training assigned yet</strong>
              <span>When a trainer assigns you a training plan, its courses appear here.</span>
            </div>
          )}
          {allCourses.length > 0 && visible.length === 0 && (
            <div className="empty-state">
              <strong>No courses match</strong>
              <span>Try another tab or plan, or clear the filters.</span>
              <Button variant="secondary" size="sm" onClick={clearFilters}>Clear filters</Button>
            </div>
          )}

          {visible.length > 0 && (
            <div className="material-grid">
              {visible.map((course) => (
                <MyCourseCard key={course.id} course={course} onOpen={() => setCourseParam(course.id)} />
              ))}
            </div>
          )}
        </div>
      </section>

      {openCourse && (
        <CourseModal
          course={openCourse}
          onClose={() => setCourseParam(null)}
          onUpdate={training.update}
        />
      )}
    </>
  );
}

function MyCourseCard({ course, onOpen }) {
  const type = materialType(course);
  const info = MATERIAL_INFO[type];
  const status = COURSE_STATUS[course.status];
  const tone = course.status === 'completed' ? toneForStatus('completed') : 'primary';

  return (
    <article className="card material-card">
      <div className={`material-card__cover material-card__cover--${type}`}>
        <span className="material-card__plan">{course.planName}</span>
        <Icon name={info.icon} size={30} className="material-card__icon" />
        <span className="material-card__type">{info.label}</span>
      </div>
      <div className="material-card__body">
        <h3 className="material-card__title">
          <button type="button" className="material-card__open" onClick={onOpen}>{course.name}</button>
        </h3>
        <p className="material-card__meta">
          <Icon name="clock" size={13} /> {formatMinutes(course.durationMinutes)}
          <span aria-hidden="true">·</span>
          {course.planUpcoming ? `Starts ${formatDay(course.planStartDate)}` : `Due ${formatDay(course.planDueDate)}`}
        </p>
        <div className="material-card__progress">
          <ProgressBar value={course.completionPct} tone={tone} label={`${course.name} progress`} />
        </div>
      </div>
      <footer className="material-card__foot">
        <Badge tone={status.tone} dot>{status.label}</Badge>
        <Button variant="ghost" size="sm" icon="arrowRight" iconPosition="end" onClick={onOpen}
          aria-label={`${status.action} ${course.name}`}>
          {status.action}
        </Button>
      </footer>
    </article>
  );
}
