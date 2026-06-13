"""
EVV-lite backend — pure Python stdlib (http.server + sqlite3).
Run: python3 server.py
Serves API at /api/* and static frontend files from ../frontend
"""
import sqlite3
import json
import hashlib
import hmac
import base64
import secrets
import os
import math
import time
import threading
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

DB_PATH = os.environ.get("EVV_DB_PATH", "/tmp/evv.db")
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")

# --- Config: exception flagging thresholds ---
LATE_START_MINUTES = 15
SHORT_VISIT_MINUTES = 15
LOCATION_MISMATCH_KM = 0.5

# --- Auth config ---
SECRET_KEY = os.environ.get("EVV_SECRET_KEY", "dev-only-insecure-secret-change-me")
TOKEN_TTL_SECONDS = 12 * 60 * 60
PBKDF2_ITERATIONS = 200_000

# --- Alert config (set these as environment variables / Replit Secrets) ---
SMTP_HOST = os.environ.get("SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASS = os.environ.get("SMTP_PASS", "")
ALERT_FROM = os.environ.get("ALERT_FROM_EMAIL", SMTP_USER)
SUPERVISOR_EMAIL = os.environ.get("SUPERVISOR_EMAIL", "")
ALERT_CHECK_INTERVAL = int(os.environ.get("ALERT_CHECK_INTERVAL", "60"))

# In-memory alert state: {visit_id: {"type": str, "sent_at": str, "client_name": str, "caregiver_name": str, "email_sent": bool}}
_sent_alerts: dict = {}
_alerts_lock = threading.Lock()


# ---------- Password hashing ----------
def hash_pw(pw: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt), PBKDF2_ITERATIONS)
    return f"{salt}${digest.hex()}"


def verify_pw(pw: str, stored: str) -> bool:
    try:
        salt, digest_hex = stored.split("$", 1)
    except ValueError:
        return False
    digest = hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt), PBKDF2_ITERATIONS)
    return hmac.compare_digest(digest.hex(), digest_hex)


# ---------- JWT ----------
def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _b64url_decode(s: str) -> bytes:
    padding = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + padding)


def create_jwt(payload: dict, ttl_seconds: int = TOKEN_TTL_SECONDS) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    body = dict(payload)
    body["exp"] = int(time.time()) + ttl_seconds
    segments = [
        _b64url_encode(json.dumps(header, separators=(",", ":")).encode()),
        _b64url_encode(json.dumps(body, separators=(",", ":")).encode()),
    ]
    signing_input = ".".join(segments).encode()
    signature = hmac.new(SECRET_KEY.encode(), signing_input, hashlib.sha256).digest()
    segments.append(_b64url_encode(signature))
    return ".".join(segments)


def verify_jwt(token: str):
    try:
        header_b64, payload_b64, sig_b64 = token.split(".")
        signing_input = f"{header_b64}.{payload_b64}".encode()
        expected_sig = hmac.new(SECRET_KEY.encode(), signing_input, hashlib.sha256).digest()
        if not hmac.compare_digest(_b64url_decode(sig_b64), expected_sig):
            return None
        payload = json.loads(_b64url_decode(payload_b64))
        if payload.get("exp", 0) < time.time():
            return None
        return payload
    except Exception:
        return None


def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def haversine_km(lat1, lng1, lat2, lng2):
    if None in (lat1, lng1, lat2, lng2):
        return None
    R = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def compute_exceptions(visit, verification, client):
    flags = []
    sched_start = datetime.fromisoformat(visit["scheduled_start"])
    sched_end = datetime.fromisoformat(visit["scheduled_end"])

    if verification["check_in_time"]:
        check_in = datetime.fromisoformat(verification["check_in_time"])
        if check_in > sched_start + timedelta(minutes=LATE_START_MINUTES):
            flags.append("late_start")
        dist = haversine_km(verification["check_in_lat"], verification["check_in_lng"],
                             client["lat"], client["lng"])
        if dist is not None and dist > LOCATION_MISMATCH_KM:
            flags.append("location_mismatch")

    if verification["check_in_time"] and verification["check_out_time"]:
        check_in = datetime.fromisoformat(verification["check_in_time"])
        check_out = datetime.fromisoformat(verification["check_out_time"])
        actual_minutes = (check_out - check_in).total_seconds() / 60
        sched_minutes = (sched_end - sched_start).total_seconds() / 60
        if actual_minutes < sched_minutes - SHORT_VISIT_MINUTES:
            flags.append("short_visit")

    return flags


def authenticate(headers):
    auth = headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    token = auth[len("Bearer "):]
    payload = verify_jwt(token)
    if not payload:
        return None
    conn = db()
    user = conn.execute("SELECT * FROM users WHERE id = ?", (payload.get("uid"),)).fetchone()
    conn.close()
    return user


