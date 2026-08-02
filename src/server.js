// src/server.js
// HTTP API over the pipeline modules, built to support the frontend's three
// views: upload, feed, and admin/mod queue.
//
// NOTE ON AUTH: there is none. Every request just takes a userId in the
// body/query -- this stands in for "who's logged in" so we can test the
// pipeline without building a real auth system. Do NOT ship this as-is;
// swap in real sessions/auth before this touches real users.

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
const { LOCAL_UPLOAD_DIR, useBlob } = require('./storage');

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

app.post('/users', async (req, res) => {
  const { username, followers = 0 } = req.body;
  if (!username) return res.status(400).json({ error: 'username is required' });
  try {
    const row = await db.get(
      'INSERT INTO users (username, followers) VALUES ($1, $2) RETURNING id',
      [username, followers]
    );
    res.json({ id: row.id, username, followers });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/users', async (req, res) => {
  try {
    const users = await db.all(
      'SELECT id, username, followers, reporter_trust FROM users ORDER BY id'
    );
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/users/:id/status', async (req, res) => {
  const userId = Number(req.params.id);
  try {
    const [postingStatus, reviewPriority] = await Promise.all([
      canPost(userId),
      getReviewPriority(userId),
    ]);
    res.json({ postingStatus, reviewPriority });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

app.post('/content/upload', upload.single('file'), async (req, res) => {
  const userId = Number(req.body.userId);
  const kind = req.body.kind || 'video';
  if (!req.file) return res.status(400).json({ error: 'file is required (field name "file")' });
  if (!userId) return res.status(400).json({ error: 'userId is required' });

  try {
    const result = await uploadContentFromBuffer(userId, kind, req.file.buffer, req.file.originalname);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/content/upload-authorize', async (req, res) => {
  try {
    const jsonResponse = await handleUpload({
      body: req.body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const { userId, kind } = JSON.parse(clientPayload || '{}');
        if (!userId) throw new Error('userId is required');

        const postCheck = await canPost(Number(userId));
        if (!postCheck.allowed) {
          throw new Error(
            `Posting restricted for ${postCheck.restriction.restrictedForHours}h (${postCheck.restriction.strikes} confirmed strikes)`
          );
        }

        return {
          allowedContentTypes: ['image/*', 'video/*'],
          addRandomSuffix: true,
          maximumSizeInBytes: 200 * 1024 * 1024,
          tokenPayload: JSON.stringify({ userId, kind: kind || 'video' }),
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

app.get('/content', async (req, res) => {
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

app.post('/content/:id/report', async (req, res) => {
  const { reporterId } = req.body;
  if (!reporterId) return res.status(400).json({ error: 'reporterId is required' });
  try {
    const result = await fileReport(Number(req.params.id), Number(reporterId));
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/strikes/:id/appeal', async (req, res) => {
  const { reason } = req.body;
  try {
    const result = await fileAppeal(Number(req.params.id), reason);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/appeals/:id/resolve', async (req, res) => {
  const { outcome } = req.body;
  try {
    const result = await resolveAppeal(Number(req.params.id), outcome);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/strikes/auto-confirm-expired', async (req, res) => {
  try {
    const confirmed = await autoConfirmExpiredStrikes();
    res.json({ confirmedStrikeIds: confirmed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/admin/queue', async (req, res) => {
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