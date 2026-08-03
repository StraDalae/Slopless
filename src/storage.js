// src/storage.js
// Where uploaded files actually live. Two modes, auto-selected:
//
// - Running on Vercel (process.env.VERCEL is set automatically on every
//   Vercel deployment) -> upload to Vercel Blob.
// - Otherwise -> write to ./uploads locally, served by Express's static
//   middleware. This is what you get for local dev.
//
// BLOB_TOKEN checks a couple of possible env var names: the SDK's own
// functions only auto-read the standard BLOB_READ_WRITE_TOKEN name, so if
// your store's token ends up under a different variable name (renamed, or
// named differently by whatever flow created it), we explicitly pass it
// through everywhere instead of relying on the SDK's default lookup.

const fs = require('fs');
const path = require('path');

const LOCAL_UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
try {
  fs.mkdirSync(LOCAL_UPLOAD_DIR, { recursive: true });
} catch (err) {
  /* read-only filesystem in production -- fine, we won't use this path there */
}

const BLOB_TOKEN = process.env.NeuBlob_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN;
const useBlob = !!(process.env.VERCEL || BLOB_TOKEN);

async function saveFile(buffer, originalName) {
  const ext = path.extname(originalName) || '';
  const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;

  if (useBlob) {
    const { put } = require('@vercel/blob');
    const blob = await put(unique, buffer, { access: 'public', token: BLOB_TOKEN });
    return { url: blob.url, isRemote: true };
  }

  const destPath = path.join(LOCAL_UPLOAD_DIR, unique);
  fs.writeFileSync(destPath, buffer);
  return { url: `/uploads/${unique}`, isRemote: false };
}

module.exports = { saveFile, useBlob, LOCAL_UPLOAD_DIR, BLOB_TOKEN };
