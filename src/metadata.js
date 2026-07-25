// src/metadata.js
//
// IMPORTANT LIMITATION (read this before trusting this module):
// EXIF/container metadata is trivial to strip or fake. This checker cannot
// prove content is human-made -- it can only catch the lazy/unedited case
// and provide a *signal*, not a verdict. Treat its output as one input to
// the badge/report/strike system, never as a standalone yes/no.
//
// Real-world upgrade path: C2PA Content Credentials (cryptographically
// signed provenance chain from capture device -> edit -> export). Worth
// building toward once this MVP proves the pipeline shape is right.

const exifr = require('exifr');
const fs = require('fs');

// Known software/tool tags that suggest AI generation or an AI-editing
// pipeline touched the file. This list will always be incomplete and needs
// ongoing maintenance -- it's a heuristic tripwire, not a detector.
const AI_TOOL_SIGNATURES = [
  'runway', 'pika', 'sora', 'midjourney', 'dall-e', 'dalle', 'stable diffusion',
  'kling', 'luma', 'gen-2', 'gen-3', 'synthesia', 'heygen', 'firefly',
];

// Known genuine camera/phone manufacturers. Presence of these in Make/Model
// tags is a positive signal (real capture device), not proof by itself.
const KNOWN_CAMERA_MAKES = [
  'apple', 'samsung', 'google', 'sony', 'canon', 'nikon', 'fujifilm',
  'panasonic', 'gopro', 'dji', 'oneplus', 'xiaomi', 'huawei',
];

const TIERS = {
  CAMERA_VERIFIED: 'CAMERA_VERIFIED',       // has real camera make/model, no AI signature
  EDITED_UNKNOWN: 'EDITED_UNKNOWN',         // has metadata, edited by normal software, no camera tag
  NO_METADATA: 'NO_METADATA',               // metadata stripped entirely - can't vouch either way
  AI_SIGNATURE_DETECTED: 'AI_SIGNATURE_DETECTED', // explicit AI tool signature found
};

/**
 * Inspect a file's metadata and classify it into a trust tier.
 * @param {string} filePath - path to the uploaded file on disk
 * @returns {Promise<{tier: string, reason: string, raw: object|null}>}
 */
async function checkMetadata(filePath) {
  let raw;
  try {
    raw = await exifr.parse(filePath, { userComment: true, xmp: true, iptc: true });
  } catch (err) {
    // exifr throws on non-image formats (most .mp4 containers). This MVP
    // only really does real parsing for images; video needs an ffprobe-based
    // checker (container atoms, not EXIF) -- stubbed as NO_METADATA for now.
    raw = null;
  }

  if (!raw || Object.keys(raw).length === 0) {
    return {
      tier: TIERS.NO_METADATA,
      reason: 'No readable metadata found (stripped, unsupported format, or video container not yet parsed).',
      raw: null,
    };
  }

  const haystack = JSON.stringify(raw).toLowerCase();

  const aiHit = AI_TOOL_SIGNATURES.find((sig) => haystack.includes(sig));
  if (aiHit) {
    return {
      tier: TIERS.AI_SIGNATURE_DETECTED,
      reason: `Metadata references known AI tool signature: "${aiHit}".`,
      raw,
    };
  }

  const make = (raw.Make || '').toLowerCase();
  const isKnownCamera = KNOWN_CAMERA_MAKES.some((brand) => make.includes(brand));

  if (isKnownCamera) {
    return {
      tier: TIERS.CAMERA_VERIFIED,
      reason: `Camera make/model present ("${raw.Make} ${raw.Model || ''}".trim()), no AI signature found.`,
      raw,
    };
  }

  return {
    tier: TIERS.EDITED_UNKNOWN,
    reason: 'Metadata present but no recognized camera make -- likely edited/exported by unknown software.',
    raw,
  };
}

module.exports = { checkMetadata, TIERS, AI_TOOL_SIGNATURES, KNOWN_CAMERA_MAKES };
