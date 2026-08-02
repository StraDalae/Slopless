// src/upload.js
// Orchestrates what happens when a user posts content. Three entry points
// now, because large video files can't fit through a single Vercel
// serverless function request (4.5MB body limit):
//
// - uploadContent(userId, filePath, kind): local file path on disk. Used
//   by test/simulate.js and anywhere else working with local fixtures.
// - uploadContentFromBuffer(userId, kind, buffer, originalName): raw bytes
//   that came through our own server (small files, under the body limit --
//   this is the direct multipart POST path, works everywhere including
//   local dev).
// - finalizeBufferUpload(userId, kind, buffer, ext): the shared core used
//   by both of the above AND by the Blob "client upload" completion
//   webhook (see server.js's /content/upload-authorize) for large files
//   that were uploaded directly from the browser straight to Blob
//   storage, bypassing our server's body-size limit entirely. In that
//   case we download the bytes back from Blob just long enough to run the
//   metadata checker, since ffprobe/exifr need a real file to read.

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

async function finalizeBufferUpload(userId, kind, buffer, ext, finalUrl) {
  const tempPath = path.join(
    os.tmpdir(),
    `hv-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`
  );
  fs.writeFileSync(tempPath, buffer);

  let tier, reason;
  try {
    ({ tier, reason } = await checkMetadata(tempPath));
  } finally {
    fs.unlink(tempPath, () => {});
  }

  const contentId = await createContentRow(userId, kind, finalUrl, tier);
  const badge = await computeBadge(contentId);

  return { success: true, contentId, metadataTier: tier, metadataReason: reason, badge, servedPath: finalUrl };
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

  const ext = path.extname(originalName);
  const { url } = await saveFile(buffer, originalName);
  return finalizeBufferUpload(userId, kind, buffer, ext, url);
}

module.exports = { uploadContent, uploadContentFromBuffer, finalizeBufferUpload, createContentRow };