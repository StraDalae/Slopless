// src/components/AdminView.jsx
import { api } from '../api';
import Badge from './Badge';

export default function AdminView({ queue, onRefresh }) {
  async function handleResolve(appealId, outcome) {
    if (!appealId) return;
    await api.resolveAppeal(appealId, outcome);
    onRefresh();
  }

  return (
    <div className="panel">
      <h2>Mod queue</h2>
      <p className="panel__hint">
        Every strike that's currently PENDING — flagged by the community, awaiting either an
        appeal decision or the 48h window lapsing. Only appealed strikes are actionable here;
        the rest just need the appeal window to run out (or you can wire the
        auto-confirm endpoint to a scheduler).
      </p>

      {queue.length === 0 && <p className="panel__empty">Nothing pending review.</p>}

      <div className="queue-list">
        {queue.map((item) => (
          <div key={item.strike_id} className="queue-row">
            <div className="queue-row__media">
              {item.servedPath &&
                (item.kind === 'video' ? (
                  <video src={api.fileForContent(item.servedPath)} controls />
                ) : (
                  <img src={api.fileForContent(item.servedPath)} alt="" />
                ))}
            </div>
            <div className="queue-row__body">
              <div className="queue-row__header">
                <span>Content #{item.content_id} by @{item.username}</span>
                <Badge tier={item.content_status} />
              </div>
              <p className="feed-card__tier">
                metadata: {item.metadata_tier} · {item.report_count} report{item.report_count === 1 ? '' : 's'}
              </p>

              {item.appeal_id ? (
                <div className="appeal-box">
                  <p className="appeal-box__reason">"{item.appeal_reason || '(no reason given)'}"</p>
                  <div className="appeal-box__actions">
                    <button className="btn-approve" onClick={() => handleResolve(item.appeal_id, 'APPROVED')}>
                      Approve appeal (restore content)
                    </button>
                    <button className="btn-deny" onClick={() => handleResolve(item.appeal_id, 'DENIED')}>
                      Deny appeal (confirm strike)
                    </button>
                  </div>
                </div>
              ) : (
                <p className="panel__hint">No appeal filed yet — creator hasn't disputed this strike.</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
