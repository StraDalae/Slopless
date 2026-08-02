// src/App.jsx
import { useState, useEffect, useCallback } from 'react';
import { api } from './api';
import Badge from './components/Badge';
import UploadView from './components/UploadView';
import FeedView from './components/FeedView';
import AdminView from './components/AdminView';
import './App.css';

const TABS = [
  { id: 'upload', label: 'Upload' },
  { id: 'feed', label: 'Feed' },
  { id: 'admin', label: 'Mod Queue' },
];

export default function App() {
  const [tab, setTab] = useState('upload');
  const [users, setUsers] = useState([]);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [newUsername, setNewUsername] = useState('');
  const [content, setContent] = useState([]);
  const [queue, setQueue] = useState([]);
  const [status, setStatus] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const refreshUsers = useCallback(async () => {
    const list = await api.listUsers();
    setUsers(list);
    if (!currentUserId && list.length > 0) setCurrentUserId(list[0].id);
  }, [currentUserId]);

  const refreshContent = useCallback(async () => {
    setContent(await api.listContent());
  }, []);

  const refreshQueue = useCallback(async () => {
    const res = await api.adminQueue();
    setQueue(res.pendingStrikes);
  }, []);

  const refreshAll = useCallback(async () => {
    try {
      await Promise.all([refreshUsers(), refreshContent(), refreshQueue()]);
      setLoadError(null);
    } catch (err) {
      setLoadError(`Can't reach the backend at localhost:3000 — is it running? (${err.message})`);
    }
  }, [refreshUsers, refreshContent, refreshQueue]);

  useEffect(() => {
    refreshAll();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!currentUserId) return;
    api.userStatus(currentUserId).then(setStatus).catch(() => setStatus(null));
  }, [currentUserId, content]);

  async function handleCreateUser(e) {
    e.preventDefault();
    if (!newUsername.trim()) return;
    const user = await api.createUser(newUsername.trim());
    setNewUsername('');
    await refreshUsers();
    setCurrentUserId(user.id);
  }

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__brand">
          <span className="app__brand-dot" />
          HumanVerify <span className="app__brand-sub">// MVP console</span>
        </div>

        <div className="app__user-controls">
          <select
            value={currentUserId || ''}
            onChange={(e) => setCurrentUserId(Number(e.target.value))}
          >
            <option value="" disabled>
              Post as…
            </option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                @{u.username} ({u.followers} followers)
              </option>
            ))}
          </select>

          <form className="new-user-form" onSubmit={handleCreateUser}>
            <input
              placeholder="new username"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
            />
            <button type="submit">+ Add</button>
          </form>
        </div>
      </header>

      {status && !status.postingStatus.allowed && (
        <div className="alert alert--error app__restriction-banner">
          Current user is restricted from posting for {status.postingStatus.restriction.restrictedForHours}h
          ({status.postingStatus.restriction.strikes} confirmed strikes).
        </div>
      )}

      {loadError && <div className="alert alert--error">{loadError}</div>}

      <nav className="app__tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`app__tab ${tab === t.id ? 'app__tab--active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === 'admin' && queue.length > 0 && <span className="app__tab-count">{queue.length}</span>}
          </button>
        ))}
      </nav>

      <main className="app__main">
        {tab === 'upload' && <UploadView currentUserId={currentUserId} onUploaded={refreshAll} />}
        {tab === 'feed' && <FeedView content={content} currentUserId={currentUserId} onRefresh={refreshAll} />}
        {tab === 'admin' && <AdminView queue={queue} onRefresh={refreshAll} />}
      </main>
    </div>
  );
}
