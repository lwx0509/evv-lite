"""Initialize SQLite DB from schema.sql and load sample data.

Builds a "lively" demo dataset: a mix of completed, in-progress, and scheduled
visits for today, including a couple of visits that trip exception flags
(late start, location mismatch, short visit), so the admin dashboard looks
populated immediately without requiring manual check-ins.
"""
import sqlite3
import hashlib
import secrets
import os
from datetime import datetime, timedelta

DB_PATH = os.environ.get("EVV_DB_PATH", "/home/runner/evv.db")
SCHEMA_PATH = os.path.join(os.path.dirname(__file__), "schema.sql")

PBKDF2_ITERATIONS = 200_000


def hash_pw(pw: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt), PBKDF2_ITERATIONS)
    return f"{salt}${digest.hex()}"


def main():
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)

    conn = sqlite3.connect(DB_PATH)
    with open(SCHEMA_PATH) as f:
        conn.executescript(f.read())

    cur = conn.cursor()

    # Agency
    cur.execute("INSERT INTO agencies (name, address) VALUES (?, ?)",
                ("Sunrise Home Care", "123 Main St, Austin, TX"))
    agency_id = cur.lastrowid

    # Users
    cur.execute("INSERT INTO users (agency_id, name, email, role, password_hash) VALUES (?,?,?,?,?)",
                (agency_id, "Alex Admin", "admin@sunrise.com", "admin", hash_pw("admin123")))
    admin_id = cur.lastrowid

    caregivers = [
        ("Jordan Caregiver", "jordan@sunrise.com"),
        ("Taylor Caregiver", "taylor@sunrise.com"),
    ]
    caregiver_ids = []
    for name, email in caregivers:
        cur.execute("INSERT INTO users (agency_id, name, email, role, password_hash) VALUES (?,?,?,?,?)",
                    (agency_id, name, email, "caregiver", hash_pw("caregiver123")))
        caregiver_ids.append(cur.lastrowid)
    jordan_id, taylor_id = caregiver_ids

    # Clients
    clients = [
        ("Mary Johnson", "456 Oak Ave, Austin, TX", 30.2672, -97.7431),
        ("Robert Lee", "789 Pine St, Austin, TX", 30.2700, -97.7500),
        ("Carol Nguyen", "321 Cedar Ln, Austin, TX", 30.2729, -97.7444),
    ]
    client_ids = []
    for name, address, lat, lng in clients:
        cur.execute("INSERT INTO clients (agency_id, name, address, lat, lng) VALUES (?,?,?,?,?)",
                    (agency_id, name, address, lat, lng))
        client_ids.append(cur.lastrowid)
    mary_id, robert_id, carol_id = client_ids

    today = datetime.now().date()

    def dt(hhmm):
        h, m = hhmm.split(":")
        return datetime.combine(today, datetime.min.time()).replace(hour=int(h), minute=int(m))

    def insert_visit(client_id, caregiver_id, start, end, status,
                      check_in=None, check_out=None,
                      check_in_loc=None, check_out_loc=None,
                      flags=""):
        cur.execute(
            "INSERT INTO visits (agency_id, client_id, caregiver_id, scheduled_start, scheduled_end, status) "
            "VALUES (?,?,?,?,?,?)",
            (agency_id, client_id, caregiver_id, dt(start).isoformat(), dt(end).isoformat(), status)
        )
        visit_id = cur.lastrowid
        cin_lat, cin_lng = check_in_loc or (None, None)
        cout_lat, cout_lng = check_out_loc or (None, None)
        cur.execute(
            "INSERT INTO visit_verifications "
            "(visit_id, check_in_time, check_in_lat, check_in_lng, check_out_time, check_out_lat, check_out_lng, exception_flags) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (visit_id,
             dt(check_in).isoformat() if check_in else None, cin_lat, cin_lng,
             dt(check_out).isoformat() if check_out else None, cout_lat, cout_lng,
             flags)
        )
        return visit_id

    # 1. Clean completed visit — checked in/out on time, at the right location.
    insert_visit(
        mary_id, jordan_id, "08:00", "09:00", "completed",
        check_in="08:02", check_out="09:01",
        check_in_loc=(30.2672, -97.7431), check_out_loc=(30.2672, -97.7431),
        flags="",
    )

    # 2. Completed visit with exceptions: late start, location mismatch, AND short visit.
    insert_visit(
        robert_id, taylor_id, "09:30", "11:00", "completed",
        check_in="09:52", check_out="10:35",
        check_in_loc=(30.2790, -97.7610), check_out_loc=(30.2790, -97.7610),
        flags="late_start,location_mismatch,short_visit",
    )

    # 3. In-progress visit — checked in, not yet checked out (caregiver currently on-site).
    insert_visit(
        carol_id, jordan_id, "13:00", "14:30", "in_progress",
        check_in="13:04",
        check_in_loc=(30.2729, -97.7444),
        flags="",
    )

    # 4. Upcoming scheduled visit — nothing happened yet.
    insert_visit(
        mary_id, taylor_id, "16:00", "17:00", "scheduled",
    )

    # 5. Another upcoming visit assigned to Jordan, for variety.
    insert_visit(
        robert_id, jordan_id, "17:30", "18:30", "scheduled",
    )

    conn.commit()
    conn.close()
    print(f"Seeded database at {DB_PATH}")
    print("Login: admin@sunrise.com / admin123 (admin)")
    print("Login: jordan@sunrise.com / caregiver123 (caregiver)")
    print("Login: taylor@sunrise.com / caregiver123 (caregiver)")


if __name__ == "__main__":
    main()