# ---------- Alert engine ----------

def _smtp_configured():
    return bool(SMTP_HOST and SMTP_USER and SMTP_PASS and SUPERVISOR_EMAIL)


def _send_alert_email(visit: dict, overdue_type: str, to_address: str = None) -> tuple[bool, str]:
    """Send an overdue alert email. Returns (success, error_message)."""
    recipient = to_address or SUPERVISOR_EMAIL
    if not recipient:
        return False, "No supervisor email configured (set SUPERVISOR_EMAIL)"
    if not all([SMTP_HOST, SMTP_USER, SMTP_PASS]):
        return False, "SMTP not configured (set SMTP_HOST, SMTP_USER, SMTP_PASS)"

    label = "Missed Check-In" if overdue_type == "missed_checkin" else "Overdue Check-Out"
    subject = f"EVV Alert: {visit['client_name']} — {label}"

    sched_start = datetime.fromisoformat(visit["scheduled_start"]).strftime("%I:%M %p")
    sched_end = datetime.fromisoformat(visit["scheduled_end"]).strftime("%I:%M %p")

    if overdue_type == "missed_checkin":
        detail = (
            f"<b>{visit['caregiver_name']}</b> has not checked in for their visit with "
            f"<b>{visit['client_name']}</b>, which was scheduled to begin at <b>{sched_start}</b>."
        )
        action = "Please contact the caregiver immediately to confirm their status."
    else:
        detail = (
            f"<b>{visit['caregiver_name']}</b>'s visit with <b>{visit['client_name']}</b> "
            f"was scheduled to end at <b>{sched_end}</b> but they have not yet checked out."
        )
        action = "Please verify the caregiver has safely completed the visit."

    html = f"""
    <html><body style="font-family:-apple-system,Helvetica,Arial,sans-serif;background:#f5f6f8;margin:0;padding:24px">
    <div style="max-width:480px;margin:0 auto;background:white;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
      <div style="background:#1f4e79;padding:20px 24px">
        <p style="margin:0;color:white;font-size:18px;font-weight:600">EVV-lite Alert</p>
        <p style="margin:4px 0 0;color:rgba(255,255,255,0.7);font-size:13px">Sunrise Home Care</p>
      </div>
      <div style="padding:24px">
        <div style="background:#fee2e2;border:1px solid #fecaca;border-radius:8px;padding:12px 16px;margin-bottom:20px">
          <p style="margin:0;color:#991b1b;font-size:13px;font-weight:600">⚠️ {label.upper()}</p>
        </div>
        <p style="color:#374151;font-size:14px;line-height:1.6">{detail}</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px">
          <tr><td style="padding:6px 0;color:#6b7280;width:40%">Caregiver</td><td style="padding:6px 0;color:#111827;font-weight:500">{visit['caregiver_name']}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280">Client</td><td style="padding:6px 0;color:#111827;font-weight:500">{visit['client_name']}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280">Scheduled</td><td style="padding:6px 0;color:#111827;font-weight:500">{sched_start} – {sched_end}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280">Address</td><td style="padding:6px 0;color:#111827;font-weight:500">{visit.get('client_address','—')}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280">Alerted at</td><td style="padding:6px 0;color:#111827;font-weight:500">{datetime.now().strftime('%I:%M %p')}</td></tr>
        </table>
        <p style="color:#374151;font-size:13px;background:#f3f4f6;padding:12px;border-radius:6px">{action}</p>
      </div>
      <div style="padding:12px 24px;background:#f9fafb;border-top:1px solid #e5e7eb">
        <p style="margin:0;color:#9ca3af;font-size:11px">Sent by EVV-lite · Sunrise Home Care</p>
      </div>
    </div>
    </body></html>
    """

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = ALERT_FROM or SMTP_USER
    msg["To"] = recipient
    msg.attach(MIMEText(
        f"EVV Alert: {label}\n\n{visit['caregiver_name']} / {visit['client_name']}\n"
        f"Scheduled: {sched_start} – {sched_end}\n\n{action}",
        "plain"
    ))
    msg.attach(MIMEText(html, "html"))

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15) as s:
            s.ehlo()
            s.starttls()
            s.ehlo()
            s.login(SMTP_USER, SMTP_PASS)
            s.send_message(msg)
        return True, ""
    except Exception as e:
        return False, str(e)


