# HumanVerify MVP — verification/moderation pipeline

Backend-only MVP for the "no AI content, ever" social platform idea. No UI
yet, on purpose — this is here so you can poke at the *rules* (metadata
tiers, weighted reporting, strikes, appeals, badges) and see if they behave
the way you want before spending time on screens.

## Quick start (backend logic only, no UI)

```bash
npm install
python3 test/make_fixtures.py       # image fixtures (needs pillow + piexif)
bash test/make_video_fixtures.sh    # video fixtures (needs ffmpeg)
node test/simulate.js               # walks through 14 realistic scenarios end-to-end
```

`simulate.js` deletes and recreates `data.sqlite` every run, so it's safe to
run over and over while you tweak things. Open `data.sqlite` with any SQLite
browser (e.g. DB Browser for SQLite, or `sqlite3 data.sqlite` on the CLI) to
poke at raw table state after a run.

## Running the full web app (backend API + React frontend)

Two terminals, both from the project root:

**Terminal 1 — backend API:**
```bash
npm install
node src/server.js
```
Listens on `http://localhost:3000`. This serves the API *and* the uploaded
files (at `/uploads/...`) so the frontend can play them back.

**Terminal 2 — frontend:**
```bash
cd frontend
npm install
npm run dev
```
Opens on `http://localhost:5173`. It talks to the backend at `localhost:3000`
directly (CORS is enabled on the backend for this) — the API base URL is
hardcoded in `frontend/src/api.js` if you ever need to change it.

**What you'll see:**
- **Upload tab** — pick "post as" a user, upload a file, watch it go through
  the metadata check and get a badge in real time.
- **Feed tab** — every piece of content, its badge/status, and a "Report as
  AI" button. Report the same thing from 3+ different users to watch it flip
  to `UNDER_REVIEW`. If you're logged in as the creator of flagged content,
  an "appeal this strike" option appears right there.
- **Mod Queue tab** — every pending strike, and if an appeal's been filed,
  buttons to approve (restore content) or deny (confirm the strike).

There's no login system — the dropdown in the header is standing in for
"who's currently posting/reporting/appealing," which is enough to exercise
every rule without building real auth yet.

## What's actually implemented

| Module | What it does |
|---|---|
| `src/metadata.js` | Dispatches by file extension to `metadataImage.js` (EXIF, images) or `metadataVideo.js` (ffprobe container tags, video). Both classify into `CAMERA_VERIFIED` / `EDITED_UNKNOWN` / `NO_METADATA` / `AI_SIGNATURE_DETECTED` using shared rules in `metadataShared.js`. |
| `src/reports.js` | Community reporting, weighted by `reporter_trust` (not raw counts), with a per-user daily rate limit. Crossing the weight threshold moves content to `UNDER_REVIEW` and opens a `PENDING` strike — it does **not** delete anything immediately. |
| `src/appeals.js` | Creators can appeal a pending strike. A strike only becomes `CONFIRMED` (i.e. actually counts against the user) if the appeal is denied, or the 48hr window lapses with no appeal filed (`autoConfirmExpiredStrikes`, meant to run on a schedule). Reporter trust is nudged up/down based on whether their report held up. Badges are revoked retroactively on a confirmed strike. |
| `src/restrictions.js` | Escalating posting restrictions based on **confirmed** strikes only (3 strikes → 24hr, 5 → 1 week, 8 → 30 days). Tune `RESTRICTION_LADDER` freely. |
| `src/badges.js` | Computes `HUMAN_VERIFIED` / `UNVERIFIED` / no-badge per piece of content. **Deliberately decoupled from follower count** — see the note in the file for why. High-follower accounts instead get `getReviewPriority() === 'HIGH'`, a fast-track review queue flag, not an auto-pass. |
| `src/upload.js` | Orchestrates the above: checks restriction status → runs metadata check → creates content row → computes badge. |
| `src/server.js` | Express API: users, content upload/feed, reporting, appeals, admin queue. Serves uploaded files back at `/uploads/...` for playback. |
| `frontend/` | React (Vite) app with three tabs — Upload, Feed, Mod Queue — that exercise the whole pipeline through the API above. No auth; a dropdown stands in for "current user." |
| `src/db.js` | Schema, using Node's built-in `node:sqlite` (experimental, zero native deps — swap for Postgres later, nothing else needs to change). |

## Known limitations (read before you trust this too much)

1. **Requires `ffmpeg`/`ffprobe` on PATH for video checks.** Install via
   `brew install ffmpeg` (Mac), `winget install ffmpeg` (Windows), or
   `apt install ffmpeg` (Linux). If it's missing, video uploads just come
   back `NO_METADATA` rather than erroring — see `metadataVideo.js`.
2. **Real-world video metadata is sparse even for genuine camera footage.**
   Almost every upload pathway (AirDrop, iMessage, most social apps, screen
   recording) strips or rewrites container metadata on the way out. So
   `NO_METADATA` / `EDITED_UNKNOWN` will be extremely common even for
   legitimately human-shot video — the metadata layer can sometimes
   *positively confirm* camera origin, but its absence proves nothing. This
   is exactly why the reporting/strike layer has to carry most of the real
   weight, same as for images.
3. **EXIF/metadata is trivially spoofable or strippable.** This whole module
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

## Deploying (Vercel)

The backend is deployment-ready: Postgres instead of local SQLite, Vercel
Blob instead of local disk for uploaded files, and a serverless entry point
at `api/index.js`. You'll need to run the actual deploy yourself from the
Vercel CLI — do this from the project root in your own terminal:

**1. Install the CLI and log in (one-time):**
```bash
npm install -g vercel
vercel login
```

**2. Deploy the backend:**
```bash
vercel --prod
```
Follow the prompts (link to a new project, accept the defaults — it'll
auto-detect the `api/` folder). Note the URL it gives you, e.g.
`https://slopless-api.vercel.app`.

**3. Connect storage (Vercel dashboard, not CLI):**
Go to your new project on vercel.com → **Storage** tab:
- **Add a Postgres database** (Neon-backed, free tier is plenty for this) →
  "Connect to Project". This injects `POSTGRES_URL` automatically.
- **Add a Blob store** → "Connect to Project". This injects
  `BLOB_READ_WRITE_TOKEN` automatically.

**4. Redeploy so the new env vars take effect:**
```bash
vercel --prod
```

**5. Verify it's live:**
```bash
curl https://slopless-api.vercel.app/health
# should return {"ok":true,"storage":"vercel-blob"}
```
If `storage` says `"local-disk"` instead, the Blob store isn't connected
yet — go back to step 3.

**6. Deploy the frontend**, pointing it at your backend URL:
```bash
cd frontend
vercel --prod
```
Then in that project's Vercel dashboard → **Settings → Environment
Variables**, add `VITE_API_BASE` = `https://slopless-api.vercel.app` (your
actual backend URL from step 2), and redeploy once more (`vercel --prod`)
so the build picks it up.

You'll end up with two links: the frontend one is what you share.

**Note on video metadata in production:** `@ffprobe-installer/ffprobe`
bundles a Linux binary that works on Vercel's runtime, so video metadata
checking works the same in production as it does locally — no extra setup
needed for that part.



## Suggested next steps

- Wire `autoConfirmExpiredStrikes` into a scheduled job (Vercel Cron is the
  easy option once this is deployed — add a `crons` entry to `vercel.json`
  hitting `/strikes/auto-confirm-expired` on a timer).
- Add real auth — right now any request can claim to be any userId.
- Add a human-moderator role, separate from "any user."
- Start looking at C2PA SDKs if the metadata layer feels worth building on
  seriously rather than just being a stopgap.
