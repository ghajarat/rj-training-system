// "Royal Jordanian / TRAINING SYSTEM" lockup used in the sidebar and on
// Sign-In. The square badge is a neutral placeholder — swap in the real crest
// asset once the team has it.
import './BrandMark.css';

export default function BrandMark({ tone = 'light' }) {
  return (
    <div className={`brand brand--${tone}`}>
      <span className="brand__badge" aria-hidden="true">RJ</span>
      <span className="brand__text">
        <span className="brand__name">Royal Jordanian</span>
        <span className="brand__sub">Training System</span>
      </span>
    </div>
  );
}
