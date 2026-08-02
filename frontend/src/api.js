// src/api.js
import { upload as blobUpload } from '@vercel/blob/client';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000';

const DIRECT_UPLOAD_SIZE_LIMIT = 4 * 1024 * 1024; // 4MB, a little headroom under Vercel's 4.5MB cap

async function handleResponse(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed with status ${res.status}`);
  return data;
}

async function waitForContentByUrl(url, { timeoutMs = 20000, intervalMs = 1000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await fetch(`${API_BASE}/content`).then(handleResponse);
    const match = rows.find((r) => r.filename === url || r.servedPath === url);
    if (match) return match;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('Upload finished but processing is taking longer than expected -- check the Feed tab in a moment.');
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

  async uploadContent(userId, kind, file) {
    if (file.size <= DIRECT_UPLOAD_SIZE_LIMIT) {
      const form = new FormData();
      form.append('userId', userId);
      form.append('kind', kind);
      form.append('file', file);
      return fetch(`${API_BASE}/content/upload`, { method: 'POST', body: form }).then(handleResponse);
    }

    const blob = await blobUpload(file.name, file, {
      access: 'public',
      handleUploadUrl: `${API_BASE}/content/upload-authorize`,
      clientPayload: JSON.stringify({ userId, kind }),
    });

    const contentRow = await waitForContentByUrl(blob.url);
    return {
      success: true,
      contentId: contentRow.id,
      metadataTier: contentRow.metadata_tier,
      metadataReason: undefined,
      badge: contentRow.badge_tier,
      servedPath: contentRow.servedPath,
    };
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

  DIRECT_UPLOAD_SIZE_LIMIT,
};