// Set-password page (FR1) for invitation and password-reset links:
//   /set-password?token=...
//
// 1. Check the link with POST /auth/setup/verify (greets the user, or says
//    the link has expired).
// 2. User picks a password → POST /auth/setup.
// 3. Back to Sign-In with a success message and their email filled in.
//
// Always ends signed out, on the Sign-In page.
//
// The token is removed from the address bar once read, so it does not stay
// in browser history or on screen.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { getErrorMessage } from '../api/client';
import { completeSetup, verifySetupLink } from '../api/admin';
import { useAuth } from '../auth/useAuth';
import BrandMark from '../components/BrandMark';
import Button from '../components/Button';
import Icon from '../components/Icon';
import Input from '../components/Input';
import { checkPassword, PASSWORD_RULE } from './admin/userOptions';
import './SignIn.css';

export default function SetPassword() {
  const navigate = useNavigate();
  const { status: authStatus, logout } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  // Read once: the URL is cleaned right after.
  const [token] = useState(() => searchParams.get('token'));

  // 'checking' | 'invalid' | 'ready'
  const [linkState, setLinkState] = useState(token ? 'checking' : 'invalid');
  const [linkError, setLinkError] = useState(token ? null : 'This link is missing its token. Please use the full link you were sent.');
  const [account, setAccount] = useState(null);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!token) return undefined;
    setSearchParams({}, { replace: true });
    let cancelled = false;
    verifySetupLink(token)
      .then((info) => {
        if (cancelled) return;
        setAccount(info);
        setLinkState('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        setLinkError(getErrorMessage(err));
        setLinkState('invalid');
      });
    return () => { cancelled = true; };
  }, [token, setSearchParams]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setFormError(null);
    const next = {};
    const weak = checkPassword(password);
    if (weak) next.password = weak;
    if (confirm !== password) next.confirm = 'The two passwords do not match.';
    setErrors(next);
    if (Object.keys(next).length) return;

    setSaving(true);
    try {
      const { message } = await completeSetup(token, password);
      // If someone else is signed in on this device (e.g. the admin testing
      // the link), end that session so the new user signs in as themselves.
      if (authStatus !== 'anonymous') logout();
      navigate('/signin', { replace: true, state: { success: message, email: account.email } });
    } catch (err) {
      if (err.response?.data?.error?.code === 'SETUP_LINK_INVALID') {
        setLinkError(getErrorMessage(err));
        setLinkState('invalid');
      } else {
        setFormError(getErrorMessage(err));
      }
      setSaving(false);
    }
  };

  const isInvite = account?.purpose === 'invite';

  return (
    <div className="signin__panel signin__panel--standalone">
      <div className="signin__form">
        <BrandMark tone="dark" />

        {linkState === 'checking' && <p className="signin__footnote">Checking your link…</p>}

        {linkState === 'invalid' && (
          <>
            <div className="signin__heading">
              <span className="signin__eyebrow">Account setup</span>
              <h2>This link can’t be used.</h2>
            </div>
            <div className="signin__alert" role="alert">
              <Icon name="alert" size={16} />
              <span>{linkError}</span>
            </div>
            <Link to="/signin" className="signin__forgot">← Back to sign in</Link>
          </>
        )}

        {linkState === 'ready' && (
          <form className="signin__form signin__form--nested" onSubmit={handleSubmit} noValidate>
            <div className="signin__heading">
              <span className="signin__eyebrow">{isInvite ? 'Welcome aboard' : 'Password reset'}</span>
              <h2>{isInvite ? `Welcome, ${account.fullName.split(' ')[0]}.` : 'Choose a new password.'}</h2>
              <p>
                {isInvite
                  ? 'Set a password to finish creating your training account.'
                  : `Set a new password for ${account.fullName}.`}
              </p>
            </div>

            {formError && (
              <div className="signin__alert" role="alert">
                <Icon name="alert" size={16} />
                <span>{formError}</span>
              </div>
            )}

            {/* Lets password managers save the new password against the right account */}
            <Input label="Email" icon="mail" type="email" name="email" autoComplete="username"
              value={account.email} readOnly />
            <Input
              label="New password"
              icon="lock"
              type="password"
              name="new-password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setErrors((x) => ({ ...x, password: undefined })); }}
              error={errors.password}
              hint={PASSWORD_RULE}
              autoFocus
            />
            <Input
              label="Confirm password"
              icon="lock"
              type="password"
              name="confirm-password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => { setConfirm(e.target.value); setErrors((x) => ({ ...x, confirm: undefined })); }}
              error={errors.confirm}
            />

            <Button type="submit" fullWidth loading={saving} icon="arrowRight" iconPosition="end">
              {saving ? 'Saving…' : 'Set password'}
            </Button>
            <p className="signin__footnote">This link works once. <Link to="/signin">Back to sign in</Link></p>
          </form>
        )}
      </div>
    </div>
  );
}
