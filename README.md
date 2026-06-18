# EVV-lite

**Electronic Visit Verification for Texas private-pay home care agencies.**

A lightweight, self-hosted EVV system built for small agencies that don't need the complexity (or cost) of enterprise platforms. Caregivers check in and out from their phones; supervisors monitor visits, exceptions, and payroll from the admin dashboard.

---

## Features

### Caregiver mobile app
- GPS-verified check-in and check-out from any smartphone browser
- Notes step at check-out — caregiver writes a visit summary before GPS is captured
- QR code door signs — scan to open the check-in page pre-filled with the client
- Animated confirmation screen with visit status cards

### Admin dashboard

| Tab | What it does |
|-----|-------------|
| **Schedule & Exceptions** | Live auto-refreshing visit table for today. Red badge counts overdue visits. Flags late check-ins, late check-outs, location mismatches. |
| **New Visit** | Schedule a visit: client, caregiver, date, start/end time |
| **Clients** | Add clients with home address and GPS coordinates. Print QR door sign. Click name → full visit history modal. |
| **Caregivers** | Add caregivers. Click name → performance summary modal with on-time rate and recurring exception breakdown. |
| **Payroll Export** | Weekly auto-email (fires Mondays 8 AM). Manual Send Now. Date-range CSV download. |
| **Alerts** | Real-time overdue alert log. SMTP config status. Send test email. |

### Visit history & performance modals
- Per-client or per-caregiver visit timeline (newest first)
- Date-range filter — live re-fetch, no button click needed
- Stats bar: visits, hours, exceptions / on-time rate
- PDF export — opens a print-ready page in a new tab

### Automated emails
- **Overdue alerts** — fires when a caregiver is 15+ min late to check in or check out
- **Weekly payroll summary** — Monday 8 AM, per-caregiver hours table with exception flags

### Security
- Passwords stored with PBKDF2-HMAC-SHA256 (200,000 iterations + per-user salt)
- HS256 JWT tokens, 12-hour TTL, verified on every API request
- Login rate limiting — 10 failed attempts per 5 minutes triggers a 15-minute IP lockout
- Constant-time digest comparison to prevent timing attacks
- Startup warning if the default insecure `EVV_SECRET_KEY` is still in use

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite 8, Tailwind CSS v4, Framer Motion, React Router |
| Backend | Python 3 stdlib only (`http.server`, `sqlite3`, `smtplib`) — zero pip dependencies |
| Database | SQLite at `/tmp/evv.db` |
| Auth | Custom PBKDF2 + HS256 JWT — no third-party auth library |

---

## Getting started

### Run on Replit
The app starts automatically via the configured workflow:
```
PORT=8080 python3 backend/server.py & npm run dev
```
- Backend API: `http://localhost:8080`
- Frontend dev server: `http://localhost:5000` — proxies `/api/*` to port 8080

### Demo accounts
| Role | Email | Password |
|------|-------|----------|
| Admin | `admin@sunrise.com` | `admin123` |
| Caregiver | `jordan@sunrise.com` | `caregiver123` |
| Caregiver | `taylor@sunrise.com` | `caregiver123` |

---

## Environment variables / Replit Secrets

| Variable | Required | Description |
|----------|----------|-------------|
| `EVV_SECRET_KEY` | **Yes (production)** | Secret used to sign JWT tokens. Generate with `openssl rand -hex 32`. |
| `SMTP_HOST` | For emails | SMTP server hostname (e.g. `smtp.gmail.com`) |
| `SMTP_PORT` | For emails | SMTP port, default `587` |
| `SMTP_USER` | For emails | SMTP login username |
| `SMTP_PASS` | For emails | SMTP password or App Password |
| `SUPERVISOR_EMAIL` | For emails | Address that receives overdue alerts and weekly payroll summary |
| `ALERT_FROM_EMAIL` | Optional | From address on alert emails (defaults to `SMTP_USER`) |
| `ALERT_CHECK_INTERVAL` | Optional | Alert polling interval in seconds, default `60` |
| `EVV_DB_PATH` | Optional | SQLite file path, default `/tmp/evv.db` |

> **Gmail tip:** Enable 2-factor authentication, then generate an **App Password** at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords). Use that as `SMTP_PASS`.

---

## Database schema

```
agencies            id, name
users               id, agency_id, name, email, password_hash, role (admin|caregiver)
clients             id, agency_id, name, address, payer_type, lat, lng
visits              id, agency_id, client_id, caregiver_id, scheduled_start, scheduled_end, status
visit_verifications id, visit_id, check_in_time, check_out_time,
                    check_in_lat, check_in_lng, check_out_lat, check_out_lng,
                    exception_flags, notes
```

---

## Logs

The server writes structured logs to both `stderr` and `/tmp/evv.log` (5 MB rotating, 3 backups kept):

```
2026-06-18 08:00:01 INFO     EVV-lite server running on http://localhost:8080
2026-06-18 08:00:01 INFO     [ALERT] Watcher started (checks every 60s)
2026-06-18 08:01:34 WARNING  [AUTH] Rate limit hit for 203.0.113.5 (10 failures) — locked 15 min
2026-06-18 08:15:00 INFO     [PAYROLL] Weekly email sent
2026-06-18 09:22:11 ERROR    [ALERT] Watcher error: database is locked
```

---

## Project structure

```
├── backend/
│   ├── server.py       All API endpoints, auth, alert/payroll watchers
│   └── seed.py         Demo data seed (runs automatically on first launch)
├── src/
│   ├── EVVDashboard.tsx  Admin dashboard — all tabs, history modals, PDF export
│   ├── MobileCheckin.tsx Caregiver mobile check-in/out flow
│   ├── EVVLogin.tsx      Shared login page with post-login redirect
│   ├── QRPrint.tsx       Printable QR door sign page
│   └── main.tsx          Routes: /, /dashboard, /mobile, /qr/:clientId
├── public/
├── index.html
└── vite.config.ts      Proxies /api/* → localhost:8080
```

---

## Auth notes

- Passwords are stored as `salt$pbkdf2_hash` (PBKDF2-HMAC-SHA256, 200,000 iterations).
- Login returns a JWT (HS256) signed with `EVV_SECRET_KEY`, valid 12 hours. The frontend sends it as `Authorization: Bearer <token>`.
- **Before any real deployment**, set `EVV_SECRET_KEY` to a long random secret:
  ```bash
  export EVV_SECRET_KEY=$(openssl rand -hex 32)
  ```
  The server logs a startup warning if the default insecure placeholder is still in use.
