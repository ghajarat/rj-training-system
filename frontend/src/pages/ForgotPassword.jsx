// Forgot Password (GP1 Fig. 28). There is no email service in scope, so
// self-service reset is not possible: an admin issues a one-time
// password-reset link from User Management, which opens /set-password.
import { Link } from 'react-router-dom';
import BrandMark from '../components/BrandMark';
import './SignIn.css';

export default function ForgotPassword() {
  return (
    <div className="signin__panel signin__panel--standalone">
      <div className="signin__form">
        <BrandMark tone="dark" />
        <div className="signin__heading">
          <span className="signin__eyebrow">Password help</span>
          <h2>Forgot your password?</h2>
          <p>
            Ask your system administrator for a password-reset link. It works
            once and lets you choose a new password.
          </p>
        </div>
        <Link to="/signin" className="signin__forgot">← Back to sign in</Link>
      </div>
    </div>
  );
}
