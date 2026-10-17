// 1–5 star rating (FR6 course feedback; reusable for later phases).
//
//   <StarRating value={rating} onChange={setRating} />     pick a rating
//   <StarRating value={4} readOnly />                      show one
//
// The picker is five native radio buttons with stars as their labels, so the
// keyboard (Tab, then arrow keys) and screen readers work without extra code.
import { useId, useState } from 'react';
import Icon from './Icon';
import './StarRating.css';

const RATING_LABELS = ['Poor', 'Fair', 'Good', 'Very good', 'Excellent'];

export default function StarRating({
  value = 0, onChange, readOnly = false, disabled = false, label = 'Rating', size = 24,
}) {
  const name = useId();
  const [hover, setHover] = useState(0);
  const shown = hover || value;

  if (readOnly) {
    return (
      <span className="stars stars--readonly" role="img" aria-label={`${value} out of 5 stars`}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Icon key={n} name="star" size={size} className={n <= value ? 'stars__icon is-on' : 'stars__icon'} />
        ))}
      </span>
    );
  }

  return (
    <fieldset className="stars" disabled={disabled} onMouseLeave={() => setHover(0)}>
      <legend className="field__label">{label}</legend>
      <div className="stars__row">
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className="stars__option" onMouseEnter={() => setHover(n)}>
            <input
              type="radio"
              className="sr-only"
              name={name}
              value={n}
              checked={value === n}
              onChange={() => onChange(n)}
            />
            <Icon name="star" size={size} className={n <= shown ? 'stars__icon is-on' : 'stars__icon'} />
            <span className="sr-only">{`${n} – ${RATING_LABELS[n - 1]}`}</span>
          </label>
        ))}
        <span className="stars__text" aria-hidden="true">
          {shown ? RATING_LABELS[shown - 1] : 'Choose a rating'}
        </span>
      </div>
    </fieldset>
  );
}
