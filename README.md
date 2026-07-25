## Quick start

```bash
npm install
python3 test/make_fixtures.py   # generates sample images with different EXIF profiles (needs pillow + piexif)
node test/simulate.js           # walks through 10 realistic scenarios end-to-end
```

`simulate.js` deletes and recreates `data.sqlite` every run, so it's safe to
run over and over while you tweak things. Open `data.sqlite` with any SQLite
browser (e.g. DB Browser for SQLite, or `sqlite3 data.sqlite` on the CLI) to
poke at raw table state after a run.

To run it as an actual HTTP API instead:
```bash
node src/server.js   # listens on :3000
```
See `src/server.js` for the routes (`/users`, `/content/upload`,
`/content/:id/report`, `/strikes/:id/appeal`, `/appeals/:id/resolve`, etc).

## What's actually implemented

| Module | What it does |
|---|---|
| `src/metadata.js` | Classifies a file into `CAMERA_VERIFIED` / `EDITED_UNKNOWN` / `NO_METADATA` / `AI_SIGNATURE_DETECTED` based on EXIF tags. **Images only** right now — see limitations below. |
| `src/reports.js` | Community reporting, weighted by `reporter_trust` (not raw counts), with a per-user daily rate limit. Crossing the weight threshold moves content to `UNDER_REVIEW` and opens a `PENDING` strike — it does **not** delete anything immediately. |
| `src/appeals.js` | Creators can appeal a pending strike. A strike only becomes `CONFIRMED` (i.e. actually counts against the user) if the appeal is denied, or the 48hr window lapses with no appeal filed (`autoConfirmExpiredStrikes`, meant to run on a schedule). Reporter trust is nudged up/down based on whether their report held up. Badges are revoked retroactively on a confirmed strike. |
| `src/restrictions.js` | Escalating posting restrictions based on **confirmed** strikes only (3 strikes → 24hr, 5 → 1 week, 8 → 30 days). Tune `RESTRICTION_LADDER` freely. |
| `src/badges.js` | Computes `HUMAN_VERIFIED` / `UNVERIFIED` / no-badge per piece of content. **Deliberately decoupled from follower count** — see the note in the file for why. High-follower accounts instead get `getReviewPriority() === 'HIGH'`, a fast-track review queue flag, not an auto-pass. |
| `src/upload.js` | Orchestrates the above: checks restriction status → runs metadata check → creates content row → computes badge. |
| `src/db.js` | Schema, using Node's built-in `node:sqlite` (experimental, zero native deps — swap for Postgres later, nothing else needs to change). |

## Known limitations (read before you trust this too much)

1. **Metadata is only really implemented for images.** Video metadata lives
   in container atoms, not EXIF, and needs an `ffprobe`-based checker. Right
   now any video will just come back `NO_METADATA` and fall through to the
   community-reporting path. This is the single biggest thing to build next
   if you want the metadata layer to actually do anything for your primary
   content type (short-form video).
2. **EXIF/metadata is trivially spoofable or strippable.** This whole module
   is a speed bump for lazy uploads, not a real detector. The honest
   long-term answer is [C2PA Content Credentials](https://c2pa.org/) — a
   cryptographically signed provenance chain from capture device through
   edits to export, which is much harder to fake than a metadata tag.
3. **The AI tool signature list (`AI_TOOL_SIGNATURES` in `metadata.js`) will
   always be incomplete** and needs active maintenance as new tools appear.
4. **No real anti-brigading beyond a daily rate limit.** A production system
   would also want to detect timing clusters (many reports landing in a
   tight window from accounts with little other engagement).
5. **`autoConfirmExpiredStrikes()` needs a scheduler** (cron, a queue worker,
   etc.) to actually run periodically — it's a plain function, not wired to
   anything time-based.
6. **No auth, no real file storage, no video transcoding** — this is
   pipeline logic only, as requested.

## Suggested next steps

- Swap the fixture images for real test video files once you have an
  `ffprobe`-based metadata checker.
- Wire `autoConfirmExpiredStrikes` into a scheduled job.
- Add a human-moderator review queue (right now `resolveAppeal` just takes
  an outcome string — it doesn't yet model who's allowed to call it).
- Start looking at C2PA SDKs if the metadata layer feels worth building on
  seriously rather than just being a stopgap.
