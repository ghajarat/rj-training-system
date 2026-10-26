// SOP Library — Admin only (FR13). The documents the AI Assistant answers
// from: upload, follow indexing, re-upload, re-index and delete.
//
// Indexing runs on the server after the upload is accepted. While any SOP is
// 'processing', the list refreshes itself every few seconds until it turns
// 'ready' or 'failed'. Every change is written to the audit log (FR2).
import { useEffect, useState } from 'react';
import { getErrorMessage } from '../../api/client';
import { deleteDocument, openDocument, reindexDocument } from '../../api/documents';
import Badge from '../../components/Badge';
import Button from '../../components/Button';
import ConfirmDialog from '../../components/ConfirmDialog';
import Icon from '../../components/Icon';
import Input from '../../components/Input';
import Menu from '../../components/Menu';
import useFetch from '../../hooks/useFetch';
import { formatDateTime, plural, timeAgo } from '../../utils/format';
import PageHeader from '../PageHeader';
import SopUploadModal from './SopUploadModal';
import './admin.css';

const POLL_MS = 3000;

function StatusCell({ doc }) {
  if (doc.status === 'processing') return <Badge tone="warning" dot>Indexing…</Badge>;
  if (doc.status === 'failed') {
    return (
      <span className="sop-status">
        <Badge tone="danger" dot>Failed</Badge>
        <small className="text-danger">{doc.error}</small>
      </span>
    );
  }
  if (doc.needsReindex) {
    return (
      <span className="sop-status">
        <Badge tone="accent" dot>Needs re-index</Badge>
        <small>Made with another embedding model, so not searchable.</small>
      </span>
    );
  }
  return <Badge tone="success" dot>Ready</Badge>;
}

export default function SopLibrary() {
  const documents = useFetch('/documents');
  const [search, setSearch] = useState('');
  // null | { type: 'upload' } | { type: 'replace' | 'delete', doc }
  const [dialog, setDialog] = useState(null);
  const [notice, setNotice] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [busy, setBusy] = useState(false);

  const list = documents.data?.documents || [];
  const processing = list.some((d) => d.status === 'processing');
  const { reload } = documents;

  useEffect(() => {
    if (!processing) return undefined;
    const timer = setInterval(reload, POLL_MS);
    return () => clearInterval(timer);
  }, [processing, reload]);

  const term = search.trim().toLowerCase();
  const rows = term ? list.filter((d) => d.title.toLowerCase().includes(term)) : list;
  const counts = {
    ready: list.filter((d) => d.status === 'ready' && !d.needsReindex).length,
    processing: list.filter((d) => d.status === 'processing').length,
    failed: list.filter((d) => d.status === 'failed').length,
  };

  const closeDialog = () => { setDialog(null); setActionError(null); };

  const run = async (action, successText) => {
    setNotice(null);
    setActionError(null);
    try {
      await action();
      if (successText) setNotice(successText);
      reload();
    } catch (err) {
      setActionError(getErrorMessage(err));
    }
  };

  const confirmDelete = async () => {
    setBusy(true);
    try {
      await deleteDocument(dialog.doc.id);
      setNotice(`“${dialog.doc.title}” was deleted.`);
      closeDialog();
      reload();
    } catch (err) {
      setActionError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Knowledge Base"
        title="SOP Library"
        subtitle="The company SOPs the AI Assistant answers from. Each file is split into passages and indexed, so answers can cite it."
        actions={<Button icon="upload" onClick={() => { setNotice(null); setDialog({ type: 'upload' }); }}>Upload SOP</Button>}
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
            Documents
            {documents.data && (
              <span className="toolbar__meta">
                {counts.ready} ready
                {counts.processing > 0 && ` · ${counts.processing} indexing`}
                {counts.failed > 0 && ` · ${counts.failed} failed`}
              </span>
            )}
          </h2>
          <div className="toolbar__controls">
            <Input className="toolbar__search" icon="search" type="search" placeholder="Search by title…"
              aria-label="Search SOPs" value={search} onChange={(e) => setSearch(e.target.value)} maxLength={100} />
          </div>
        </div>

        <div className="panel__body">
          {documents.error && (
            <div className="inline-error inline-error--row" role="alert">
              <span>{documents.error}</span>
              <Button variant="secondary" size="sm" onClick={reload}>Try again</Button>
            </div>
          )}
          {!documents.data && !documents.error && <p className="loading-text">Loading SOPs…</p>}

          {documents.data && list.length === 0 && (
            <div className="empty-state">
              <strong>No SOPs yet</strong>
              <span>Upload a PDF, Word or text file. The AI Assistant can answer from it once it is indexed.</span>
              <Button size="sm" icon="upload" onClick={() => setDialog({ type: 'upload' })}>Upload SOP</Button>
            </div>
          )}
          {list.length > 0 && rows.length === 0 && (
            <div className="empty-state">
              <strong>No SOP matches “{search.trim()}”</strong>
              <Button variant="secondary" size="sm" onClick={() => setSearch('')}>Clear search</Button>
            </div>
          )}

          {rows.length > 0 && (
            <div className="table-wrap">
              <table className="table table--sops">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Status</th>
                    <th className="hide-sm">Uploaded</th>
                    <th className="table__actions"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((doc) => (
                    <tr key={doc.id}>
                      <td>
                        <span className="table__name">{doc.title}</span>
                        <span className="table__sub">
                          {doc.fileLabel || 'File'}
                          {doc.status === 'ready' && ` · ${plural(doc.chunkCount, 'passage')}`}
                        </span>
                      </td>
                      <td><StatusCell doc={doc} /></td>
                      <td className="hide-sm">
                        <span className="table__name" title={formatDateTime(doc.uploadedAt)}>{timeAgo(doc.uploadedAt)}</span>
                        <span className="table__sub">by {doc.uploadedBy.name}</span>
                      </td>
                      <td className="table__actions">
                        <Menu label={`Actions for ${doc.title}`} items={[
                          { label: 'Open file', icon: 'external', onSelect: () => run(() => openDocument(doc.id)) },
                          { label: 'Re-upload or rename', icon: 'upload', onSelect: () => { setNotice(null); setDialog({ type: 'replace', doc }); } },
                          ...(doc.status !== 'processing' ? [{
                            label: 'Re-index', icon: 'refresh',
                            onSelect: () => run(() => reindexDocument(doc.id), `“${doc.title}” is being indexed again.`),
                          }] : []),
                          { label: 'Delete', icon: 'trash', tone: 'danger', onSelect: () => { setNotice(null); setDialog({ type: 'delete', doc }); } },
                        ]} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {(dialog?.type === 'upload' || dialog?.type === 'replace') && (
        <SopUploadModal
          doc={dialog.doc}
          onClose={closeDialog}
          onSaved={(saved, reindexing) => {
            setNotice(reindexing
              ? `“${saved.title}” was uploaded and is being indexed. It will be ready in a moment.`
              : `“${saved.title}” was renamed.`);
            closeDialog();
            reload();
          }}
        />
      )}

      <ConfirmDialog
        open={dialog?.type === 'delete'}
        title={`Delete “${dialog?.doc?.title}”?`}
        confirmLabel="Delete SOP"
        tone="danger"
        busy={busy}
        error={dialog?.type === 'delete' ? actionError : null}
        onConfirm={confirmDelete}
        onCancel={closeDialog}
      >
        The file and its indexed passages are deleted, and the AI Assistant stops answering from it.
        Answers already given keep their citations.
      </ConfirmDialog>
    </>
  );
}
