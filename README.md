# EVV-lite MVP

Private-pay visit verification & scheduling tool (Texas-focused, no Medicaid aggregator dependency yet).

## Run it

```bash
cd backend
python3 seed.py        # creates /tmp/evv.db with sample data
python3 server.py       # serves API + frontend on http://localhost:8000
```

Open http://localhost:8000 in a browser.

## Logins (seeded)

- Admin: admin@sunrise.com / admin123
- Caregiver: jordan@sunrise.com / caregiver123
- Caregiver: taylor@sunrise.com / caregiver123

## Admin dashboard tabs

- Schedule & Exceptions — today's visit list + flagged exceptions
- New Visit — create visits assigning client + caregiver + time
- Clients — add/list clients
- Caregivers — add/list caregivers
- Payroll Export — download CSV of completed visits with hours worked

## What's included

- SQLite schema (`backend/schema.sql`) with Agency, User, Client, Visit, VisitVerification
  - `payer_type` field on Client anticipates future Medicaid/EVV support
- Pure Python stdlib backend (`backend/server.py`) — no external dependencies
  - Auth: PBKDF2-HMAC-SHA256 password hashing (salted, 200k iterations) + signed JWT (HS256) bearer tokens, 12-hour expiry
  - Visit scheduling & status
  - GPS check-in/check-out
  - Automatic exception flagging: late start, short visit, location mismatch
- Plain HTML/CSS/JS frontend (`frontend/`)
  - Admin dashboard: today's schedule + exceptions queue
  - Caregiver view: today's visits with check-in/check-out buttons (uses browser geolocation)

## Next steps (per project plan)

- Add visit creation UI for admins
- Add client/caregiver management UI
- Payroll export (CSV)
- Move to FastAPI + PostgreSQL for production scale
- Texas TMHP EVV Proprietary System Vendor application (post-traction)

## Auth notes

- Passwords are stored as `salt$pbkdf2_hash` (PBKDF2-HMAC-SHA256, 200,000 iterations).
- Login returns a JWT (HS256) signed with `EVV_SECRET_KEY`, valid 12 hours. The frontend sends it as `Authorization: Bearer <token>`.
- **Before any real deployment**, set `EVV_SECRET_KEY` to a long random secret (e.g. `export EVV_SECRET_KEY=$(openssl rand -hex 32)`) — the default is a dev-only placeholder.
