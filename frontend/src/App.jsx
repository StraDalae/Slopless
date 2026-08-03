// src/App.jsx
import { useState, useEffect, useCallback } from 'react';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { api } from './api';
import LoginView from './components/LoginView';
import UploadView from './components/UploadView';
import FeedView from './components/FeedView';
import AdminView from './components/AdminView';
import './App.css';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

function AppShell() {
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [authError, setAuthError] = useState(null);

  const [tab, setTab] = useState('upload');
  const [content, setContent] = useState([]);
  const [queue, setQueue] = useState([]);
  const [status, setStatus] = useState(null);
  const [loadError, setLoadError] = useState(null);

  // On load: if a token is already stored, validate it against /auth/me
  // rather than trusting it blindly (it may have expired).
  useEffect(() => {
    if (!api.isSignedIn()) {
      setAuthChecked(true);
      return;
    }
    api
      .me()
      .then(({ user, postingStatus, reviewPriority }) => {
        setUser(user);
        setStatus({ postingStatus, reviewPriority });
      })
      .catch(() => {
        api.signOut(); // stale/invalid token
      })
      .finally(() => setAuthChecked(true));
  }, []);

  const refreshContent = useCallback(() => api.listContent().then(setContent), []);
  const refreshQueue = useCallback(() => {
    if (!user?.isAdmin) return Promise.resolve();
    return api.adminQueue().then((res) => setQueue(res.pendingStrikes));
  }, [user]);
  const refreshStatus = useCallback(() => {
    if (!user) return Promise.resolve();
    return api.me().then(({ postingStatus, reviewPriority }) => setStatus({ postingStatus, reviewPriority }));
  }, [user]);

  const refreshAll = useCallback(async () => {
    try {
      await Promise.all([refreshContent(), refreshQueue(), refreshStatus()]);
      setLoadError(null);
    } catch (err) {
      setLoadError(`Can't reach the backend -- is it running/deployed? (${err.message})`);
    }
  }, [refreshContent, refreshQueue, refreshStatus]);

  useEffect(() => {
    if (user) refreshAll();
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSignedIn(nextUser, error) {
    if (error) {
      setAuthError(error);
      return;
    }
    setAuthError(null);
    setUser(nextUser);
  }

  function handleSignOut() {
    api.signOut();
    setUser(null);
    setContent([]);
    setQueue([]);
    setStatus(null);
  }

  if (!authChecked) return null; // avoid a login-screen flash while validating a stored token

  if (!user) {
    return <LoginView onSignedIn={handleSignedIn} error={authError} />;
  }

  const TABS = [
    { id: 'upload', label: 'Upload' },
    { id: 'feed', label: 'Feed' },
    ...(user.isAdmin ? [{ id: 'admin', label: 'Mod Queue' }] : []),
  ];

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__brand">
          <span className="app__brand-dot" />
          HumanVerify <span className="app__brand-sub">// MVP console</span>
        </div>

        <div className="app__user-controls">
          <span className="current-user">
            {user.avatarUrl && <img src={user.avatarUrl} alt="" className="current-user__avatar" />}
            <span>
              {user.username}
              {user.isAdmin && <span className="admin-badge">ADMIN</span>}
            </span>
          </span>
          <button className="btn-secondary" style={{ width: 'auto' }} onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      </header>

      {status && !status.postingStatus.allowed && (
        <div className="alert alert--error app__restriction-banner">
          You're restricted from posting for {status.postingStatus.restriction.restrictedForHours}h
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
        {tab === 'upload' && <UploadView onUploaded={refreshAll} />}
        {tab === 'feed' && <FeedView content={content} currentUserId={user.id} onRefresh={refreshAll} />}
        {tab === 'admin' && user.isAdmin && <AdminView queue={queue} onRefresh={refreshAll} />}
      </main>
    </div>
  );
}

export default function App() {
  if (!GOOGLE_CLIENT_ID) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <div className="alert alert--error">
            VITE_GOOGLE_CLIENT_ID is not set. Add it as an environment variable and rebuild.
          </div>
        </div>
      </div>
    );
  }
  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <AppShell />
    </GoogleOAuthProvider>
  );
}
