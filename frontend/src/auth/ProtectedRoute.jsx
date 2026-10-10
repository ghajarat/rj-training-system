// Route guards (frontend half of NFR07 — the backend enforces it too).
//
//   <Route element={<ProtectedRoute />}>                     any signed-in user
//   <Route element={<ProtectedRoute roles={['Admin']} />}>   admins only
//
// Signed out          → /signin (remembering where they were headed)
// Signed in, wrong role → their own home page
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './useAuth';
import { homeFor } from './roles';

export default function ProtectedRoute({ roles }) {
  const { user, status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return <div className="page-loader">Loading…</div>;
  }

  if (status !== 'authenticated') {
    return <Navigate to="/signin" replace state={{ from: location.pathname }} />;
  }

  if (roles && !roles.includes(user.role)) {
    return <Navigate to={homeFor(user.role)} replace />;
  }

  return <Outlet />;
}

// Sends "/" (and anything that needs a default) to the user's role home.
export function RoleHomeRedirect() {
  const { user, status } = useAuth();
  if (status === 'loading') return <div className="page-loader">Loading…</div>;
  if (status !== 'authenticated') return <Navigate to="/signin" replace />;
  return <Navigate to={homeFor(user.role)} replace />;
}
