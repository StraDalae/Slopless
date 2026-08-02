// src/metadata.js
// Dispatches to the right checker based on file extension: EXIF for images,
// ffprobe/container tags for video. See metadataImage.js and
// metadataVideo.js for the format-specific logic and their individual
// limitations -- both are read before you trust either.
//
// This module's job is just: look at the extension, call the right checker,
// return a consistent shape either way.

const path = require('path');
const { checkImageMetadata } = require('./metadataImage');
const { checkVideoMetadata } = require('./metadataVideo');
const { TIERS, AI_TOOL_SIGNATURES, KNOWN_CAMERA_MAKES } = require('./metadataShared');

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.heic', '.webp', '.tiff']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi', '.h264']);

/**
 * Inspect a file's metadata and classify it into a trust tier.
 * @param {string} filePath - path to the uploaded file on disk
 * @returns {Promise<{tier: string, reason: string, raw: object|null}>}
 */
async function checkMetadata(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (IMAGE_EXTENSIONS.has(ext)) {
    return checkImageMetadata(filePath);
  }
  if (VIDEO_EXTENSIONS.has(ext)) {
    return checkVideoMetadata(filePath);
  }

  return {
    tier: TIERS.NO_METADATA,
    reason: `Unrecognized file extension "${ext}" -- no metadata checker available for this format.`,
    raw: null,
  };
}

module.exports = { checkMetadata, TIERS, AI_TOOL_SIGNATURES, KNOWN_CAMERA_MAKES };
