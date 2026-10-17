// User Management (Admin home) — design: docs/designs/User_man.png.
//
//   FR1   invite users and assign a role (one-time link, no self-signup)
//   FR19  edit, deactivate and reactivate accounts (soft — never deleted)
//   FR2   every action here is written to the audit log by the backend
//
// The design's system-status cards and SOP Library panel are left out on
// purpose: they need data from Phase 5+ and would otherwise show fake numbers.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getErrorMessage } from '../../api/client';
import { deactivateUser, issueSetupLink, reactivateUser } from '../../api/admin';
import { useAuth } from '../../auth/useAuth';
import Button from '../../components/Button';
import ConfirmDialog from '../../components/ConfirmDialog';
import Icon from '../../components/Icon';
import Input from '../../components/Input';
import Menu from '../../components/Menu';
import Pagination from '../../components/Pagination';
import Select from '../../components/Select';
import useDebouncedValue from '../../hooks/useDebouncedValue';
import useFetch from '../../hooks/useFetch';
import { initials, plural, timeAgo } from '../../utils/format';
import PageHeader from '../PageHeader';
import EditUserModal from './EditUserModal';
import InviteUserModal from './InviteUserModal';
import SetupLinkModal from './SetupLinkModal';
import { RoleBadge, StatusBadge } from './UserBadges';
import { ROLE_OPTIONS, STATUS_OPTIONS } from './userOptions';
import './admin.css';

const PAGE_SIZE = 20;
const NO_FILTERS = { role: '', departmentId: '', status: '' };

