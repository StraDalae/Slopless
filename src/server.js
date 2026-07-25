// src/server.js
// Thin HTTP layer over the pipeline modules. This is here so you can poke
// at the system with curl/Postman if you want, but test/simulate.js is the
// faster way to walk through end-to-end scenarios.

const express = require('express');
const db = require('./db');
const { uploadContent } = require('./upload');
const { fileReport } = require('./reports');
const { fileAppeal, resolveAppeal, autoConfirmExpiredStrikes } = require('./appeals');
const { canPost, getRestriction } = require('./restrictions');
const { computeBadge, getReviewPriority } = require('./badges');

const app = express();
app.use(express.json());

app.post('/users', (req, res) => {
  const { username, followers = 0 } = req.body;
  const result = db
    .prepare('INSERT INTO users (username, followers) VALUES (?, ?)')
    .run(username, followers);
  res.json({ id: result.lastInsertRowid, username, followers });
});

app.post('/content/upload', async (req, res) => {
  const { userId, filePath, kind } = req.body;
  try {
    const result = await uploadContent(userId, filePath, kind);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/content/:id/report', (req, res) => {
  const { reporterId } = req.body;
  try {
    const result = fileReport(Number(req.params.id), reporterId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/strikes/:id/appeal', (req, res) => {
  const { reason } = req.body;
  try {
    const result = fileAppeal(Number(req.params.id), reason);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/appeals/:id/resolve', (req, res) => {
  const { outcome } = req.body; // 'APPROVED' | 'DENIED'
  try {
    const result = resolveAppeal(Number(req.params.id), outcome);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/strikes/auto-confirm-expired', (req, res) => {
  const confirmed = autoConfirmExpiredStrikes();
  res.json({ confirmedStrikeIds: confirmed });
});

app.get('/users/:id/status', (req, res) => {
  const userId = Number(req.params.id);
  res.json({
    postingStatus: canPost(userId),
    reviewPriority: getReviewPriority(userId),
  });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`HumanVerify MVP backend listening on :${PORT}`));
}

module.exports = app;
