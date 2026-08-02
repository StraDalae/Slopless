// src/storage.js
// Where uploaded files actually live. Two modes, auto-selected:
//
// - Running on Vercel (process.env.VERCEL is set automatically on every
//   Vercel deployment) -> upload to Vercel Blob. Authentication happens
//   automatically via Vercel's OIDC token when a Blob store is connected
//   to the project -- as of mid-2026 this is the default flow and no
//   longer requires a manually-set BLOB_READ_WRITE_TOKEN (that variable
//   still works if you have one, e.g. for local testing against a real
//   store, but isn't auto-created anymore when you connect a store).
// - Otherwise -> write to ./uploads locally, served by Express's static
//   middleware. This is what you get for local dev.

const fs = require('fs');
const path = require('path');

const LOCAL_UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
try {
  fs.mkdirSync(LOCAL_UPLOAD_DIR, { recursive: true });
} catch (err) {
  /* read-only filesystem in production -- fine, we won't use this path there */
}

const useBlob = !!(process.env.VERCEL || process.env.BLOB_READ_WRITE_TOKEN);

/**
 * Persist a file buffer somewhere durable and return a playable URL.
 * @param {Buffer} buffer
 * @param {string} originalName - used only to preserve the file extension
 * @returns {Promise<{url: string, isRemote: boolean}>}
 */
async function saveFile(buffer, originalName) {
  const ext = path.extname(originalName) || '';
  const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;

  if (useBlob) {
    try {
      const { put } = require('@vercel/blob');
      const blob = await put(unique, buffer, { access: 'public' });
      return { url: blob.url, isRemote: true };
    } catch (err) {
      // Most likely cause: running on Vercel but no Blob store connected to
      // this project yet. Fall through to local /tmp-ish write below rather
      // than crashing the request -- it won't persist between invocations,
      // but at least the upload doesn't hard-fail.
      console.error('[storage] Vercel Blob upload failed, falling back to local write:', err.message);
    }
  }

  const destPath = path.join(LOCAL_UPLOAD_DIR, unique);
  fs.writeFileSync(destPath, buffer);
  return { url: `/uploads/${unique}`, isRemote: false };
}

module.exports = { saveFile, useBlob, LOCAL_UPLOAD_DIR };