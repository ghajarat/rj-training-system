// One course, trainee side (Phase 4c): open its material (FR4), set my
// progress (FR5) and give feedback (FR6). Used by Training Materials and,
// through its ?course= link, by My Dashboard's "Resume course".
//
// `course` comes from flattenCourses() and is always the latest copy: every
// save returns the refreshed plan list, the parent stores it, and this
// window re-renders with the new status and feedback.
import { useState } from 'react';
import { getErrorMessage } from '../../api/client';
import { COMMENT_MAX, PROGRESS_STEPS, downloadMyMaterial, saveFeedback, setProgress } from '../../api/me';
import Badge from '../../components/Badge';
import Button from '../../components/Button';
import Icon from '../../components/Icon';
import Modal from '../../components/Modal';
import StarRating from '../../components/StarRating';
import Textarea from '../../components/Textarea';
import { formatDate, formatDay, formatMinutes } from '../../utils/format';
import { COURSE_STATUS, MATERIAL_INFO, PROGRESS_STEP_LABELS, materialType } from './trainingOptions';

export default function CourseModal({ course, onClose, onUpdate }) {
  const [opening, setOpening] = useState(false);
  const [savingStep, setSavingStep] = useState(null);
  const [error, setError] = useState(null);

  const status = COURSE_STATUS[course.status];
  const type = materialType(course);
  const started = course.status !== 'not_started';

  // Decision 1: opening the material marks a new course as started.
  // If that save fails the material is still open, so the error is not
  // shown; the trainee can still pick "Started" by hand.
  const markStarted = async () => {
    if (started) return;
    try {
      onUpdate(await setProgress(course.id, 0));
    } catch { /* see above */ }
  };

  const openFile = async () => {
    setOpening(true);
    setError(null);
    try {
      await downloadMyMaterial(course);
      await markStarted();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setOpening(false);
    }
  };

  const chooseStep = async (pct) => {
    if (pct === course.completionPct && started) return;
    setSavingStep(pct);
    setError(null);
    try {
      onUpdate(await setProgress(course.id, pct));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSavingStep(null);
    }
  };

  return (
    <Modal
      open
      size="md"
      title={course.name}
      description={`${course.planName} · Course ${course.position} of ${course.planCourseCount}`}
      onClose={onClose}
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}
    >
      <div className="course-modal">
        <p className="course-modal__meta">
          <Badge tone={status.tone} dot>{status.label}</Badge>
          <span><Icon name="clock" size={13} /> {formatMinutes(course.durationMinutes)}</span>
          <span><Icon name="calendar" size={13} /> Plan due {formatDay(course.planDueDate)}</span>
        </p>
        {course.planUpcoming && (
          <p className="course-modal__note">
            This plan starts on {formatDay(course.planStartDate)}. You can already look at its material.
          </p>
        )}

        {error && <p className="inline-error" role="alert">{error}</p>}

        <section className="course-modal__section" aria-labelledby="course-material">
          <h3 id="course-material" className="course-modal__heading">Material</h3>
          {type === 'none' && (
            <p className="text-muted">Your trainer has not added material to this course yet.</p>
          )}
          {type === 'link' && (
            <a className="btn btn--primary" href={course.material.url} target="_blank" rel="noopener noreferrer"
              onClick={markStarted}>
              <Icon name="external" size={16} /><span>Open web page</span>
            </a>
          )}
          {type !== 'none' && type !== 'link' && (
            <Button icon="download" onClick={openFile} loading={opening}>
              {`Download ${MATERIAL_INFO[type].label}`}
            </Button>
          )}
        </section>

        <section className="course-modal__section" aria-labelledby="course-progress">
          <h3 id="course-progress" className="course-modal__heading">Your progress</h3>
          <div className="step-picker" role="group" aria-labelledby="course-progress">
            {PROGRESS_STEPS.map((pct) => {
              const current = started && course.completionPct === pct;
              return (
                <button
                  key={pct}
                  type="button"
                  className={`step-picker__step ${current ? 'is-current' : ''}`}
                  aria-pressed={current}
                  disabled={savingStep !== null}
                  onClick={() => chooseStep(pct)}
                >
                  {savingStep === pct ? 'Saving…' : PROGRESS_STEP_LABELS[pct]}
                </button>
              );
            })}
          </div>
          <p className="field__hint">
            {started
              ? `Currently ${course.completionPct}%, last updated ${formatDate(course.lastAccessedAt)}. You can change it at any time.`
              : 'Opening the material marks the course as started.'}
          </p>
        </section>

        <section className="course-modal__section" aria-labelledby="course-feedback">
          <h3 id="course-feedback" className="course-modal__heading">Your feedback</h3>
          {started
            ? <FeedbackForm key={course.id} course={course} onUpdate={onUpdate} />
            : <p className="text-muted">Start this course to rate it and leave a comment.</p>}
        </section>
      </div>
    </Modal>
  );
}

// FR6: one rating + comment per course, editable. Saved as written; the
// sentiment of the comment is analysed in Phase 7.
function FeedbackForm({ course, onUpdate }) {
  const saved = course.feedback;
  const [rating, setRating] = useState(saved?.rating || 0);
  const [comment, setComment] = useState(saved?.comment || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  const changed = rating !== (saved?.rating || 0) || comment.trim() !== (saved?.comment || '');

  const submit = async (event) => {
    event.preventDefault();
    if (!rating) {
      setError('Please choose a rating from 1 to 5 stars.');
      return;
    }
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      onUpdate(await saveFeedback(course.id, { rating, comment }));
      setDone(true);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="feedback-form" onSubmit={submit} noValidate>
      <StarRating value={rating} onChange={(n) => { setRating(n); setDone(false); }} disabled={busy}
        label="How useful was this course?" />
      <Textarea
        label="Comment (optional)"
        rows={3}
        value={comment}
        maxLength={COMMENT_MAX}
        onChange={(e) => { setComment(e.target.value); setDone(false); }}
        placeholder="What worked well? What could be better?"
        hint={`${comment.length} / ${COMMENT_MAX}`}
        disabled={busy}
      />
      {error && <p className="inline-error" role="alert">{error}</p>}
      <div className="feedback-form__actions">
        {done && !changed && (
          <span className="feedback-form__saved" role="status"><Icon name="check" size={14} /> Feedback saved</span>
        )}
        <Button type="submit" size="sm" loading={busy} disabled={!changed}>
          {saved ? 'Update feedback' : 'Send feedback'}
        </Button>
      </div>
    </form>
  );
}
