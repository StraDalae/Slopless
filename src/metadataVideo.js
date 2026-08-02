// src/metadataVideo.js
// Video metadata check using ffprobe (part of the ffmpeg suite) to read
// container-level tags. This is the video equivalent of EXIF -- video files
// don't carry EXIF, they carry tags on the container (mp4/mov "moov" atom,
// mkv metadata, etc), which ffprobe can read out as JSON.
//
// Uses @ffprobe-installer/ffprobe, which bundles a static ffprobe binary
// for the current platform -- this is what makes video metadata checking
// work on Vercel's serverless runtime, which has no system ffmpeg install
// and no way to apt-get one. Same binary approach works fine locally too.
//
// LIMITATION: phones (iPhone/Android) write real capture metadata into
// video containers when you export the original file, but nearly every
// upload pathway (AirDrop, iMessage, most social apps, screen recording)
// strips or rewrites it on the way out. So NO_METADATA will be extremely
// common for video even from real cameras -- this check can positively
// confirm camera origin sometimes, but its *absence* proves nothing.
// This is exactly why the reporting/strike layer has to carry most of the
// real weight for video, same as discussed for images.

const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const { TIERS, classify } = require('./metadataShared');

let ffprobePath;
try {
  ffprobePath = require('@ffprobe-installer/ffprobe').path;
} catch (err) {
  ffprobePath = 'ffprobe'; // fall back to a system install if the bundled binary isn't available
}

const MAKE_KEY_HINTS = ['make', 'manufacturer'];
const MODEL_KEY_HINTS = ['model'];

function findTagValue(tagsObj, hints) {
  if (!tagsObj) return undefined;
  const entry = Object.entries(tagsObj).find(([key]) =>
    hints.some((hint) => key.toLowerCase().includes(hint))
  );
  return entry ? entry[1] : undefined;
}

async function checkVideoMetadata(filePath) {
  let probeOutput;
  try {
    const { stdout } = await execFileAsync(ffprobePath, [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath,
    ]);
    probeOutput = JSON.parse(stdout);
  } catch (err) {
    // ffprobe missing, unreadable file, or unsupported format
    return {
      tier: TIERS.NO_METADATA,
      reason: `Could not read video metadata (${err.code === 'ENOENT' ? 'ffprobe not available' : 'unreadable file or unsupported format'}).`,
      raw: null,
    };
  }

  const formatTags = probeOutput.format?.tags || {};
  const streamTags = (probeOutput.streams || []).reduce(
    (acc, s) => Object.assign(acc, s.tags || {}),
    {}
  );
  const allTags = { ...streamTags, ...formatTags };

  if (Object.keys(allTags).length === 0) {
    return {
      tier: TIERS.NO_METADATA,
      reason: 'No container metadata tags found (stripped on export, or never written).',
      raw: null,
    };
  }

  const make = findTagValue(allTags, MAKE_KEY_HINTS);
  const model = findTagValue(allTags, MODEL_KEY_HINTS);

  const { tier, reason } = classify({ make, model, raw: allTags });
  return { tier, reason, raw: allTags };
}

module.exports = { checkVideoMetadata };
