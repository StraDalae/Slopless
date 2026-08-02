// src/components/Badge.jsx
// The badge chip is the one visual signature of this app: a compact,
// telemetry-style status readout used everywhere a tier/status appears.

const TIER_CONFIG = {
  CAMERA_VERIFIED: { label: 'CAMERA VERIFIED', tone: 'good' },
  EDITED_UNKNOWN: { label: 'EDITED / UNKNOWN', tone: 'warn' },
  NO_METADATA: { label: 'NO METADATA', tone: 'warn' },
  AI_SIGNATURE_DETECTED: { label: 'AI SIGNATURE', tone: 'alert' },
  HUMAN_VERIFIED: { label: 'HUMAN VERIFIED', tone: 'good' },
  UNVERIFIED: { label: 'UNVERIFIED', tone: 'warn' },
  LIVE: { label: 'LIVE', tone: 'good' },
  UNDER_REVIEW: { label: 'UNDER REVIEW', tone: 'warn' },
  REMOVED: { label: 'REMOVED', tone: 'alert' },
  PENDING: { label: 'PENDING', tone: 'warn' },
  CONFIRMED: { label: 'CONFIRMED', tone: 'alert' },
  OVERTURNED: { label: 'OVERTURNED', tone: 'good' },
  APPROVED: { label: 'APPROVED', tone: 'good' },
  DENIED: { label: 'DENIED', tone: 'alert' },
};

export default function Badge({ tier, fallbackLabel = 'NONE' }) {
  const config = TIER_CONFIG[tier] || { label: fallbackLabel, tone: 'neutral' };
  return (
    <span className={`badge badge--${config.tone}`}>
      <span className="badge__dot" />
      {config.label}
    </span>
  );
}
