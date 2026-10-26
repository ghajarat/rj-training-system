// Numbered source chips under an answer (FR11). A chip expands to show the
// SOP title, section, page and the passage the answer came from, with a
// button to open the SOP file.
import Button from '../../components/Button';
import { sourcePlace, useOpenSource } from './sources';

export default function Citations({ citations, open, onToggle }) {
  const source = useOpenSource();
  const selected = citations.find((c) => c.n === open);

  return (
    <div className="citations">
      <span className="citations__label">Sources</span>
      <ul className="citations__chips">
        {citations.map((c) => (
          <li key={c.n}>
            <button type="button" className={`citation-chip ${open === c.n ? 'is-open' : ''}`}
              onClick={() => onToggle(open === c.n ? null : c.n)} aria-expanded={open === c.n}>
              <span className="citation-chip__n">{c.n}</span>
              <span className="citation-chip__title">{c.title}</span>
            </button>
          </li>
        ))}
      </ul>
      {selected && (
        <div className="citation-detail">
          <strong>{selected.title}</strong>
          {sourcePlace(selected) && <span className="citation-detail__place">{sourcePlace(selected)}</span>}
          <blockquote>{selected.excerpt}</blockquote>
          <div className="citation-detail__foot">
            <Button variant="secondary" size="sm" icon="external" loading={source.busyId === selected.docId}
              onClick={() => source.open(selected.docId)}>
              Open SOP
            </Button>
            {source.error && <span className="text-danger">{source.error}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
