// src/components/UploadView.jsx
import { useState } from 'react';
import { api } from '../api';
import Badge from './Badge';

export default function UploadView({ currentUserId, onUploaded }) {
  const [file, setFile] = useState(null);
  const [kind, setKind] = useState('video');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!file || !currentUserId) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.uploadContent(currentUserId, kind, file);
      setResult(res);
      if (res.success) onUploaded?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h2>Upload</h2>
      <p className="panel__hint">
        Runs the file straight through the verification pipeline: metadata check, badge
        computation, restriction check. No moderation queue involved unless it gets reported later.
      </p>

      <form className="upload-form" onSubmit={handleSubmit}>
        <label className="field">
          <span>Content type</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="video">video</option>
            <option value="post">post (image)</option>
          </select>
        </label>

        <label className="field">
          <span>File</span>
          <input
            type="file"
            accept="video/*,image/*,.h264"
            onChange={(e) => setFile(e.target.files[0] || null)}
          />
        </label>

        <button type="submit" disabled={!file || !currentUserId || busy}>
          {busy
            ? file && file.size > api.DIRECT_UPLOAD_SIZE_LIMIT
              ? 'Uploading + processing (large file, may take a bit)…'
              : 'Running pipeline…'
            : 'Upload'}
        </button>
      </form>

      {file && file.size > api.DIRECT_UPLOAD_SIZE_LIMIT && (
        <p className="panel__hint" style={{ marginTop: 8 }}>
          This file is over 4MB, so it'll upload directly to storage and get processed in the
          background — expect a few extra seconds compared to small files.
        </p>
      )}

      {error && <div className="alert alert--error">{error}</div>}

      {result && (
        <div className="result-card">
          {result.success ? (
            <>
              <div className="result-card__row">
                <span className="result-card__label">Metadata tier</span>
                <Badge tier={result.metadataTier} />
              </div>
              <div className="result-card__row">
                <span className="result-card__label">Badge</span>
                <Badge tier={result.badge} fallbackLabel="NO BADGE" />
              </div>
              <p className="result-card__reason">{result.metadataReason}</p>
              {result.servedPath && (
                <div className="preview">
                  {kind === 'video' ? (
                    <video src={api.fileForContent(result.servedPath)} controls />
                  ) : (
                    <img src={api.fileForContent(result.servedPath)} alt="uploaded preview" />
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="alert alert--error">
              Upload blocked: {result.reason}
              {result.restriction && (
                <> — restricted for {result.restriction.restrictedForHours}h ({result.restriction.strikes} confirmed strikes)</>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
