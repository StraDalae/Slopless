// src/api.js
// Thin wrapper around fetch calls to the backend.
//
// Local dev: backend runs on :3000 (see README), no env var needed.
// Deployed: set VITE_API_BASE at build time to the deployed backend URL
// (e.g. https://slopless-api.vercel.app) -- Vercel project settings ->
// Environment Variables, then redeploy the frontend.

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000';

async function handleResponse(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed with status ${res.status}`);
  return data;
}

export const api = {
  listUsers: () => fetch(`${API_BASE}/users`).then(handleResponse),

  createUser: (username, followers = 0) =>
    fetch(`${API_BASE}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, followers }),
    }).then(handleResponse),

  userStatus: (userId) => fetch(`${API_BASE}/users/${userId}/status`).then(handleResponse),

  listContent: () => fetch(`${API_BASE}/content`).then(handleResponse),

  uploadContent: (userId, kind, file) => {
    const form = new FormData();
    form.append('userId', userId);
    form.append('kind', kind);
    form.append('file', file);
    return fetch(`${API_BASE}/content/upload`, { method: 'POST', body: form }).then(handleResponse);
  },

  reportContent: (contentId, reporterId) =>
    fetch(`${API_BASE}/content/${contentId}/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reporterId }),
    }).then(handleResponse),

  adminQueue: () => fetch(`${API_BASE}/admin/queue`).then(handleResponse),

  resolveAppeal: (appealId, outcome) =>
    fetch(`${API_BASE}/appeals/${appealId}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outcome }),
    }).then(handleResponse),

  fileAppeal: (strikeId, reason) =>
    fetch(`${API_BASE}/strikes/${strikeId}/appeal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    }).then(handleResponse),

  fileForContent: (servedPath) =>
    servedPath && servedPath.startsWith('http') ? servedPath : `${API_BASE}${servedPath}`,
};
