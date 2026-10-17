// <Button>Save</Button>
// <Button variant="secondary" icon="arrowRight" iconPosition="end">Next</Button>
// <Button loading>Signing in…</Button>
//
// variant: 'primary' (Flint Gray) | 'accent' (Prom Gold) | 'secondary' (outlined) | 'ghost' | 'danger'
// size:    'md' | 'sm'
import Icon from './Icon';
import './Button.css';

export default function Button({
  variant = 'primary',
  size = 'md',
  icon,
  iconPosition = 'start',
  loading = false,
  fullWidth = false,
  disabled,
  className = '',
  children,
  type = 'button',
  ...rest
}) {
  const classes = [
    'btn',
    `btn--${variant}`,
    `btn--${size}`,
    fullWidth && 'btn--full',
    loading && 'btn--loading',
    className,
  ].filter(Boolean).join(' ');

  const iconEl = icon && !loading ? <Icon name={icon} size={size === 'sm' ? 14 : 16} /> : null;

  return (
    <button type={type} className={classes} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading && <span className="btn__spinner" aria-hidden="true" />}
      {iconPosition === 'start' && iconEl}
      <span>{children}</span>
      {iconPosition === 'end' && iconEl}
    </button>
  );
}
