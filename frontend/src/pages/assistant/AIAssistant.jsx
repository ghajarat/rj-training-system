// AI Assistant — every role (FR10, FR11, FR12, NFR18).
// Design: docs/designs/Chatbot.png. Three columns: conversation history,
// the chat thread, and the sources and related courses of the last answer.
//
// Decisions against the design: no "Export" button and no "quiz me" tip
// (no requirement asks for them). The design's settings gear is left out.
//
// A new conversation is only created on the server when its first question
// is sent, so pressing "New chat" never leaves empty conversations behind.
import { useCallback, useEffect, useRef, useState } from 'react';
import { getErrorMessage } from '../../api/client';
import { createSession, deleteSession, getMessages, sendMessage } from '../../api/chat';
import Button from '../../components/Button';
import ConfirmDialog from '../../components/ConfirmDialog';
import Icon from '../../components/Icon';
import useFetch from '../../hooks/useFetch';
import { plural } from '../../utils/format';
import PageHeader from '../PageHeader';
import SessionList from './SessionList';
import ChatThread from './ChatThread';
import Composer from './Composer';
import AssistantSidePanel from './AssistantSidePanel';
import './assistant.css';

export default function AIAssistant() {
  const sessions = useFetch('/chat/sessions');
  const [activeId, setActiveId] = useState(null);
  const [thread, setThread] = useState({ messages: [], loading: false, error: null });
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);
  const [draft, setDraft] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false); // phone width only
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const loadToken = useRef(0);

  const sessionList = sessions.data?.sessions || [];
  const documentCount = sessions.data?.documentCount;
  const activeSession = sessionList.find((s) => s.id === activeId) || null;

  const loadSession = useCallback(async (id) => {
    const token = ++loadToken.current;
    setThread({ messages: [], loading: true, error: null });
    try {
      const { messages } = await getMessages(id);
      if (token === loadToken.current) setThread({ messages, loading: false, error: null });
    } catch (err) {
      if (token === loadToken.current) setThread({ messages: [], loading: false, error: getErrorMessage(err) });
    }
  }, []);

  const openSession = (id) => {
    setActiveId(id);
    setSendError(null);
    setHistoryOpen(false);
    loadSession(id);
  };

  const newChat = () => {
    loadToken.current += 1;
    setActiveId(null);
    setThread({ messages: [], loading: false, error: null });
    setSendError(null);
    setHistoryOpen(false);
  };

  // The question is shown at once; the server's copy replaces it when the
  // answer arrives. On failure it is taken back out and returned to the box.
  const send = async (text) => {
    if (sending) return;
    setSending(true);
    setSendError(null);
    const pending = { id: 'pending', role: 'user', text, createdAt: new Date().toISOString(), pending: true };
    setThread((t) => ({ ...t, messages: [...t.messages, pending] }));
    setDraft('');

    let sessionId = activeId;
    try {
      if (!sessionId) {
        sessionId = (await createSession()).id;
        loadToken.current += 1;
        setActiveId(sessionId);
      }
      const result = await sendMessage(sessionId, text);
      setThread((t) => ({
        ...t,
        messages: [...t.messages.filter((m) => !m.pending), result.userMessage, result.message],
      }));
      sessions.reload();
    } catch (err) {
      setThread((t) => ({ ...t, messages: t.messages.filter((m) => !m.pending) }));
      setDraft(text);
      setSendError(getErrorMessage(err));
      if (sessionId !== activeId) sessions.reload();
    } finally {
      setSending(false);
    }
  };

  const confirmDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteSession(toDelete.id);
      if (toDelete.id === activeId) newChat();
      setToDelete(null);
      sessions.reload();
    } catch (err) {
      setDeleteError(getErrorMessage(err));
    } finally {
      setDeleting(false);
    }
  };

  // Phone width: the history drawer closes with Esc.
  useEffect(() => {
    if (!historyOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setHistoryOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [historyOpen]);

  const lastAnswer = [...thread.messages].reverse().find((m) => m.role === 'assistant') || null;

  let subtitle = 'Answers come only from company SOPs, and every answer cites its source.';
  if (documentCount !== undefined) {
    subtitle = documentCount > 0
      ? `Grounded in ${plural(documentCount, 'company SOP')}. Every answer cites its source.`
      : 'No SOPs have been added yet, so there is nothing to answer from.';
  }

  return (
    <>
      <PageHeader
        eyebrow="Knowledge Assistant"
        title="AI Training Assistant"
        subtitle={subtitle}
        actions={<Button icon="plus" onClick={newChat} disabled={sending}>New chat</Button>}
      />

      <section className="card assistant">
        <aside className={`assistant__history ${historyOpen ? 'is-open' : ''}`} aria-label="Conversations">
          <SessionList
            sessions={sessionList}
            loading={sessions.loading && !sessions.data}
            error={sessions.error}
            onRetry={sessions.reload}
            activeId={activeId}
            onOpen={openSession}
            onDelete={(s) => { setDeleteError(null); setToDelete(s); }}
            disabled={sending}
          />
        </aside>
        {historyOpen && <button type="button" className="assistant__scrim" aria-label="Close conversations" onClick={() => setHistoryOpen(false)} />}

        <div className="assistant__main">
          <header className="assistant__head">
            <button type="button" className="icon-button assistant__history-toggle" onClick={() => setHistoryOpen(true)} aria-label="Show conversations">
              <Icon name="history" size={18} />
            </button>
            <span className="assistant__avatar assistant__avatar--bot" aria-hidden="true"><Icon name="sparkle" size={16} /></span>
            <div className="assistant__head-text">
              <h2>{activeSession?.title || 'New conversation'}</h2>
              <span>{activeSession ? plural(activeSession.messageCount, 'message') : 'Ask about any company procedure'}</span>
            </div>
          </header>

          <ChatThread
            messages={thread.messages}
            loading={thread.loading}
            error={thread.error}
            onRetryLoad={() => loadSession(activeId)}
            sending={sending}
            sendError={sendError}
            onDismissError={() => setSendError(null)}
            documentCount={documentCount}
            onExample={send}
          />

          <Composer value={draft} onChange={setDraft} onSend={send} sending={sending} />
        </div>

        <AssistantSidePanel answer={lastAnswer} />
      </section>

      <ConfirmDialog
        open={Boolean(toDelete)}
        title="Delete this conversation?"
        confirmLabel="Delete"
        tone="danger"
        busy={deleting}
        error={deleteError}
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      >
        “{toDelete?.title}” and all its messages will be deleted. This cannot be undone.
      </ConfirmDialog>
    </>
  );
}
