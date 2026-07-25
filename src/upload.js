// src/upload.js
// Orchestrates what happens when a user tries to post content:
// 1. check they're not currently restricted
// 2. run the metadata check
// 3. create the content row
// 4. compute its initial badge

const db = require('./db');
const { checkMetadata } = require('./metadata');
const { canPost } = require('./restrictions');
const { computeBadge } = require('./badges');

async function uploadContent(userId, filePath, kind = 'video') {
  const postCheck = canPost(userId);
  if (!postCheck.allowed) {
    return {
      success: false,
      reason: 'USER_RESTRICTED',
      restriction: postCheck.restriction,
    };
  }

  const { tier, reason, raw } = await checkMetadata(filePath);

  const result = db
    .prepare(
      'INSERT INTO content (user_id, kind, filename, metadata_tier) VALUES (?, ?, ?, ?)'
    )
    .run(userId, kind, filePath, tier);

  const contentId = result.lastInsertRowid;
  const badge = computeBadge(contentId);

  return {
    success: true,
    contentId,
    metadataTier: tier,
    metadataReason: reason,
    badge,
  };
}

module.exports = { uploadContent };
