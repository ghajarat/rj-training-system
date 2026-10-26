// Right column: the sources of the last answer (FR11) and related courses
// that link to the training screens.
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/useAuth';
import { ROLES } from '../../auth/roles';
import Button from '../../components/Button';
import Icon from '../../components/Icon';
import ProgressBar from '../../components/ProgressBar';
import { sourcePlace, useOpenSource } from './sources';

// Trainees open the course in My Materials; trainers and admins go to its plan.
function courseLink(course, role) {
  return role === ROLES.TRAINEE ? `/materials?course=${course.id}` : `/plans/${course.planId}`;
}

export default function AssistantSidePanel({ answer }) {
  const { user } = useAuth();
  const source = useOpenSource();
  const citations = answer?.citations || [];
  const courses = answer?.relatedCourses || [];

  return (
    <aside className="assistant__side" aria-label="Sources and related courses">
      <section className="side-section">
        <h3 className="side-section__title">Sources for last answer</h3>
        {citations.length === 0 ? (
          <p className="side-section__empty">
            {answer ? 'The last answer has no SOP sources.' : 'Sources appear here after an answer.'}
          </p>
        ) : (
          <ul className="side-list">
            {citations.map((c) => (
              <li key={c.n} className="source-card">
                <span className="source-card__icon" aria-hidden="true"><Icon name="file" size={18} /></span>
                <div className="source-card__text">
                  <strong><span className="citation-chip__n">{c.n}</span> {c.title}</strong>
                  {sourcePlace(c) && <span>{sourcePlace(c)}</span>}
                  <Button variant="ghost" size="sm" icon="eye" loading={source.busyId === c.docId}
                    onClick={() => source.open(c.docId)}>
                    Open
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {source.error && <p className="inline-error" role="alert">{source.error}</p>}
      </section>

      <section className="side-section">
        <h3 className="side-section__title">Related courses</h3>
        {courses.length === 0 ? (
          <p className="side-section__empty">
            {answer ? 'No related courses for this answer.' : 'Courses that match your question appear here.'}
          </p>
        ) : (
          <ul className="side-list">
            {courses.map((course) => (
              <li key={course.id}>
                <Link to={courseLink(course, user.role)} className="course-link">
                  <strong>{course.name}</strong>
                  <span className="course-link__plan">{course.planName}</span>
                  {course.completionPct !== null && (
                    <>
                      <ProgressBar value={course.completionPct} showLabel={false} label={`${course.name} progress`} />
                      <span className="course-link__pct">{course.completionPct}% complete</span>
                    </>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}
