// src/upload.js
// Orchestrates what happens when a user tries to post content:
// 1. check they're not currently restricted
// 2. run the metadata check
// 3. create the content row
// 4. compute its initial badge
//
// Two entry points:
// - uploadContent(userId, filePath, kind): takes a path already on local
//   disk. Used by test/simulate.js and anywhere else working with local
//   fixture files.
// - uploadContentFromBuffer(userId, kind, buffer, originalName): takes raw
//   upload bytes (what the HTTP API actually receives). Writes a throwaway
//   temp file just long enough to run the metadata checker (ffprobe needs
//   a real file to read), then persists the bytes via storage.js (local
//   disk in dev, Vercel Blob in production) and discards the temp file.

const os = require('os');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const { checkMetadata } = require('./metadata');
const { canPost } = require('./restrictions');
const { computeBadge } = require('./badges');
const { saveFile } = require('./storage');

async function createContentRow(userId, kind, filenameOrUrl, tier) {
  const row = await db.get(
    'INSERT INTO content (user_id, kind, filename, metadata_tier) VALUES ($1, $2, $3, $4) RETURNING id',
    [userId, kind, filenameOrUrl, tier]
  );
  return row.id;
}

async function uploadContent(userId, filePath, kind = 'video') {
  const postCheck = await canPost(userId);
  if (!postCheck.allowed) {
    return { success: false, reason: 'USER_RESTRICTED', restriction: postCheck.restriction };
  }

  const { tier, reason } = await checkMetadata(filePath);
  const contentId = await createContentRow(userId, kind, filePath, tier);
  const badge = await computeBadge(contentId);

  return { success: true, contentId, metadataTier: tier, metadataReason: reason, badge };
}

async function uploadContentFromBuffer(userId, kind, buffer, originalName) {
  const postCheck = await canPost(userId);
  if (!postCheck.allowed) {
    return { success: false, reason: 'USER_RESTRICTED', restriction: postCheck.restriction };
  }

  // Write a short-lived temp file so the metadata checker (ffprobe, for
  // video) has a real path to read. /tmp is writable during a single
  // Vercel function invocation, which is all we need here.
  const tempPath = path.join(os.tmpdir(), `hv-${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(originalName)}`);
  fs.writeFileSync(tempPath, buffer);

  let tier, reason;
  try {
    ({ tier, reason } = await checkMetadata(tempPath));
  } finally {
    fs.unlink(tempPath, () => {}); // best-effort cleanup, don't block the response on it
  }

  const { url } = await saveFile(buffer, originalName);
  const contentId = await createContentRow(userId, kind, url, tier);
  const badge = await computeBadge(contentId);

  return { success: true, contentId, metadataTier: tier, metadataReason: reason, badge, servedPath: url };
}

module.exports = { uploadContent, uploadContentFromBuffer };