def _check_and_send_alerts():
    """Called by the background watcher. Finds overdue visits and fires alerts."""
    try:
        conn = db()
        now = datetime.now()
        rows = conn.execute("""
            SELECT v.id, v.scheduled_start, v.scheduled_end, v.status, v.agency_id,
                   c.name as client_name, c.address as client_address,
                   u.name as caregiver_name, u.email as caregiver_email
            FROM visits v
            JOIN clients c ON c.id = v.client_id
            JOIN users u ON u.id = v.caregiver_id
            WHERE v.status IN ('scheduled', 'in_progress')
        """).fetchall()
        conn.close()
    except Exception as e:
        print(f"[ALERT] DB error: {e}")
        return

    for row in rows:
        visit = dict(row)
        visit_id = visit["id"]
        overdue_type = None

        if visit["status"] == "scheduled" and datetime.fromisoformat(visit["scheduled_start"]) < now:
            overdue_type = "missed_checkin"
        elif visit["status"] == "in_progress" and datetime.fromisoformat(visit["scheduled_end"]) < now:
            overdue_type = "overdue_checkout"

        if not overdue_type:
            continue

        with _alerts_lock:
            existing = _sent_alerts.get(visit_id)
            if existing and existing["type"] == overdue_type:
                continue

            if _smtp_configured():
                ok, err = _send_alert_email(visit, overdue_type)
                email_sent = ok
                if not ok:
                    print(f"[ALERT] Email failed for visit {visit_id}: {err}")
            else:
                email_sent = False
                print(f"[ALERT] {'missed_checkin' if overdue_type == 'missed_checkin' else 'overdue_checkout'} — "
                      f"{visit['client_name']} ({visit['caregiver_name']}) — SMTP not configured, alert logged only")

            _sent_alerts[visit_id] = {
                "visit_id": visit_id,
                "type": overdue_type,
                "sent_at": now.isoformat(timespec="seconds"),
                "client_name": visit["client_name"],
                "caregiver_name": visit["caregiver_name"],
                "email_sent": email_sent,
            }


def _alert_watcher():
    """Background thread: checks for overdue visits every ALERT_CHECK_INTERVAL seconds."""
    while True:
        time.sleep(ALERT_CHECK_INTERVAL)
        try:
            _check_and_send_alerts()
        except Exception as e:
            print(f"[ALERT] Watcher error: {e}")


# ---------- Weekly payroll email ----------

_weekly_email_state: dict = {"last_sent_week": None, "last_sent_at": None}
_weekly_email_lock = threading.Lock()


def _last_week_range():
    """Return (monday, sunday) of the previous ISO week as date objects."""
    today = datetime.now().date()
    this_monday = today - timedelta(days=today.weekday())
    last_monday = this_monday - timedelta(days=7)
    last_sunday = last_monday + timedelta(days=6)
    return last_monday, last_sunday


def _build_weekly_summary(agency_id: int, conn) -> list:
    """Return list of dicts per caregiver: name, visit_count, total_hours, flags."""
    monday, sunday = _last_week_range()
    rows = conn.execute("""
        SELECT u.name as caregiver_name,
               vv.check_in_time, vv.check_out_time, vv.exception_flags
        FROM visits v
        JOIN users u ON u.id = v.caregiver_id
        LEFT JOIN visit_verifications vv ON vv.visit_id = v.id
        WHERE v.agency_id = ? AND v.status = 'completed'
          AND date(v.scheduled_start) >= date(?)
          AND date(v.scheduled_start) <= date(?)
        ORDER BY u.name, v.scheduled_start
    """, (agency_id, monday.isoformat(), sunday.isoformat())).fetchall()

    summary: dict = {}
    for r in rows:
        name = r["caregiver_name"]
        if name not in summary:
            summary[name] = {"caregiver_name": name, "visit_count": 0,
                             "total_hours": 0.0, "flag_set": set()}
        summary[name]["visit_count"] += 1
        if r["check_in_time"] and r["check_out_time"]:
            delta = (datetime.fromisoformat(r["check_out_time"])
                     - datetime.fromisoformat(r["check_in_time"]))
            summary[name]["total_hours"] += delta.total_seconds() / 3600
        if r["exception_flags"]:
            for f in r["exception_flags"].split(","):
                f = f.strip()
                if f:
                    summary[name]["flag_set"].add(f)

    result = []
    for s in summary.values():
        result.append({
            "caregiver_name": s["caregiver_name"],
            "visit_count": s["visit_count"],
            "total_hours": round(s["total_hours"], 2),
            "flags": sorted(s["flag_set"]),
        })
    return result


