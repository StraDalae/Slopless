// src/storage.js
// Where uploaded files actually live. Two modes, auto-selected:
//
// - BLOB_READ_WRITE_TOKEN present (set automatically once you connect a
//   Vercel Blob store to the project) -> upload to Vercel Blob, get back a
//   permanent public URL. This is what makes uploads survive on Vercel,
//   where the local filesystem doesn't persist between requests.
// - Otherwise -> write to ./uploads locally, same as before, served by
//   Express's static middleware. This is what you get for local dev.

const fs = require('fs');
const path = require('path');

const LOCAL_UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(LOCAL_UPLOAD_DIR, { recursive: true });

const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;

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
    const { put } = require('@vercel/blob');
    const blob = await put(unique, buffer, { access: 'public' });
    return { url: blob.url, isRemote: true };
  }

  const destPath = path.join(LOCAL_UPLOAD_DIR, unique);
  fs.writeFileSync(destPath, buffer);
  return { url: `/uploads/${unique}`, isRemote: false };
}

module.exports = { saveFile, useBlob, LOCAL_UPLOAD_DIR };
