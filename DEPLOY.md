# Getting a shareable demo link (Render, free)

This app has no external dependencies — it's pure Python stdlib — so it deploys to
Render's free web service tier as-is. Total time: ~15 minutes, no cost.

## 1. Push the code to GitHub

1. Go to https://github.com/new and create a new repository (e.g. `evv-lite`). Public
   or private both work.
2. On your computer, in the `evv-lite` folder:
   ```bash
   cd evv-lite
   git init
   git add .
   git commit -m "EVV-lite demo"
   git branch -M main
   git remote add origin https://github.com/<your-username>/evv-lite.git
   git push -u origin main
   ```

## 2. Create the Render web service

1. Go to https://render.com and sign up (free — GitHub login is easiest).
2. Click **New +** → **Web Service**.
3. Connect your GitHub account and select the `evv-lite` repo.
4. Configure:
   - **Name**: `evv-lite-demo` (or anything — this becomes part of your URL)
   - **Region**: closest to you (e.g. Oregon or Ohio)
   - **Branch**: `main`
   - **Runtime**: `Python 3`
   - **Build Command**: leave blank (no dependencies to install)
   - **Start Command**: `python3 backend/server.py`
   - **Instance Type**: Free
5. Add an environment variable (under **Environment**):
   - `EVV_SECRET_KEY` = a random string (e.g. generate one at
     https://www.uuidgenerator.net/ or run `openssl rand -hex 32` locally)
6. Click **Create Web Service**.

Render will build and deploy. After a minute or two you'll get a URL like
`https://evv-lite-demo.onrender.com`.

## 3. Try it

Open the URL — the app seeds its demo database automatically on first boot (see
"What you'll see" below). Log in with:

- Admin: `admin@sunrise.com` / `admin123`
- Caregiver: `jordan@sunrise.com` / `caregiver123`
- Caregiver: `taylor@sunrise.com` / `caregiver123`

Share that URL with anyone you want to demo to — no install needed on their end.

## What you'll see (demo data)

The seeded "Sunrise Home Care" agency has a realistic mix for today:

- A **completed visit** with no issues (Mary Johnson / Jordan, 8-9am)
- A **completed visit with exceptions** — late start, wrong location, and shorter
  than scheduled (Robert Lee / Taylor) — shows up in the Exceptions queue
- An **in-progress visit** — caregiver checked in, hasn't checked out yet (Carol
  Nguyen / Jordan)
- Two **upcoming scheduled visits** later today

This gives the admin dashboard something to look at immediately, and gives a
caregiver login real check-in/checkout buttons to demo live.

## Notes / limitations on the free tier

- **Data resets on redeploy or after inactivity**: Render's free tier spins down
  after 15 minutes of no traffic and the filesystem is ephemeral — when it restarts,
  `server.py` re-seeds fresh demo data automatically. Great for demos (always looks
  clean), but **don't use this for real customer data** — that's what the Postgres
  migration plan (`POSTGRES_HOSTING_PLAN.md`) is for.
- **Cold start**: the first request after inactivity takes ~30-60 seconds while the
  free instance wakes up. Mention this if demoing live, or open the link a minute
  before your call.
- **Custom domain / no spin-down**: Render's paid tier ($7/mo) removes both
  limitations if you want a snappier, always-on demo.