def _send_weekly_payroll_email(summary_rows: list, week_start: str, week_end: str) -> tuple:
    """Send the weekly payroll HTML email. Returns (success, error_message)."""
    if not _smtp_configured():
        return False, "SMTP not configured"

    total_visits = sum(r["visit_count"] for r in summary_rows)
    total_hours = sum(r["total_hours"] for r in summary_rows)

    rows_html = ""
    for r in summary_rows:
        flag_html = "".join(
            f'<span style="display:inline-block;background:#fee2e2;color:#991b1b;'
            f'font-size:11px;font-weight:600;padding:2px 6px;border-radius:4px;margin:1px">'
            f'{f.replace("_"," ")}</span>'
            for f in r["flags"]
        )
        rows_html += (
            f'<tr>'
            f'<td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-weight:500;color:#111827">{r["caregiver_name"]}</td>'
            f'<td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:center;color:#374151">{r["visit_count"]}</td>'
            f'<td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:center;color:#374151">{r["total_hours"]:.2f}</td>'
            f'<td style="padding:8px 12px;border-bottom:1px solid #f1f5f9">'
            f'{flag_html if flag_html else "<span style=\'color:#9ca3af\'>—</span>"}'
            f'</td></tr>'
        )
    if not rows_html:
        rows_html = '<tr><td colspan="4" style="padding:16px;text-align:center;color:#9ca3af">No completed visits last week.</td></tr>'

    now_str = datetime.now().strftime("%B %d, %Y at %I:%M %p")
    html = f"""<html><body style="font-family:-apple-system,Helvetica,Arial,sans-serif;background:#f5f6f8;margin:0;padding:24px">
<div style="max-width:600px;margin:0 auto;background:white;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
  <div style="background:#1f4e79;padding:20px 28px">
    <p style="margin:0;color:white;font-size:18px;font-weight:700">Weekly Payroll Summary</p>
    <p style="margin:4px 0 0;color:rgba(255,255,255,0.7);font-size:13px">Sunrise Home Care &middot; Week of {week_start} &ndash; {week_end}</p>
  </div>
  <div style="padding:28px">
    <div style="display:flex;gap:16px;margin-bottom:24px">
      <div style="flex:1;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;text-align:center">
        <p style="margin:0;font-size:28px;font-weight:800;color:#1f4e79">{len(summary_rows)}</p>
        <p style="margin:4px 0 0;font-size:12px;color:#64748b">Caregivers</p>
      </div>
      <div style="flex:1;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;text-align:center">
        <p style="margin:0;font-size:28px;font-weight:800;color:#1f4e79">{total_visits}</p>
        <p style="margin:4px 0 0;font-size:12px;color:#64748b">Visits Completed</p>
      </div>
      <div style="flex:1;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;text-align:center">
        <p style="margin:0;font-size:28px;font-weight:800;color:#1f4e79">{total_hours:.1f}</p>
        <p style="margin:4px 0 0;font-size:12px;color:#64748b">Total Hours</p>
      </div>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
      <thead>
        <tr style="background:#f8fafc">
          <th style="padding:10px 12px;text-align:left;color:#64748b;font-weight:600;text-transform:uppercase;font-size:11px;letter-spacing:.05em">Caregiver</th>
          <th style="padding:10px 12px;text-align:center;color:#64748b;font-weight:600;text-transform:uppercase;font-size:11px;letter-spacing:.05em">Visits</th>
          <th style="padding:10px 12px;text-align:center;color:#64748b;font-weight:600;text-transform:uppercase;font-size:11px;letter-spacing:.05em">Hours</th>
          <th style="padding:10px 12px;text-align:left;color:#64748b;font-weight:600;text-transform:uppercase;font-size:11px;letter-spacing:.05em">Exceptions</th>
        </tr>
      </thead>
      <tbody>{rows_html}</tbody>
    </table>
  </div>
  <div style="padding:16px 28px;background:#f9fafb;border-top:1px solid #e5e7eb">
    <p style="margin:0;font-size:12px;color:#9ca3af">Generated by EVV-lite &middot; {now_str}</p>
  </div>
</div>
</body></html>"""

    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"EVV-lite Weekly Payroll \u2014 Week of {week_start}"
    msg["From"] = ALERT_FROM or SMTP_USER
    msg["To"] = SUPERVISOR_EMAIL
    msg.attach(MIMEText(html, "html"))
    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as s:
            s.starttls()
            s.login(SMTP_USER, SMTP_PASS)
            s.sendmail(msg["From"], [SUPERVISOR_EMAIL], msg.as_string())
        return True, ""
    except Exception as e:
        return False, str(e)


