// src/server.js
// HTTP API over the pipeline modules.
//
// AUTH: every write action (upload, report, appeal) now requires a valid
// Google-verified session -- see auth.js. There is no more "post as any
// user" impersonation dropdown; req.user.id comes only from a token we
// signed ourselves after verifying Google's ID token. Mod actions
// (resolving appeals, viewing the queue) additionally require
// req.user.isAdmin, which is only ever true for the email in ADMIN_EMAIL.

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const { handleUpload } = require('@vercel/blob/client');

const db = require('./db');
const { uploadContentFromBuffer, finalizeBufferUpload } = require('./upload');
const { fileReport } = require('./reports');
const { fileAppeal, resolveAppeal, autoConfirmExpiredStrikes } = require('./appeals');
const { canPost, getRestriction } = require('./restrictions');
const { getReviewPriority } = require('./badges');
const { LOCAL_UPLOAD_DIR, useBlob, BLOB_TOKEN } = require('./storage');
const {
  verifyGoogleIdToken,
  upsertUserFromGoogle,
  signSession,
  requireAuth,
  requireAdmin,
} = require('./auth');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
});

const app = express();
app.use(cors());
app.use(express.json());

if (!useBlob) {
  app.use('/uploads', express.static(LOCAL_UPLOAD_DIR));
}

function servedPathFor(filename) {
  if (!filename) return null;
  if (filename.startsWith('http://') || filename.startsWith('https://')) return filename;
  if (filename.startsWith('/uploads/')) return filename;
  return `/uploads/${filename.split('/').pop()}`;
}

// ---------- Auth ----------

app.post('/auth/google', async (req, res) => {
  const { credential } = req.body;
  if (!credential) return res.status(400).json({ error: 'credential is required' });

  try {
    const profile = await verifyGoogleIdToken(credential);
    if (!profile.emailVerified) {
      return res.status(403).json({ error: 'Google account email is not verified.' });
    }
    const user = await upsertUserFromGoogle(profile);
    const token = signSession(user);
    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        avatarUrl: user.avatar_url,
        isAdmin: user.is_admin,
      },
    });
  } catch (err) {
    res.status(401).json({ error: `Google sign-in failed: ${err.message}` });
  }
});

// Frontend calls this on load to validate a stored token and get fresh
// posting-status info in one round trip.
app.get('/auth/me', requireAuth, async (req, res) => {
  try {
    const [postingStatus, reviewPriority] = await Promise.all([
      canPost(req.user.id),
      getReviewPriority(req.user.id),
    ]);
    res.json({ user: req.user, postingStatus, reviewPriority });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Content / Feed ----------

app.get('/content', requireAuth, async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT c.id, c.kind, c.filename, c.metadata_tier, c.status, c.badge_tier,
              c.badge_revoked, c.created_at,
              u.id as user_id, u.username, u.followers,
              (SELECT COUNT(*)::int FROM reports r WHERE r.content_id = c.id) as report_count,
              (SELECT s.id FROM strikes s WHERE s.content_id = c.id AND s.status = 'PENDING'
                ORDER BY s.id DESC LIMIT 1) as pending_strike_id,
              (SELECT a.id FROM appeals a JOIN strikes s2 ON s2.id = a.strike_id
                WHERE s2.content_id = c.id AND s2.status = 'PENDING' LIMIT 1) as pending_appeal_id
       FROM content c JOIN users u ON u.id = c.user_id
       ORDER BY c.id DESC`
    );
    res.json(rows.map((r) => ({ ...r, servedPath: servedPathFor(r.filename) })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/content/upload', requireAuth, upload.single('file'), async (req, res) => {
  const kind = req.body.kind || 'video';
  if (!req.file) return res.status(400).json({ error: 'file is required (field name "file")' });

  try {
    const result = await uploadContentFromBuffer(req.user.id, kind, req.file.buffer, req.file.originalname);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Large-file path: browser uploads directly to Blob storage, this route
// only issues the short-lived upload token (onBeforeGenerateToken) and
// handles the completion webhook (onUploadCompleted). Identity comes from
// req.user (verified server-side), NOT from the client-supplied payload --
// the client only tells us `kind`, which isn't security-sensitive.
app.post('/content/upload-authorize', requireAuth, async (req, res) => {
  try {
    const jsonResponse = await handleUpload({
      body: req.body,
      request: req,
      token: BLOB_TOKEN,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const postCheck = await canPost(req.user.id);
        if (!postCheck.allowed) {
          throw new Error(
            `Posting restricted for ${postCheck.restriction.restrictedForHours}h (${postCheck.restriction.strikes} confirmed strikes)`
          );
        }
        const { kind } = JSON.parse(clientPayload || '{}');
        return {
          allowedContentTypes: ['image/*', 'video/*'],
          addRandomSuffix: true,
          maximumSizeInBytes: 200 * 1024 * 1024,
          tokenPayload: JSON.stringify({ userId: req.user.id, kind: kind || 'video' }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const { userId, kind } = JSON.parse(tokenPayload);
        const response = await fetch(blob.url);
        const buffer = Buffer.from(await response.arrayBuffer());
        const ext = path.extname(new URL(blob.url).pathname);
        await finalizeBufferUpload(Number(userId), kind, buffer, ext, blob.url);
      },
    });
    res.json(jsonResponse);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/content/:id/report', requireAuth, async (req, res) => {
  try {
    const result = await fileReport(Number(req.params.id), req.user.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- Appeals ----------

app.post('/strikes/:id/appeal', requireAuth, async (req, res) => {
  const { reason } = req.body;
  try {
    // Only the creator whose content got struck (or an admin) can appeal it.
    const strike = await db.get('SELECT * FROM strikes WHERE id = $1', [Number(req.params.id)]);
    if (!strike) return res.status(404).json({ error: 'No such strike.' });
    if (strike.user_id !== req.user.id && !req.user.isAdmin) {
      return res.status(403).json({ error: "You can only appeal strikes on your own content." });
    }
    const result = await fileAppeal(Number(req.params.id), reason);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/appeals/:id/resolve', requireAuth, requireAdmin, async (req, res) => {
  const { outcome } = req.body;
  try {
    const result = await resolveAppeal(Number(req.params.id), outcome);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/strikes/auto-confirm-expired', requireAuth, requireAdmin, async (req, res) => {
  try {
    const confirmed = await autoConfirmExpiredStrikes();
    res.json({ confirmedStrikeIds: confirmed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Admin / mod queue ----------

app.get('/admin/queue', requireAuth, requireAdmin, async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT s.id as strike_id, s.status as strike_status, s.created_at as strike_created_at,
              c.id as content_id, c.kind, c.filename, c.metadata_tier, c.status as content_status,
              u.id as user_id, u.username,
              (SELECT COUNT(*)::int FROM reports r WHERE r.content_id = c.id) as report_count,
              a.id as appeal_id, a.reason as appeal_reason, a.status as appeal_status
       FROM strikes s
       JOIN content c ON c.id = s.content_id
       JOIN users u ON u.id = s.user_id
       LEFT JOIN appeals a ON a.strike_id = s.id
       WHERE s.status = 'PENDING'
       ORDER BY s.id DESC`
    );
    res.json({
      pendingStrikes: rows.map((r) => ({ ...r, servedPath: servedPathFor(r.filename) })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (req, res) => res.json({ ok: true, storage: useBlob ? 'vercel-blob' : 'local-disk' }));

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`HumanVerify MVP backend listening on http://localhost:${PORT}`));
}

module.exports = app;
