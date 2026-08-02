// src/metadataImage.js
// EXIF-based metadata check for still images.

const exifr = require('exifr');
const { TIERS, classify } = require('./metadataShared');

async function checkImageMetadata(filePath) {
  let raw;
  try {
    raw = await exifr.parse(filePath, { userComment: true, xmp: true, iptc: true });
  } catch (err) {
    raw = null;
  }

  if (!raw || Object.keys(raw).length === 0) {
    return {
      tier: TIERS.NO_METADATA,
      reason: 'No readable EXIF metadata found (stripped or unsupported format).',
      raw: null,
    };
  }

  const { tier, reason } = classify({ make: raw.Make, model: raw.Model, raw });
  return { tier, reason, raw };
}

module.exports = { checkImageMetadata };
