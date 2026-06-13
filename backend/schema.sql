-- EVV-lite schema (SQLite)

CREATE TABLE IF NOT EXISTS agencies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    address TEXT,
    timezone TEXT DEFAULT 'America/Chicago'
);

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agency_id INTEGER NOT NULL REFERENCES agencies(id),
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin','caregiver')),
    password_hash TEXT NOT NULL,
    token TEXT
);

CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agency_id INTEGER NOT NULL REFERENCES agencies(id),
    name TEXT NOT NULL,
    address TEXT,
    lat REAL,
    lng REAL,
    payer_type TEXT DEFAULT 'private_pay',  -- 'private_pay' or 'medicaid' (future)
    notes TEXT
);

CREATE TABLE IF NOT EXISTS visits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agency_id INTEGER NOT NULL REFERENCES agencies(id),
    client_id INTEGER NOT NULL REFERENCES clients(id),
    caregiver_id INTEGER NOT NULL REFERENCES users(id),
    scheduled_start TEXT NOT NULL,  -- ISO datetime
    scheduled_end TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'scheduled'  -- scheduled/in_progress/completed/missed
);

CREATE TABLE IF NOT EXISTS visit_verifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    visit_id INTEGER NOT NULL REFERENCES visits(id),
    check_in_time TEXT,
    check_in_lat REAL,
    check_in_lng REAL,
    check_out_time TEXT,
    check_out_lat REAL,
    check_out_lng REAL,
    notes TEXT,
    exception_flags TEXT  -- comma-separated flags, e.g. "late_start,location_mismatch"
);
