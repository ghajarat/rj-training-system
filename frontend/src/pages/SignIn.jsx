// Sign-In screen (GP1 Fig. 27).
//
// Flow (GP1 Fig. 12/18): validate fields → POST /auth/login → store token →
// redirect to the page they were trying to reach, or their role's home.
import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { homeFor } from '../auth/roles';
import { NAV_SECTIONS } from '../layout/navigation';
import { getErrorMessage } from '../api/client';
import BrandMark from '../components/BrandMark';
import Button from '../components/Button';
import Input from '../components/Input';
import Icon from '../components/Icon';
import './SignIn.css';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Only follow a "from" redirect if this role is actually allowed there;
// otherwise a trainee who bookmarked /admin/users would bounce around.
function canVisit(role, path) {
  if (!path) return false;
  const item = NAV_SECTIONS.flatMap((s) => s.items).find((i) => path.startsWith(i.path));
  return Boolean(item && item.roles.includes(role));
}

export default function SignIn() {
  const { user, status, login, notice, clearNotice } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from;
  // Set by the set-password page after an invite or reset is completed.
  const success = location.state?.success;

  const [email, setEmail] = useState(location.state?.email || '');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const emailRef = useRef(null);

  useEffect(() => { emailRef.current?.focus(); }, []);

  // Already signed in (e.g. pressed Back) → straight to their home.
  if (status === 'authenticated' && !submitting) {
    return <Navigate to={homeFor(user.role)} replace />;
  }

  const validate = () => {
    const errors = {};
    if (!email.trim()) errors.email = 'Enter your corporate email.';
    else if (!EMAIL_RE.test(email.trim())) errors.email = 'That doesn’t look like a valid email address.';
    if (!password) errors.password = 'Enter your password.';
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setFormError(null);
    clearNotice();
    if (!validate()) return;

    setSubmitting(true);
    try {
      const signedIn = await login(email.trim(), password, remember);
      const target = canVisit(signedIn.role, from) ? from : homeFor(signedIn.role);
      navigate(target, { replace: true });
    } catch (error) {
      setFormError(getErrorMessage(error));
      setPassword('');
      setSubmitting(false);
    }
  };

  const banner = formError || notice;

  return (
    <div className="signin">
      <section className="signin__hero" aria-hidden="true">
        <div className="signin__glow" />
        <div className="signin__compass" />
        <Icon name="plane" size={44} className="signin__plane" />

        <BrandMark tone="light" />

        <div className="signin__pitch">
          <span className="signin__pill">AI-powered corporate learning</span>
          <h1 className="signin__headline">
            Where every flight begins
            <em>with mastery.</em>
          </h1>
          <p className="signin__lede">
            A unified learning platform connecting cabin crew, ground operations,
            and flight teams to the standards we fly by.
          </p>
        </div>

        <dl className="signin__stats">
          <div><dt>Active crew</dt><dd>2,840</dd><span>across 9 fleet types</span></div>
          <div><dt>Courses live</dt><dd>147</dd><span>safety · ops · service</span></div>
          <div><dt>Compliance</dt><dd>98.7%</dd><span>up 1.2 pts vs Q1</span></div>
        </dl>

        <ul className="signin__badges">
          <li>IATA aligned</li>
          <li>Role-based access</li>
          <li>ISO 9001:2015</li>
        </ul>
      </section>

      <section className="signin__panel">
        <form className="signin__form" onSubmit={handleSubmit} noValidate>
          <div className="signin__mobile-brand"><BrandMark tone="dark" /></div>

          <div className="signin__heading">
            <span className="signin__eyebrow">Employee portal</span>
            <h2>Welcome back.</h2>
            <p>Sign in with your employee credentials to continue your training.</p>
          </div>

          {success && !banner && (
            <div className="signin__alert signin__alert--success" role="status">
              <Icon name="check" size={16} />
              <span>{success}</span>
            </div>
          )}

          {banner && (
            <div className="signin__alert" role="alert">
              <Icon name="alert" size={16} />
              <span>{banner}</span>
            </div>
          )}

          <Input
            ref={emailRef}
            label="Corporate Email"
            icon="mail"
            type="email"
            name="email"
            autoComplete="username"
            placeholder="name@rj.com"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setFieldErrors((f) => ({ ...f, email: undefined })); }}
            error={fieldErrors.email}
          />

          <Input
            label="Password"
            icon="lock"
            type="password"
            name="password"
            autoComplete="current-password"
            placeholder="Enter your password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setFieldErrors((f) => ({ ...f, password: undefined })); }}
            error={fieldErrors.password}
          />

          <div className="signin__row">
            <label className="signin__remember">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              <span>Remember this device</span>
            </label>
            <Link to="/forgot-password" className="signin__forgot">Forgot?</Link>
          </div>

          <Button type="submit" fullWidth loading={submitting} icon="arrowRight" iconPosition="end">
            {submitting ? 'Signing in…' : 'Sign in'}
          </Button>

          <p className="signin__footnote">
            Don’t have access? Contact your training coordinator or system administrator
            to have an account created for you.
          </p>
        </form>
      </section>
    </div>
  );
}
