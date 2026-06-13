# Migration Plan: SQLite/stdlib → PostgreSQL + Hosted Production

This plan covers moving EVV-lite from the local SQLite + Python stdlib prototype to a
production deployment on PostgreSQL with proper hosting. It's written so the migration
can happen incrementally without a rewrite.

## 1. Why migrate now vs. later

The current stack (SQLite + `http.server`) is fine for local testing and a single-user
demo, but has real limits for production:

- SQLite file locking doesn't handle concurrent writes well under multi-caregiver load.
- No managed backups, point-in-time recovery, or replication.
- `ThreadingHTTPServer` has no process management, graceful restarts, or autoscaling.
- A single host means no real uptime guarantee for caregivers checking in from the field.

None of this blocks early private-pay pilots with 1-2 agencies. Recommended trigger to
migrate: **first paying customer, or >5 caregivers using it concurrently** — whichever
comes first.

## 2. Target stack

| Layer | Current | Target |
|---|---|---|
| Database | SQLite file | PostgreSQL 15+ (managed) |
| API framework | `http.server` (stdlib) | FastAPI (Python) |
| ORM / DB access | raw `sqlite3` | SQLAlchemy 2.x + `psycopg` |
| Auth | PBKDF2 + JWT (already done) | unchanged — already portable |
| Frontend | static HTML/JS served by backend | unchanged, served via CDN or same app |
| Hosting | local machine | Render, Fly.io, or Railway (see §5) |

The auth work (task #17) was deliberately written with stdlib `hmac`/`pbkdf2_hmac`, so
it ports directly — no rewrite needed there.

## 3. Schema changes (SQLite → Postgres)

The `schema.sql` is already close to Postgres-compatible. Required changes:

- `INTEGER PRIMARY KEY AUTOINCREMENT` → `SERIAL PRIMARY KEY` (or `GENERATED ALWAYS AS
  IDENTITY`)
- `TEXT` columns storing ISO datetimes → `TIMESTAMPTZ`, store everything in UTC
- `REAL` → `DOUBLE PRECISION` for lat/lng
- Add `CHECK` constraints stay the same (Postgres supports `CHECK(role IN (...))`)
- Add indexes once data volume grows: `visits(agency_id, scheduled_start)`,
  `visit_verifications(visit_id)`
- Drop the now-unused `users.token` column (auth is stateless JWT)
- Add `created_at TIMESTAMPTZ DEFAULT now()` / `updated_at` columns to all tables for
  auditing — useful for HIPAA-style change tracking later

## 4. Migration steps

1. **Stand up Postgres** (managed instance — see §5) and run an updated `schema.sql`
   (Postgres dialect) against it.
2. **Rewrite `server.py` in FastAPI**, incrementally:
   - Each `handle_*` method becomes a FastAPI route function with the same path/verb
   - Replace raw SQL strings with SQLAlchemy Core or ORM models (Core is a lighter
     lift given the existing raw-SQL style)
   - `db()` becomes a SQLAlchemy session dependency injected per-request
   - Keep `hash_pw`, `verify_pw`, `create_jwt`, `verify_jwt`, `compute_exceptions`,
     `haversine_km` as-is — pure functions, no DB coupling
3. **Data migration**: one-off script reads all rows from `/tmp/evv.db` via `sqlite3`
   and bulk-inserts into Postgres via SQLAlemy. For a fresh production deploy with no
   real customer data yet, this step can be skipped — just re-run `seed.py` (ported to
   Postgres) against the new DB.
4. **Environment config**: move `EVV_SECRET_KEY`, `DATABASE_URL`, `EVV_DB_PATH` (retired)
   to environment variables / host secrets manager. Never commit secrets to git.
5. **Frontend**: no changes required — it talks to `/api/*` regardless of backend.
6. **Cut over**: deploy FastAPI app pointed at Postgres, smoke-test all endpoints
   (login, visits, check-in/out, payroll export), then point DNS/users at the new URL.

## 5. Hosting recommendation

For a small home-care agency tool with modest traffic (a few caregivers, a handful of
agencies), avoid AWS/GCP/Azure complexity early on. Recommended options, cheapest to
most "enterprise":

- **Railway** — simplest. One service for FastAPI + one managed Postgres add-on.
  ~$5-20/month at this scale. Good for MVP/pilot.
- **Render** — similar simplicity, free Postgres tier available for dev/staging, paid
  tier (~$7/mo db + ~$7/mo web service) for production. Built-in HTTPS, auto-deploy
  from git.
- **Fly.io** — slightly more control (regions, scaling), Postgres via Fly Postgres or
  Supabase. Good if you need lower latency for a specific region (e.g. Texas-based
  agencies).
- **Supabase** (Postgres only) + Render/Fly for the API — useful if you want a
  browser-based DB admin UI and built-in row-level security out of the box, which can
  help with HIPAA-style access controls later.

**Recommendation for this stage**: Render (web service + managed Postgres). It's the
best balance of low cost, low ops overhead, automatic HTTPS/TLS, and a clear upgrade
path if traffic grows. Revisit if/when you need HIPAA-eligible infrastructure (BAA) —
at that point AWS, GCP, or Azure (all of which offer BAAs) become relevant, or a
HIPAA-focused PaaS like Aptible.

## 6. HIPAA / compliance note

Private-pay-only data is not subject to HIPAA the same way Medicaid claims data is, but
client health/care information is still sensitive. Before onboarding agencies with
real client data:

- Use a host that can sign a Business Associate Agreement (BAA) if you'll handle PHI —
  Render and Railway do **not** currently offer BAAs; AWS, GCP, Azure, and Aptible do.
- Encrypt data at rest (managed Postgres on any of the above does this by default) and
  in transit (HTTPS/TLS — all recommended hosts provide this automatically).
- Plan for audit logging (`created_at`/`updated_at` columns above are a start).

This doesn't need to be solved before the first pilot, but should be revisited before
handling real client PHI at scale or pursuing TMHP aggregator credentialing (see
`TMHP_AGGREGATOR_PATH.md`).

## 7. Rough timeline & cost

| Phase | Effort | Monthly cost |
|---|---|---|
| FastAPI rewrite + Postgres schema | 1-2 weeks (part-time) | $0 (dev) |
| Deploy to Render (staging) | 1-2 days | ~$0-7 |
| Production cutover | 1 day | ~$14-20 |

This is intentionally incremental — the business logic (exception flagging, payroll
export, auth) doesn't change, only where it runs and how it talks to the database.
