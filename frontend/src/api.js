// src/api.js
import { upload as blobUpload } from '@vercel/blob/client';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000';
const TOKEN_KEY = 'hv_session_token';

const DIRECT_UPLOAD_SIZE_LIMIT = 4 * 1024 * 1024; // 4MB, headroom under Vercel's 4.5MB body cap

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}
function authHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function handleResponse(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed with status ${res.status}`);
  return data;
}

async function waitForContentByUrl(url, { timeoutMs = 20000, intervalMs = 1000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await fetch(`${API_BASE}/content`, { headers: authHeaders() }).then(handleResponse);
    const match = rows.find((r) => r.filename === url || r.servedPath === url);
    if (match) return match;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('Upload finished but processing is taking longer than expected -- check the Feed tab in a moment.');
}

export const api = {
  // ---- auth ----
  isSignedIn: () => !!getToken(),
  signOut: () => setToken(null),

  signInWithGoogle: (credential) =>
    fetch(`${API_BASE}/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential }),
    })
      .then(handleResponse)
      .then(({ token, user }) => {
        setToken(token);
        return user;
      }),

  me: () => fetch(`${API_BASE}/auth/me`, { headers: authHeaders() }).then(handleResponse),

  // ---- content ----
  listContent: () => fetch(`${API_BASE}/content`, { headers: authHeaders() }).then(handleResponse),

  async uploadContent(kind, file) {
    if (file.size <= DIRECT_UPLOAD_SIZE_LIMIT) {
      const form = new FormData();
      form.append('kind', kind);
      form.append('file', file);
      return fetch(`${API_BASE}/content/upload`, {
        method: 'POST',
        headers: authHeaders(),
        body: form,
      }).then(handleResponse);
    }

    const blob = await blobUpload(file.name, file, {
      access: 'public',
      handleUploadUrl: `${API_BASE}/content/upload-authorize`,
      clientPayload: JSON.stringify({ kind }),
      headers: authHeaders(), // so upload-authorize knows who's uploading
    });

    const contentRow = await waitForContentByUrl(blob.url);
    return {
      success: true,
      contentId: contentRow.id,
      metadataTier: contentRow.metadata_tier,
      badge: contentRow.badge_tier,
      servedPath: contentRow.servedPath,
    };
  },

  reportContent: (contentId) =>
    fetch(`${API_BASE}/content/${contentId}/report`, {
      method: 'POST',
      headers: authHeaders(),
    }).then(handleResponse),

  adminQueue: () => fetch(`${API_BASE}/admin/queue`, { headers: authHeaders() }).then(handleResponse),

  resolveAppeal: (appealId, outcome) =>
    fetch(`${API_BASE}/appeals/${appealId}/resolve`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ outcome }),
    }).then(handleResponse),

  fileAppeal: (strikeId, reason) =>
    fetch(`${API_BASE}/strikes/${strikeId}/appeal`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    }).then(handleResponse),

  fileForContent: (servedPath) =>
    servedPath && servedPath.startsWith('http') ? servedPath : `${API_BASE}${servedPath}`,

  DIRECT_UPLOAD_SIZE_LIMIT,
};