export default function UserManagement() {
  const { user: me } = useAuth();
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState(NO_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  // null | { type: 'invite' | 'edit' | 'link' | 'deactivate', ... }
  const [dialog, setDialog] = useState(null);
  const [notice, setNotice] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [busy, setBusy] = useState(false);

  const debouncedSearch = useDebouncedValue(search.trim());
  const params = { page, pageSize: PAGE_SIZE };
  if (debouncedSearch) params.search = debouncedSearch;
  for (const [key, value] of Object.entries(filters)) if (value) params[key] = value;

  const users = useFetch('/users', params);
  const departments = useFetch('/departments');
  const departmentList = departments.data?.departments || [];

  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  const isFiltered = Boolean(debouncedSearch) || activeFilterCount > 0;

  // Any change to the query goes back to page 1.
  const changeSearch = (event) => { setSearch(event.target.value); setPage(1); };
  const changeFilter = (key) => (event) => {
    setFilters((f) => ({ ...f, [key]: event.target.value }));
    setPage(1);
  };
  const clearFilters = () => { setSearch(''); setFilters(NO_FILTERS); setPage(1); };

  const closeDialog = () => { setDialog(null); setActionError(null); };

  const done = (message) => {
    setNotice(message);
    closeDialog();
    users.reload();
  };

  // ---- Row actions ---------------------------------------------------
  const sendSetupLink = async (user) => {
    setNotice(null);
    setActionError(null);
    try {
      const result = await issueSetupLink(user.id);
      setDialog({ type: 'link', user: result.user, url: result.setupUrl, expiresAt: result.expiresAt, purpose: result.purpose });
      users.reload();
    } catch (err) {
      setActionError(getErrorMessage(err));
    }
  };

  const confirmDeactivate = async () => {
    setBusy(true);
    try {
      await deactivateUser(dialog.user.id);
      done(`${dialog.user.fullName} was deactivated and signed out.`);
    } catch (err) {
      setActionError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const reactivate = async (user) => {
    setActionError(null);
    try {
      await reactivateUser(user.id);
      done(`${user.fullName} was reactivated.`);
    } catch (err) {
      setActionError(getErrorMessage(err));
    }
  };

  const menuItems = (user) => {
    const isSelf = user.id === me.id;
    const pending = user.status === 'invited' || user.status === 'invite_expired';
    const items = [{ label: 'Edit details', icon: 'edit', onSelect: () => setDialog({ type: 'edit', user }) }];
    if (user.status === 'inactive') {
      items.push({ label: 'Reactivate', icon: 'userCheck', onSelect: () => reactivate(user) });
    } else {
      items.push({
        label: pending ? 'New invitation link' : 'Password-reset link',
        icon: 'link',
        onSelect: () => sendSetupLink(user),
      });
    }
    items.push({
      label: 'View activity',
      icon: 'history',
      onSelect: () => navigate(`/admin/audit-log?userId=${user.id}`),
    });
    if (user.status !== 'inactive' && !isSelf) {
      items.push({
        label: pending ? 'Cancel invitation' : 'Deactivate',
        icon: 'userOff',
        tone: 'danger',
        onSelect: () => setDialog({ type: 'deactivate', user }),
      });
    }
    return items;
  };

  // ---- Render --------------------------------------------------------
  const data = users.data;
  const rows = data?.users || [];

  return (
    <>
      <PageHeader
        eyebrow="System Administration"
        title="User Management"
        subtitle="Invite people, manage their roles and access, and review every admin action."
        actions={(
          <>
            <Button variant="secondary" icon="clipboard" onClick={() => navigate('/admin/audit-log')}>Audit log</Button>
            <Button icon="plus" onClick={() => { setNotice(null); setDialog({ type: 'invite' }); }}>Invite user</Button>
          </>
        )}
      />

      {notice && (
        <div className="inline-success" role="status">
          <Icon name="check" size={16} />
          <span>{notice}</span>
          <button type="button" className="inline-success__close" onClick={() => setNotice(null)} aria-label="Dismiss">
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
      {actionError && !dialog && <p className="inline-error page-alert" role="alert">{actionError}</p>}

      <section className="card panel">
        <div className="toolbar">
          <h2 className="panel__title toolbar__title">
            Users
            {data && (
              <span className="toolbar__meta">
                {data.counts.total} total · {plural(data.counts.pendingInvites, 'pending invitation')}
              </span>
            )}
          </h2>
          <div className="toolbar__controls">
            <Input
              className="toolbar__search"
              icon="search"
              type="search"
              placeholder="Search name or email…"
              aria-label="Search users"
              value={search}
              onChange={changeSearch}
              maxLength={100}
            />
            <button
              type="button"
              className={`icon-toggle ${showFilters || activeFilterCount ? 'is-on' : ''}`}
              onClick={() => setShowFilters((s) => !s)}
              aria-expanded={showFilters}
              aria-controls="user-filters"
              aria-label={`Filters${activeFilterCount ? ` (${activeFilterCount} active)` : ''}`}
              title="Filters"
            >
              <Icon name="filter" size={16} />
              {activeFilterCount > 0 && <span className="icon-toggle__count">{activeFilterCount}</span>}
            </button>
          </div>
        </div>

        {showFilters && (
          <div id="user-filters" className="filters">
            <Select label="Role" value={filters.role} onChange={changeFilter('role')}
              placeholder="All roles" options={ROLE_OPTIONS} />
            <Select label="Department" value={filters.departmentId} onChange={changeFilter('departmentId')}
              placeholder="All departments" options={departmentList.map((d) => ({ value: d.id, label: d.name }))} />
            <Select label="Status" value={filters.status} onChange={changeFilter('status')}
              placeholder="All statuses" options={STATUS_OPTIONS} />
            <Button variant="ghost" size="sm" onClick={clearFilters} disabled={!isFiltered}>Clear filters</Button>
          </div>
        )}

        <div className="panel__body">
          {users.error && (
            <div className="inline-error inline-error--row" role="alert">
              <span>{users.error}</span>
              <Button variant="secondary" size="sm" onClick={users.reload}>Try again</Button>
            </div>
          )}

          {!data && !users.error && <p className="loading-text">Loading users…</p>}

          {data && rows.length === 0 && (
            isFiltered ? (
              <div className="empty-state">
                <strong>No users match your search</strong>
                <span>Try a different name, or clear the filters.</span>
                <Button variant="secondary" size="sm" onClick={clearFilters}>Clear filters</Button>
              </div>
            ) : (
              <div className="empty-state">
                <strong>No users yet</strong>
                <span>Invite the first person to give them access.</span>
                <Button size="sm" icon="plus" onClick={() => setDialog({ type: 'invite' })}>Invite user</Button>
              </div>
            )
          )}

          {rows.length > 0 && (
            <div className={`table-wrap ${users.loading ? 'is-loading' : ''}`} aria-busy={users.loading}>
              <table className="table table--users">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th className="hide-sm">Department</th>
                    <th>Role</th>
                    <th className="hide-sm">Last active</th>
                    <th>Status</th>
                    <th><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((u) => (
                    <tr key={u.id} className={u.status === 'inactive' ? 'is-muted' : ''}>
                      <td>
                        <div className="user-cell">
                          <span className="avatar">{initials(u.fullName)}</span>
                          <span className="user-cell__text">
                            <span className="table__name">
                              {u.fullName}
                              {u.id === me.id && <span className="user-cell__you">You</span>}
                            </span>
                            <span className="user-cell__email">{u.email}</span>
                          </span>
                        </div>
                      </td>
                      <td className="hide-sm">{u.department || '—'}</td>
                      <td><RoleBadge role={u.role} /></td>
                      <td className="hide-sm" title={u.lastActiveAt ? new Date(u.lastActiveAt).toLocaleString() : undefined}>
                        {timeAgo(u.lastActiveAt)}
                      </td>
                      <td><StatusBadge status={u.status} /></td>
                      <td className="table__actions">
                        <Menu label={`Actions for ${u.fullName}`} items={menuItems(u)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data && <Pagination pagination={data.pagination} onPageChange={setPage} itemLabel="users" disabled={users.loading} />}
        </div>
      </section>

      {dialog?.type === 'invite' && (
        <InviteUserModal
          departments={departmentList}
          onClose={closeDialog}
          onInvited={(result) => {
            setDialog({ type: 'link', user: result.user, url: result.inviteUrl, expiresAt: result.inviteExpiresAt, purpose: 'invite' });
            setNotice(`${result.user.fullName} was invited as ${result.user.role}.`);
            users.reload();
          }}
        />
      )}

      {dialog?.type === 'edit' && (
        <EditUserModal
          user={dialog.user}
          isSelf={dialog.user.id === me.id}
          departments={departmentList}
          onClose={closeDialog}
          onSaved={(saved) => done(`${saved.fullName} was updated.`)}
        />
      )}

      {dialog?.type === 'link' && (
        <SetupLinkModal
          user={dialog.user}
          url={dialog.url}
          expiresAt={dialog.expiresAt}
          purpose={dialog.purpose}
          onClose={closeDialog}
        />
      )}

      <ConfirmDialog
        open={dialog?.type === 'deactivate'}
        title={dialog?.user?.status === 'active' ? `Deactivate ${dialog?.user?.fullName}?` : `Cancel invitation for ${dialog?.user?.fullName}?`}
        confirmLabel={dialog?.user?.status === 'active' ? 'Deactivate' : 'Cancel invitation'}
        tone="danger"
        busy={busy}
        error={dialog?.type === 'deactivate' ? actionError : null}
        onConfirm={confirmDeactivate}
        onCancel={closeDialog}
      >
        {dialog?.user?.status === 'active'
          ? 'They will be signed out right away and cannot sign in until an admin reactivates them. Their training history is kept.'
          : 'Their invitation link stops working. You can reactivate the account later and send a new link.'}
      </ConfirmDialog>
    </>
  );
}
