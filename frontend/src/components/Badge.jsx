// Small pill label for statuses, roles and audit actions.
//
//   <Badge tone="success" dot>Active</Badge>
//
// tone: 'neutral' | 'primary' | 'accent' | 'success' | 'warning' | 'danger'
import './Badge.css';

export default function Badge({ tone = 'neutral', dot = false, children }) {
  return (
    <span className={`badge badge--${tone}`}>
      {dot && <span className="badge__dot" aria-hidden="true" />}
      {children}
    </span>
  );
}
