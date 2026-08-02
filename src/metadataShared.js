// src/metadataShared.js
// Shared between the image (EXIF) and video (ffprobe/container) metadata
// checkers so both formats get classified by the same rules.

const TIERS = {
  CAMERA_VERIFIED: 'CAMERA_VERIFIED',       // real camera/phone make+model, no AI signature
  EDITED_UNKNOWN: 'EDITED_UNKNOWN',         // metadata present, ordinary editing/encoding software, no camera tag
  NO_METADATA: 'NO_METADATA',               // no usable metadata at all
  AI_SIGNATURE_DETECTED: 'AI_SIGNATURE_DETECTED', // explicit AI tool signature found
};

// Known software/tool tags that suggest AI generation or an AI pipeline
// touched the file. Always incomplete -- a heuristic tripwire, not a
// detector. Needs ongoing maintenance as new tools ship.
const AI_TOOL_SIGNATURES = [
  'runway', 'pika', 'sora', 'midjourney', 'dall-e', 'dalle', 'stable diffusion',
  'kling', 'luma', 'gen-2', 'gen-3', 'synthesia', 'heygen', 'firefly',
];

// Known genuine camera/phone manufacturers. Presence in make/model tags is
// a positive signal (real capture device), not proof by itself.
const KNOWN_CAMERA_MAKES = [
  'apple', 'samsung', 'google', 'sony', 'canon', 'nikon', 'fujifilm',
  'panasonic', 'gopro', 'dji', 'oneplus', 'xiaomi', 'huawei',
];

/**
 * Classify a normalized set of metadata fields into a trust tier.
 * @param {object} fields
 * @param {string} [fields.make] - camera/device make, if present
 * @param {string} [fields.model] - camera/device model, if present
 * @param {object} [fields.raw] - the full raw tag object, for the AI-signature text scan
 * @returns {{tier: string, reason: string}}
 */
function classify({ make, model, raw }) {
  const haystack = JSON.stringify(raw || {}).toLowerCase();

  const aiHit = AI_TOOL_SIGNATURES.find((sig) => haystack.includes(sig));
  if (aiHit) {
    return {
      tier: TIERS.AI_SIGNATURE_DETECTED,
      reason: `Metadata references known AI tool signature: "${aiHit}".`,
    };
  }

  const makeLower = (make || '').toLowerCase();
  const isKnownCamera = KNOWN_CAMERA_MAKES.some((brand) => makeLower.includes(brand));

  if (isKnownCamera) {
    return {
      tier: TIERS.CAMERA_VERIFIED,
      reason: `Camera make/model present ("${make} ${model || ''}".trim()), no AI signature found.`,
    };
  }

  return {
    tier: TIERS.EDITED_UNKNOWN,
    reason: 'Metadata present but no recognized camera make -- likely edited/exported by unknown software.',
  };
}

module.exports = { TIERS, AI_TOOL_SIGNATURES, KNOWN_CAMERA_MAKES, classify };
