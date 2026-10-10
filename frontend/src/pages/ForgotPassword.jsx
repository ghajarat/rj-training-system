// Placeholder for the Forgot / Reset Password flow (GP1 Fig. 28) so the
// "Forgot?" link on Sign-In goes somewhere sensible until it's built.
import { Link } from 'react-router-dom';
import BrandMark from '../components/BrandMark';
import './SignIn.css';

export default function ForgotPassword() {
  return (
    <div className="signin__panel" style={{ minHeight: '100%' }}>
      <div className="signin__form">
        <BrandMark tone="dark" />
        <div className="signin__heading">
          <span className="signin__eyebrow">Password help</span>
          <h2>Forgot your password?</h2>
          <p>
            Self-service reset isn’t available yet. Please contact your system
            administrator and they’ll reset it for you.
          </p>
        </div>
        <Link to="/signin" className="signin__forgot">← Back to sign in</Link>
      </div>
    </div>
  );
}
