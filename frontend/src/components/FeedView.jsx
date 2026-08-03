// src/components/FeedView.jsx
import { useState } from 'react';
import { api } from '../api';
import Badge from './Badge';

export default function FeedView({ content, currentUserId, onRefresh }) {
  const [reportingId, setReportingId] = useState(null);
  const [appealingId, setAppealingId] = useState(null);
  const [appealText, setAppealText] = useState('');
  const [message, setMessage] = useState(null);

  async function handleReport(contentId) {
    if (!currentUserId) return;
    setReportingId(contentId);
    setMessage(null);
    try {
      const res = await api.reportContent(contentId);
      if (res.recorded === false) {
        setMessage(`Not recorded: ${res.reason}`);
      } else if (res.flagged) {
        setMessage('Report recorded — this crossed the flag threshold, content moved to review.');
      } else {
        setMessage(`Report recorded (weight so far: ${res.totalWeight.toFixed(2)}).`);
      }
      onRefresh();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setReportingId(null);
    }
  }

  async function handleFileAppeal(strikeId) {
    setMessage(null);
    try {
      const res = await api.fileAppeal(strikeId, appealText);
      setMessage(res.filed ? 'Appeal filed — a moderator will review it in the Admin tab.' : `Could not file: ${res.reason}`);
      setAppealingId(null);
      setAppealText('');
      onRefresh();
    } catch (err) {
      setMessage(err.message);
    }
  }

  return (
    <div className="panel">
      <h2>Feed</h2>
      <p className="panel__hint">
        Shows every status (LIVE / UNDER_REVIEW / REMOVED) so you can watch content move between
        them as reports come in — a real feed would only ever show LIVE.
      </p>

      {message && <div className="alert alert--info">{message}</div>}

      {content.length === 0 && <p className="panel__empty">Nothing uploaded yet — try the Upload tab.</p>}

      <div className="feed-grid">
        {content.map((item) => (
          <div key={item.id} className={`feed-card feed-card--${item.status.toLowerCase()}`}>
            <div className="feed-card__media">
              {item.servedPath &&
                (item.kind === 'video' ? (
                  <video src={api.fileForContent(item.servedPath)} controls />
                ) : (
                  <img src={api.fileForContent(item.servedPath)} alt="" />
                ))}
            </div>
            <div className="feed-card__body">
              <div className="feed-card__badges">
                <Badge tier={item.badge_revoked ? null : item.badge_tier} fallbackLabel="NO BADGE" />
                <Badge tier={item.status} />
              </div>
              <p className="feed-card__meta">
                @{item.username} · {item.report_count} report{item.report_count === 1 ? '' : 's'}
              </p>
              <p className="feed-card__tier">metadata: {item.metadata_tier}</p>
              <button
                className="btn-secondary"
                disabled={!currentUserId || reportingId === item.id || item.status !== 'LIVE'}
                onClick={() => handleReport(item.id)}
              >
                {item.status !== 'LIVE' ? 'Already under review/removed' : 'Report as AI'}
              </button>

              {item.status === 'UNDER_REVIEW' &&
                item.user_id === currentUserId &&
                item.pending_strike_id &&
                !item.pending_appeal_id && (
                  <div className="appeal-inline">
                    {appealingId === item.id ? (
                      <>
                        <textarea
                          placeholder="Why do you think this was flagged incorrectly?"
                          value={appealText}
                          onChange={(e) => setAppealText(e.target.value)}
                        />
                        <div className="appeal-inline__actions">
                          <button className="btn-approve" onClick={() => handleFileAppeal(item.pending_strike_id)}>
                            Submit appeal
                          </button>
                          <button className="btn-secondary" onClick={() => setAppealingId(null)}>
                            Cancel
                          </button>
                        </div>
                      </>
                    ) : (
                      <button className="btn-secondary" onClick={() => setAppealingId(item.id)}>
                        This is my content — appeal this strike
                      </button>
                    )}
                  </div>
                )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
