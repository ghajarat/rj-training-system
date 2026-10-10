// Admin landing page (FR19). In Phase 2 this reads the real user list from
// GET /api/users — an admin-only endpoint — which proves the whole chain:
// sign-in → JWT → interceptor → role middleware → database → UI.
// Invite / edit / deactivate are added in Phase 4a.
import { useEffect, useState } from 'react';
import api, { getErrorMessage } from '../api/client';
import Button from '../components/Button';
import PageHeader from './PageHeader';

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

export default function UserManagement() {
  const [users, setUsers] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.get('/users')
      .then(({ data }) => { if (!cancelled) setUsers(data.users); })
      .catch((err) => { if (!cancelled) setError(getErrorMessage(err)); });
    return () => { cancelled = true; };
  }, []);

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="User Management"
        subtitle="Everyone with access to the training system. Accounts are created by invitation only."
        actions={<Button icon="users" disabled title="Coming in Phase 4a">Invite user</Button>}
      />

      <section className="card panel">
        <h2 className="panel__title">
          All users {users && <span style={{ color: 'var(--color-text-muted)', fontWeight: 500 }}>· {users.length}</span>}
        </h2>
        <div className="panel__body">
          {error && <p className="inline-error" role="alert">{error}</p>}
          {!error && !users && <p className="stat-card__foot">Loading users…</p>}
          {users && (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Department</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td className="table__name">{u.fullName}</td>
                      <td>{u.email}</td>
                      <td><span className={`role-badge role-badge--${u.role}`}>{u.role}</span></td>
                      <td>{u.department || '—'}</td>
                      <td>{dateFmt.format(new Date(u.createdAt))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
