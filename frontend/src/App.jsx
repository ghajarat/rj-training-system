// All routes live here.
//
//   /signin, /forgot-password,
//   /set-password                        public (invite / reset links, FR1)
//   everything else                      inside <AppShell>, signed-in only
//   per-page `roles`                     enforced by <ProtectedRoute roles={...}>
//
// Role homes: Trainee → /dashboard, Trainer → /trainer, Admin → /admin/users
//
// Phase 4b (Trainer + Admin): /materials, /plans, /plans/:id, /trainees
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { useAuth } from './auth/useAuth';
import ProtectedRoute, { RoleHomeRedirect } from './auth/ProtectedRoute';
import { ROLES } from './auth/roles';
import AppShell from './layout/AppShell';
import SignIn from './pages/SignIn';
import ForgotPassword from './pages/ForgotPassword';
import MyDashboard from './pages/MyDashboard';
import TrainerOverview from './pages/TrainerOverview';
import SetPassword from './pages/SetPassword';
import UserManagement from './pages/admin/UserManagement';
import AuditLog from './pages/admin/AuditLog';
import ComingSoon from './pages/ComingSoon';
import TrainingMaterials from './pages/training/TrainingMaterials';
import TrainingPlans from './pages/training/TrainingPlans';
import PlanDetail from './pages/training/PlanDetail';
import MyMaterials from './pages/training/MyMaterials';
import MyTrainees from './pages/training/MyTrainees';

const { TRAINEE, TRAINER, ADMIN } = ROLES;

// One URL, two screens: trainers and admins manage materials (FR7, Phase 4b);
// trainees study them and track their progress (FR4–FR6, Phase 4c).
function MaterialsPage() {
  const { user } = useAuth();
  return user.role === TRAINEE
    ? <MyMaterials />
    : <TrainingMaterials />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/signin" element={<SignIn />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/set-password" element={<SetPassword />} />

          <Route element={<ProtectedRoute />}>
            <Route element={<AppShell />}>
              <Route element={<ProtectedRoute roles={[TRAINEE]} />}>
                <Route path="/dashboard" element={<MyDashboard />} />
              </Route>

              <Route element={<ProtectedRoute roles={[TRAINER]} />}>
                <Route path="/trainer" element={<TrainerOverview />} />
              </Route>

              <Route element={<ProtectedRoute roles={[ADMIN]} />}>
                <Route path="/admin/users" element={<UserManagement />} />
                <Route path="/admin/audit-log" element={<AuditLog />} />
                <Route path="/admin/sop-library" element={<ComingSoon title="SOP Library" phase="Phase 5 · FR13" />} />
                <Route path="/admin/system-health" element={<ComingSoon title="System Health" phase="Phase 8 · Reports" />} />
              </Route>

              <Route element={<ProtectedRoute roles={[TRAINEE, TRAINER, ADMIN]} />}>
                <Route path="/materials" element={<MaterialsPage />} />
              </Route>

              <Route element={<ProtectedRoute roles={[TRAINER, ADMIN]} />}>
                <Route path="/plans" element={<TrainingPlans />} />
                <Route path="/plans/:id" element={<PlanDetail />} />
                <Route path="/trainees" element={<MyTrainees />} />
                <Route path="/analytics" element={<ComingSoon title="Analytics & ROI" phase="Phase 7" />} />
                <Route path="/reports" element={<ComingSoon title="Reports" phase="Phase 8" />} />
              </Route>

              <Route path="/assistant" element={<ComingSoon title="AI Assistant" phase="Phase 5" />} />
              <Route path="/help" element={<ComingSoon title="Help & Resources" />} />
              <Route path="/settings" element={<ComingSoon title="Settings" />} />
            </Route>
          </Route>

          {/* "/" and any unknown URL → the signed-in user's home, or Sign-In */}
          <Route path="*" element={<RoleHomeRedirect />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