def _weekly_email_watcher():
    """Background thread: fires weekly payroll summary every Monday at 8 AM."""
    while True:
        time.sleep(300)  # check every 5 minutes
        try:
            now = datetime.now()
            if now.weekday() != 0 or now.hour != 8:  # 0 = Monday
                continue
            week_key = now.strftime("%Y-W%W")
            with _weekly_email_lock:
                if _weekly_email_state["last_sent_week"] == week_key:
                    continue
            conn = db()
            agencies = conn.execute("SELECT id FROM agencies LIMIT 1").fetchall()
            agency_id = agencies[0]["id"] if agencies else 1
            rows = _build_weekly_summary(agency_id, conn)
            conn.close()
            monday, sunday = _last_week_range()
            ok, err = _send_weekly_payroll_email(rows, monday.isoformat(), sunday.isoformat())
            with _weekly_email_lock:
                _weekly_email_state["last_sent_week"] = week_key
                _weekly_email_state["last_sent_at"] = now.isoformat(timespec="seconds")
            print(f"[PAYROLL] Weekly email {'sent' if ok else 'FAILED: ' + err}")
        except Exception as e:
            print(f"[PAYROLL] Watcher error: {e}")


# ---------- HTTP Handler ----------

class Handler(BaseHTTPRequestHandler):
    def _send_json(self, data, status=200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        return json.loads(self.rfile.read(length))

    def do_OPTIONS(self):
        self._send_json({})

    def _serve_static(self, path):
        if path == "/":
            path = "/index.html"
        full_path = os.path.normpath(os.path.join(FRONTEND_DIR, path.lstrip("/")))
        if not full_path.startswith(os.path.normpath(FRONTEND_DIR)):
            self.send_error(403)
            return
        if not os.path.isfile(full_path):
            self.send_error(404)
            return
        ext = os.path.splitext(full_path)[1]
        content_types = {".html": "text/html", ".js": "application/javascript",
                          ".css": "text/css", ".json": "application/json"}
        ctype = content_types.get(ext, "application/octet-stream")
        with open(full_path, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)

        if path == "/api/visits":
            return self.handle_get_visits(qs)
        if path == "/api/clients":
            return self.handle_get_clients()
        if path == "/api/caregivers":
            return self.handle_get_caregivers()
        if path == "/api/exceptions":
            return self.handle_get_exceptions()
        if path == "/api/payroll/export":
            return self.handle_payroll_export(qs)
        if path == "/api/payroll/summary":
            return self.handle_payroll_summary()
        if path == "/api/alerts/status":
            return self.handle_get_alert_status()
        if path.startswith("/api/"):
            return self._send_json({"error": "not found"}, 404)

        return self._serve_static(path)

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        body = self._read_json()

        if path == "/api/login":
            return self.handle_login(body)
        if path.startswith("/api/visits/") and path.endswith("/checkin"):
            visit_id = int(path.split("/")[3])
            return self.handle_checkin(visit_id, body)
        if path.startswith("/api/visits/") and path.endswith("/checkout"):
            visit_id = int(path.split("/")[3])
            return self.handle_checkout(visit_id, body)
        if path == "/api/visits":
            return self.handle_create_visit(body)
        if path == "/api/clients":
            return self.handle_create_client(body)
        if path == "/api/caregivers":
            return self.handle_create_caregiver(body)
        if path == "/api/alerts/test":
            return self.handle_alert_test(body)
        if path == "/api/alerts/dismiss":
            return self.handle_alert_dismiss(body)
        if path == "/api/payroll/email-now":
            return self.handle_payroll_email_now()

        return self._send_json({"error": "not found"}, 404)

    # ---------- Alert handlers ----------

    def handle_get_alert_status(self):
        user = authenticate(self.headers)
        if not user or user["role"] != "admin":
            return self._send_json({"error": "unauthorized"}, 401)

        masked_email = ""
        if SUPERVISOR_EMAIL:
            parts = SUPERVISOR_EMAIL.split("@")
            masked_email = parts[0][:2] + "***@" + parts[1] if len(parts) == 2 else "***"

        with _alerts_lock:
            alerts_list = sorted(_sent_alerts.values(), key=lambda a: a["sent_at"], reverse=True)

        return self._send_json({
            "configured": _smtp_configured(),
            "supervisor_email_masked": masked_email,
            "smtp_host": SMTP_HOST or "",
            "alerts": alerts_list,
        })

    def handle_alert_test(self, body):
        user = authenticate(self.headers)
        if not user or user["role"] != "admin":
            return self._send_json({"error": "unauthorized"}, 401)

        to = body.get("to", SUPERVISOR_EMAIL)
        if not to:
            return self._send_json({"error": "No recipient email provided"}, 400)

        test_visit = {
            "id": 0,
            "client_name": "Test Client",
            "client_address": "123 Demo St, Austin TX",
            "caregiver_name": "Test Caregiver",
            "caregiver_email": "caregiver@example.com",
            "scheduled_start": datetime.now().replace(hour=9, minute=0, second=0).isoformat(),
            "scheduled_end": datetime.now().replace(hour=10, minute=0, second=0).isoformat(),
        }
        ok, err = _send_alert_email(test_visit, "missed_checkin", to_address=to)
        if ok:
            return self._send_json({"ok": True, "message": f"Test alert sent to {to}"})
        return self._send_json({"ok": False, "error": err or "Failed to send test email"}, 500)

    def handle_alert_dismiss(self, body):
        user = authenticate(self.headers)
        if not user or user["role"] != "admin":
            return self._send_json({"error": "unauthorized"}, 401)
        visit_id = body.get("visit_id")
        if visit_id is None:
            return self._send_json({"error": "visit_id required"}, 400)
        with _alerts_lock:
            _sent_alerts.pop(visit_id, None)
        return self._send_json({"ok": True})

    # ---------- Core handlers ----------

    def handle_login(self, body):
        email = body.get("email", "")
        password = body.get("password", "")
        conn = db()
        user = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        if not user or not verify_pw(password, user["password_hash"]):
            conn.close()
            return self._send_json({"error": "invalid credentials"}, 401)
        token = create_jwt({"uid": user["id"], "role": user["role"]})
        conn.close()
        return self._send_json({
            "token": token,
            "user": {"id": user["id"], "name": user["name"], "role": user["role"],
                     "agency_id": user["agency_id"]}
        })

    def handle_get_visits(self, qs):
        user = authenticate(self.headers)
        if not user:
            return self._send_json({"error": "unauthorized"}, 401)
        conn = db()
        query = """
            SELECT v.*, c.name as client_name, c.address as client_address,
                   u.name as caregiver_name,
                   vv.check_in_time, vv.check_out_time, vv.exception_flags, vv.notes
            FROM visits v
            JOIN clients c ON c.id = v.client_id
            JOIN users u ON u.id = v.caregiver_id
            LEFT JOIN visit_verifications vv ON vv.visit_id = v.id
            WHERE v.agency_id = ?
        """
        params = [user["agency_id"]]
        if user["role"] == "caregiver":
            query += " AND v.caregiver_id = ?"
            params.append(user["id"])
        elif "caregiver_id" in qs:
            query += " AND v.caregiver_id = ?"
            params.append(int(qs["caregiver_id"][0]))
        if "client_id" in qs:
            query += " AND v.client_id = ?"
            params.append(int(qs["client_id"][0]))
        order = "DESC" if qs.get("order", ["asc"])[0] == "desc" else "ASC"
        query += f" ORDER BY v.scheduled_start {order}"
        rows = conn.execute(query, params).fetchall()
        conn.close()
        return self._send_json({"visits": [dict(r) for r in rows]})

    def handle_get_clients(self):
        user = authenticate(self.headers)
        if not user:
            return self._send_json({"error": "unauthorized"}, 401)
        conn = db()
        rows = conn.execute("SELECT * FROM clients WHERE agency_id = ?", (user["agency_id"],)).fetchall()
        conn.close()
        return self._send_json({"clients": [dict(r) for r in rows]})

    def handle_get_caregivers(self):
        user = authenticate(self.headers)
        if not user:
            return self._send_json({"error": "unauthorized"}, 401)
        conn = db()
        rows = conn.execute("SELECT id, name, email FROM users WHERE agency_id = ? AND role = 'caregiver'",
                             (user["agency_id"],)).fetchall()
        conn.close()
        return self._send_json({"caregivers": [dict(r) for r in rows]})

    def handle_get_exceptions(self):
        user = authenticate(self.headers)
        if not user or user["role"] != "admin":
            return self._send_json({"error": "unauthorized"}, 401)
        conn = db()
        rows = conn.execute("""
            SELECT v.*, c.name as client_name, u.name as caregiver_name, vv.exception_flags
            FROM visits v
            JOIN clients c ON c.id = v.client_id
            JOIN users u ON u.id = v.caregiver_id
            LEFT JOIN visit_verifications vv ON vv.visit_id = v.id
            WHERE v.agency_id = ? AND vv.exception_flags IS NOT NULL AND vv.exception_flags != ''
        """, (user["agency_id"],)).fetchall()
        conn.close()
        return self._send_json({"exceptions": [dict(r) for r in rows]})

    def handle_create_visit(self, body):
        user = authenticate(self.headers)
        if not user or user["role"] != "admin":
            return self._send_json({"error": "unauthorized"}, 401)
        conn = db()
        cur = conn.execute(
            "INSERT INTO visits (agency_id, client_id, caregiver_id, scheduled_start, scheduled_end, status) "
            "VALUES (?,?,?,?,?,'scheduled')",
            (user["agency_id"], body["client_id"], body["caregiver_id"],
             body["scheduled_start"], body["scheduled_end"])
        )
        visit_id = cur.lastrowid
        conn.execute("INSERT INTO visit_verifications (visit_id) VALUES (?)", (visit_id,))
        conn.commit()
        conn.close()
        return self._send_json({"id": visit_id}, 201)

    def handle_checkin(self, visit_id, body):
        user = authenticate(self.headers)
        if not user:
            return self._send_json({"error": "unauthorized"}, 401)
        conn = db()
        now = datetime.now().isoformat(timespec="seconds")
        conn.execute(
            "UPDATE visit_verifications SET check_in_time=?, check_in_lat=?, check_in_lng=? WHERE visit_id=?",
            (now, body.get("lat"), body.get("lng"), visit_id)
        )
        conn.execute("UPDATE visits SET status='in_progress' WHERE id=?", (visit_id,))
        self._recompute_flags(conn, visit_id)
        conn.commit()
        conn.close()
        # Clear any missed_checkin alert for this visit since they checked in
        with _alerts_lock:
            if visit_id in _sent_alerts and _sent_alerts[visit_id]["type"] == "missed_checkin":
                _sent_alerts.pop(visit_id)
        return self._send_json({"ok": True, "check_in_time": now})

    def handle_checkout(self, visit_id, body):
        user = authenticate(self.headers)
        if not user:
            return self._send_json({"error": "unauthorized"}, 401)
        conn = db()
        now = datetime.now().isoformat(timespec="seconds")
        notes = (body.get("notes") or "").strip() or None
        conn.execute(
            "UPDATE visit_verifications SET check_out_time=?, check_out_lat=?, check_out_lng=?, notes=? WHERE visit_id=?",
            (now, body.get("lat"), body.get("lng"), notes, visit_id)
        )
        conn.execute("UPDATE visits SET status='completed' WHERE id=?", (visit_id,))
        self._recompute_flags(conn, visit_id)
        conn.commit()
        conn.close()
        # Clear overdue_checkout alert
        with _alerts_lock:
            _sent_alerts.pop(visit_id, None)
        return self._send_json({"ok": True, "check_out_time": now})

    def handle_create_client(self, body):
        user = authenticate(self.headers)
        if not user or user["role"] != "admin":
            return self._send_json({"error": "unauthorized"}, 401)
        if not body.get("name"):
            return self._send_json({"error": "name is required"}, 400)
        conn = db()
        cur = conn.execute(
            "INSERT INTO clients (agency_id, name, address, lat, lng, payer_type, notes) VALUES (?,?,?,?,?,?,?)",
            (user["agency_id"], body["name"], body.get("address"),
             body.get("lat"), body.get("lng"),
             body.get("payer_type", "private_pay"), body.get("notes"))
        )
        client_id = cur.lastrowid
        conn.commit()
        conn.close()
        return self._send_json({"id": client_id}, 201)

    def handle_create_caregiver(self, body):
        user = authenticate(self.headers)
        if not user or user["role"] != "admin":
            return self._send_json({"error": "unauthorized"}, 401)
        name = body.get("name")
        email = body.get("email")
        password = body.get("password")
        if not all([name, email, password]):
            return self._send_json({"error": "name, email, and password are required"}, 400)
        conn = db()
        try:
            cur = conn.execute(
                "INSERT INTO users (agency_id, name, email, role, password_hash) VALUES (?,?,?,'caregiver',?)",
                (user["agency_id"], name, email, hash_pw(password))
            )
        except sqlite3.IntegrityError:
            conn.close()
            return self._send_json({"error": "a user with that email already exists"}, 400)
        caregiver_id = cur.lastrowid
        conn.commit()
        conn.close()
        return self._send_json({"id": caregiver_id}, 201)

    def handle_payroll_summary(self):
        user = authenticate(self.headers)
        if not user or user["role"] != "admin":
            return self._send_json({"error": "unauthorized"}, 401)
        conn = db()
        rows = _build_weekly_summary(user["agency_id"], conn)
        conn.close()
        monday, sunday = _last_week_range()
        # Next Monday 8am
        today = datetime.now().date()
        days_until_monday = (7 - today.weekday()) % 7 or 7
        next_monday = today + timedelta(days=days_until_monday)
        with _weekly_email_lock:
            last_sent = _weekly_email_state["last_sent_at"]
        return self._send_json({
            "week_start": monday.isoformat(),
            "week_end": sunday.isoformat(),
            "rows": rows,
            "smtp_configured": _smtp_configured(),
            "supervisor_email": SUPERVISOR_EMAIL,
            "last_sent_at": last_sent,
            "next_scheduled": f"{next_monday.isoformat()}T08:00:00",
        })

    def handle_payroll_email_now(self):
        user = authenticate(self.headers)
        if not user or user["role"] != "admin":
            return self._send_json({"error": "unauthorized"}, 401)
        conn = db()
        rows = _build_weekly_summary(user["agency_id"], conn)
        conn.close()
        monday, sunday = _last_week_range()
        ok, err = _send_weekly_payroll_email(rows, monday.isoformat(), sunday.isoformat())
        if ok:
            with _weekly_email_lock:
                _weekly_email_state["last_sent_at"] = datetime.now().isoformat(timespec="seconds")
            return self._send_json({"ok": True})
        return self._send_json({"error": err}, 500)

    def handle_payroll_export(self, qs):
        user = authenticate(self.headers)
        if not user or user["role"] != "admin":
            return self._send_json({"error": "unauthorized"}, 401)
        conn = db()
        query = """
            SELECT u.name as caregiver_name, u.email as caregiver_email,
                   c.name as client_name, v.scheduled_start, v.scheduled_end,
                   vv.check_in_time, vv.check_out_time
            FROM visits v
            JOIN clients c ON c.id = v.client_id
            JOIN users u ON u.id = v.caregiver_id
            LEFT JOIN visit_verifications vv ON vv.visit_id = v.id
            WHERE v.agency_id = ? AND v.status = 'completed'
        """
        params = [user["agency_id"]]
        if "start" in qs:
            query += " AND date(v.scheduled_start) >= date(?)"
            params.append(qs["start"][0])
        if "end" in qs:
            query += " AND date(v.scheduled_start) <= date(?)"
            params.append(qs["end"][0])
        query += " ORDER BY u.name, v.scheduled_start"
        rows = conn.execute(query, params).fetchall()
        conn.close()

        import csv, io
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(["Caregiver", "Email", "Client", "Scheduled Start", "Scheduled End",
                          "Check In", "Check Out", "Hours Worked"])
        for r in rows:
            hours = ""
            if r["check_in_time"] and r["check_out_time"]:
                delta = datetime.fromisoformat(r["check_out_time"]) - datetime.fromisoformat(r["check_in_time"])
                hours = f"{delta.total_seconds() / 3600:.2f}"
            writer.writerow([r["caregiver_name"], r["caregiver_email"], r["client_name"],
                              r["scheduled_start"], r["scheduled_end"],
                              r["check_in_time"] or "", r["check_out_time"] or "", hours])

        body = buf.getvalue().encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/csv")
        self.send_header("Content-Disposition", "attachment; filename=\"payroll_export.csv\"")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _recompute_flags(self, conn, visit_id):
        visit = conn.execute("SELECT * FROM visits WHERE id=?", (visit_id,)).fetchone()
        verification = conn.execute("SELECT * FROM visit_verifications WHERE visit_id=?", (visit_id,)).fetchone()
        client = conn.execute("SELECT * FROM clients WHERE id=?", (visit["client_id"],)).fetchone()
        flags = compute_exceptions(visit, verification, client)
        conn.execute("UPDATE visit_verifications SET exception_flags=? WHERE visit_id=?",
                      (",".join(flags), visit_id))

    def log_message(self, format, *args):
        pass


if __name__ == "__main__":
    if not os.path.exists(DB_PATH):
        print("No database found — seeding demo data...")
        import seed
        seed.main()

    # Migrate: add notes column to visit_verifications if missing
    try:
        _mconn = db()
        _mconn.execute("ALTER TABLE visit_verifications ADD COLUMN notes TEXT")
        _mconn.commit()
        _mconn.close()
        print("[MIGRATE] Added notes column to visit_verifications")
    except Exception:
        pass  # Column already exists

    # Start background alert watcher
    watcher = threading.Thread(target=_alert_watcher, daemon=True)
    watcher.start()
    print(f"[ALERT] Watcher started (checks every {ALERT_CHECK_INTERVAL}s, SMTP {'configured' if _smtp_configured() else 'not configured — set SMTP_HOST, SMTP_USER, SMTP_PASS, SUPERVISOR_EMAIL'})")

    # Start weekly payroll email watcher
    weekly_watcher = threading.Thread(target=_weekly_email_watcher, daemon=True)
    weekly_watcher.start()
    print("[PAYROLL] Weekly email watcher started (fires Mondays at 8 AM)")

    port = int(os.environ.get("PORT", 8000))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"EVV-lite server running on http://localhost:{port}")
    server.serve_forever()
