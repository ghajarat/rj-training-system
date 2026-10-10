// Placeholder for screens that exist in the navigation but are built in a
// later phase. Keeps the shell fully navigable from day one.
import PageHeader from './PageHeader';

export default function ComingSoon({ title, phase }) {
  return (
    <>
      <PageHeader eyebrow="In progress" title={title} />
      <section className="card panel">
        <div className="empty-state">
          <strong>This screen is on the way</strong>
          {phase && <span className="phase-tag">{phase}</span>}
        </div>
      </section>
    </>
  );
}
