"""
Visiting Systems backend — pure Python stdlib (http.server + sqlite3).
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
import logging
import logging.handlers
import datetime
import shutil
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs


# ---------- Logging ----------


def _setup_logging():
    fmt = logging.Formatter(
        "%(asctime)s %(levelname)-8s %(message)s", datefmt="%Y-%m-%d %H:%M:%S"
    )
    root = logging.getLogger("evv")
    root.setLevel(logging.DEBUG)
    if root.handlers:
        return root
    sh = logging.StreamHandler()
    sh.setFormatter(fmt)
    root.addHandler(sh)
    try:
        fh = logging.handlers.RotatingFileHandler(
            "/tmp/evv.log", maxBytes=5 * 1024 * 1024, backupCount=3
        )
        fh.setFormatter(fmt)
        root.addHandler(fh)
    except OSError:
        pass
    return root


logger = _setup_logging()

DB_PATH = os.environ.get("EVV_DB_PATH", "/app/data/evv.db" if os.path.isdir("/app") else "/home/runner/evv.db")
def backup_to_r2():
    account_id = os.environ.get('R2_ACCOUNT_ID')
    access_key = os.environ.get('R2_ACCESS_KEY_ID')
    secret_key = os.environ.get('R2_SECRET_ACCESS_KEY')
    bucket     = os.environ.get('R2_BUCKET')
    if not all([account_id, access_key, secret_key, bucket]):
        logging.warning('R2 backup: missing env vars, skipping')
        return
    try:
        import boto3
        ts          = datetime.utcnow().strftime('%Y-%m-%d_%H-%M-%S')
        tmp         = f'/tmp/evv_backup_{ts}.db'
        shutil.copy2(DB_PATH, tmp)
        s3 = boto3.client(
            's3',
            endpoint_url=f'https://{account_id}.r2.cloudflarestorage.com',
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name='auto',
        )
        s3.upload_file(tmp, bucket, f'backups/evv_{ts}.db')
        os.remove(tmp)
        logging.info(f'R2 backup uploaded: evv_{ts}.db')
    except Exception as e:
        logging.error(f'R2 backup failed: {e}')

def _backup_scheduler():
    backup_to_r2()
    while True:
        time.sleep(86400)
        backup_to_r2()
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "dist")

# --- Config: exception flagging thresholds (defaults; overridable via app_config table) ---
LATE_START_MINUTES = 15
SHORT_VISIT_MINUTES = 15
LOCATION_MISMATCH_KM = 0.5

# --- App configuration defaults (stored in app_config table) ---
CONFIG_DEFAULTS: dict = {
    'agency_name':               'Sunrise Home Care',
    'supervisor_email_override': '',
    'late_start_minutes':        '15',
    'short_visit_minutes':       '15',
    'location_mismatch_km':      '0.5',
    'alert_check_interval':      '60',
}

def get_config_val(key: str) -> str:
    """Return a single config value from DB, falling back to CONFIG_DEFAULTS."""
    try:
        conn = db()
        row = conn.execute("SELECT value FROM app_config WHERE key=?", (key,)).fetchone()
        conn.close()
        if row:
            return row[0]
    except Exception:
        pass
    return CONFIG_DEFAULTS.get(key, '')

def get_all_config() -> dict:
    """Return all config values, merging DB overrides with defaults."""
    result = dict(CONFIG_DEFAULTS)
    try:
        conn = db()
        rows = conn.execute("SELECT key, value FROM app_config").fetchall()
        conn.close()
        for row in rows:
            if row['key'] in result:
                result[row['key']] = row['value']
    except Exception:
        pass
    return result

def set_config_values(updates: dict):
    """Persist config values to the app_config table."""
    conn = db()
    try:
        for key, value in updates.items():
            if key in CONFIG_DEFAULTS:
                conn.execute(
                    "INSERT INTO app_config(key, value, updated_at) VALUES(?,?,datetime('now')) "
                    "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
                    (key, str(value))
                )
        conn.commit()
    finally:
        conn.close()

# --- Auth config ---
SECRET_KEY = os.environ.get("EVV_SECRET_KEY", "dev-only-insecure-secret-change-me")
TOKEN_TTL_SECONDS = 12 * 60 * 60
PBKDF2_ITERATIONS = 200_000

# --- Login rate limiting ---
_MAX_LOGIN_FAILURES = 10  # attempts before lockout
_LOGIN_WINDOW_SECONDS = 300  # rolling window (5 min)
_LOCKOUT_SECONDS = 900  # lockout duration (15 min)
_login_attempts: dict = {}  # {ip: {"count": int, "window_start": float, "locked_until": float}}
_login_rate_lock = threading.Lock()


def _check_rate_limit(ip: str) -> bool:
    """Return True if the IP is allowed to attempt login, False if locked out."""
    now = time.time()
    with _login_rate_lock:
        entry = _login_attempts.get(ip)
        if entry and now < entry.get("locked_until", 0):
            return False
        return True


def _record_failed_login(ip: str):
    now = time.time()
    with _login_rate_lock:
        entry = _login_attempts.get(
            ip, {"count": 0, "window_start": now, "locked_until": 0}
        )
        if now - entry["window_start"] > _LOGIN_WINDOW_SECONDS:
            entry = {"count": 0, "window_start": now, "locked_until": 0}
        entry["count"] += 1
        if entry["count"] >= _MAX_LOGIN_FAILURES:
            entry["locked_until"] = now + _LOCKOUT_SECONDS
            logger.warning(
                f"[AUTH] Rate limit hit for {ip} ({entry['count']} failures) — locked {_LOCKOUT_SECONDS // 60} min"
            )
        _login_attempts[ip] = entry


def _clear_login_attempts(ip: str):
    with _login_rate_lock:
        _login_attempts.pop(ip, None)


# --- Alert config (set these as environment variables / Replit Secrets) ---
SMTP_HOST = os.environ.get("SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASS = os.environ.get("SMTP_PASS", "")
ALERT_FROM = os.environ.get("ALERT_FROM_EMAIL", SMTP_USER)
SUPERVISOR_EMAIL = os.environ.get("SUPERVISOR_EMAIL", "")
ALERT_CHECK_INTERVAL = int(os.environ.get("ALERT_CHECK_INTERVAL", "60"))

# --- Twilio SMS config (optional) ---
TWILIO_ACCOUNT_SID = os.environ.get("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = os.environ.get("TWILIO_AUTH_TOKEN", "")
TWILIO_FROM = os.environ.get("TWILIO_FROM_NUMBER", "")
TWILIO_TO = os.environ.get("TWILIO_TO_NUMBER", "")  # supervisor/admin phone

# In-memory alert state: {visit_id: {"type": str, "sent_at": str, "client_name": str, "caregiver_name": str, "email_sent": bool}}
_sent_alerts: dict = {}
_alerts_lock = threading.Lock()
# Exception alerts fired at check-in/checkout: {(visit_id, flag_type)}
_exception_alerts_sent: set = set()
_exception_alerts_lock = threading.Lock()


# ---------- Password hashing ----------
def hash_pw(pw: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", pw.encode(), bytes.fromhex(salt), PBKDF2_ITERATIONS
    )
    return f"{salt}${digest.hex()}"


def verify_pw(pw: str, stored: str) -> bool:
    try:
        salt, digest_hex = stored.split("$", 1)
    except ValueError:
        return False
    digest = hashlib.pbkdf2_hmac(
        "sha256", pw.encode(), bytes.fromhex(salt), PBKDF2_ITERATIONS
    )
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
        expected_sig = hmac.new(
            SECRET_KEY.encode(), signing_input, hashlib.sha256
        ).digest()
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
    a = (
        math.sin(dphi / 2) ** 2
        + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2
    )
    return 2 * R * math.asin(math.sqrt(a))


def compute_exceptions(visit, verification, client):
    flags = []
    late_start_min  = float(get_config_val('late_start_minutes')   or LATE_START_MINUTES)
    short_visit_min = float(get_config_val('short_visit_minutes')   or SHORT_VISIT_MINUTES)
    loc_mismatch_km = float(get_config_val('location_mismatch_km') or LOCATION_MISMATCH_KM)

    sched_start = datetime.fromisoformat(visit["scheduled_start"])
    sched_end = datetime.fromisoformat(visit["scheduled_end"])

    if verification["check_in_time"]:
        check_in = datetime.fromisoformat(verification["check_in_time"])
        if check_in > sched_start + timedelta(minutes=late_start_min):
            flags.append("late_start")
        dist = haversine_km(
            verification["check_in_lat"],
            verification["check_in_lng"],
            client["lat"],
            client["lng"],
        )
        if dist is not None and dist > loc_mismatch_km:
            flags.append("location_mismatch")

    if verification["check_in_time"] and verification["check_out_time"]:
        check_in = datetime.fromisoformat(verification["check_in_time"])
        check_out = datetime.fromisoformat(verification["check_out_time"])
        actual_minutes = (check_out - check_in).total_seconds() / 60
        sched_minutes = (sched_end - sched_start).total_seconds() / 60
        if actual_minutes < sched_minutes - short_visit_min:
            flags.append("short_visit")

    return flags


def authenticate(headers):
    auth = headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    token = auth[len("Bearer ") :]
    payload = verify_jwt(token)
    if not payload:
        return None
    conn = db()
    user = conn.execute(
        "SELECT * FROM users WHERE id = ?", (payload.get("uid"),)
    ).fetchone()
    conn.close()
    if user and not user["approved"]:
        return None
    return user


def log_audit(agency_id: int, admin_id: int, admin_name: str, action: str, details: str = ''):
    try:
        conn = db()
        conn.execute(
            "INSERT INTO audit_log (agency_id, admin_id, admin_name, action, details) VALUES (?,?,?,?,?)",
            (agency_id, admin_id, admin_name, action, details)
        )
        conn.commit()
        conn.close()
    except Exception as e:
        logger.warning(f"[AUDIT] {e}")


_VALID_TIMEZONES = {
    # Eastern
    "America/New_York", "America/Detroit",
    "America/Kentucky/Louisville", "America/Kentucky/Monticello",
    "America/Indiana/Indianapolis", "America/Indiana/Marengo",
    "America/Indiana/Vevay", "America/Indiana/Vincennes",
    "America/Indiana/Petersburg", "America/Indiana/Tell_City",
    "America/Indiana/Knox", "America/Indiana/Winamac",
    # Central
    "America/Chicago", "America/Menominee",
    "America/North_Dakota/Center", "America/North_Dakota/New_Salem",
    "America/North_Dakota/Beulah",
    # Mountain
    "America/Denver", "America/Boise", "America/Phoenix",
    # Pacific
    "America/Los_Angeles",
    # Alaska
    "America/Anchorage", "America/Juneau", "America/Sitka",
    "America/Yakutat", "America/Nome", "America/Metlakatla",
    # Aleutian / Hawaii
    "America/Adak", "Pacific/Honolulu",
    # Territories
    "America/Puerto_Rico", "Pacific/Guam", "Pacific/Pago_Pago",
}


def _is_valid_email(email: str) -> bool:
    import re
    return bool(re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email))


# ---------- Alert engine ----------


def _smtp_configured():
    return bool(SMTP_HOST and SMTP_USER and SMTP_PASS and SUPERVISOR_EMAIL)


def _send_alert_email(
    visit: dict, overdue_type: str, to_address: str = None
) -> tuple[bool, str]:
    """Send an overdue alert email. Returns (success, error_message)."""
    recipient = to_address or SUPERVISOR_EMAIL
    if not recipient:
        return False, "No supervisor email configured (set SUPERVISOR_EMAIL)"
    if not all([SMTP_HOST, SMTP_USER, SMTP_PASS]):
        return False, "SMTP not configured (set SMTP_HOST, SMTP_USER, SMTP_PASS)"

    label = (
        "Missed Check-In" if overdue_type == "missed_checkin" else "Overdue Check-Out"
    )
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
        <p style="margin:0;color:white;font-size:18px;font-weight:600">Visiting Systems Alert</p>
        <p style="margin:4px 0 0;color:rgba(255,255,255,0.7);font-size:13px">Sunrise Home Care</p>
      </div>
      <div style="padding:24px">
        <div style="background:#fee2e2;border:1px solid #fecaca;border-radius:8px;padding:12px 16px;margin-bottom:20px">
          <p style="margin:0;color:#991b1b;font-size:13px;font-weight:600">⚠️ {label.upper()}</p>
        </div>
        <p style="color:#374151;font-size:14px;line-height:1.6">{detail}</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px">
          <tr><td style="padding:6px 0;color:#6b7280;width:40%">Caregiver</td><td style="padding:6px 0;color:#111827;font-weight:500">{visit["caregiver_name"]}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280">Client</td><td style="padding:6px 0;color:#111827;font-weight:500">{visit["client_name"]}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280">Scheduled</td><td style="padding:6px 0;color:#111827;font-weight:500">{sched_start} – {sched_end}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280">Address</td><td style="padding:6px 0;color:#111827;font-weight:500">{visit.get("client_address", "—")}</td></tr>
          <tr><td style="padding:6px 0;color:#6b7280">Alerted at</td><td style="padding:6px 0;color:#111827;font-weight:500">{datetime.now().strftime("%I:%M %p")}</td></tr>
        </table>
        <p style="color:#374151;font-size:13px;background:#f3f4f6;padding:12px;border-radius:6px">{action}</p>
      </div>
      <div style="padding:12px 24px;background:#f9fafb;border-top:1px solid #e5e7eb">
        <p style="margin:0;color:#9ca3af;font-size:11px">Sent by Visiting Systems · Sunrise Home Care</p>
      </div>
    </div>
    </body></html>
    """

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = ALERT_FROM or SMTP_USER
    msg["To"] = recipient
    msg.attach(
        MIMEText(
            f"EVV Alert: {label}\n\n{visit['caregiver_name']} / {visit['client_name']}\n"
            f"Scheduled: {sched_start} – {sched_end}\n\n{action}",
            "plain",
        )
    )
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
        logger.error(f"[ALERT] DB error: {e}")
        return

    for row in rows:
        visit = dict(row)
        visit_id = visit["id"]
        overdue_type = None

        if (
            visit["status"] == "scheduled"
            and datetime.fromisoformat(visit["scheduled_start"]) < now
        ):
            overdue_type = "missed_checkin"
        elif (
            visit["status"] == "in_progress"
            and datetime.fromisoformat(visit["scheduled_end"]) < now
        ):
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
                    logger.warning(f"[ALERT] Email failed for visit {visit_id}: {err}")
            else:
                email_sent = False
                logger.info(
                    f"[ALERT] {'missed_checkin' if overdue_type == 'missed_checkin' else 'overdue_checkout'} — "
                    f"{visit['client_name']} ({visit['caregiver_name']}) — SMTP not configured, alert logged only"
                )

            _sent_alerts[visit_id] = {
                "visit_id": visit_id,
                "type": overdue_type,
                "sent_at": now.isoformat(timespec="seconds"),
                "client_name": visit["client_name"],
                "caregiver_name": visit["caregiver_name"],
                "email_sent": email_sent,
            }


def _sms_configured():
    return bool(TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN and TWILIO_FROM and TWILIO_TO)


def _send_sms(message: str) -> tuple[bool, str]:
    """Send SMS via Twilio REST API using only stdlib urllib."""
    if not _sms_configured():
        return False, "Twilio not configured"
    import urllib.request
    import urllib.parse as up
    url = f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_ACCOUNT_SID}/Messages.json"
    data = up.urlencode({"From": TWILIO_FROM, "To": TWILIO_TO, "Body": message}).encode()
    creds = base64.b64encode(f"{TWILIO_ACCOUNT_SID}:{TWILIO_AUTH_TOKEN}".encode()).decode()
    req = urllib.request.Request(url, data=data, headers={
        "Authorization": f"Basic {creds}",
        "Content-Type": "application/x-www-form-urlencoded",
    })
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status in (200, 201), ""
    except Exception as e:
        return False, str(e)


_EXCEPTION_LABELS = {
    "late_start": "Late Start",
    "location_mismatch": "Location Mismatch",
    "short_visit": "Short Visit",
}


def _send_decline_alert_email(visit: dict, reason: str, to_address: str = None) -> tuple[bool, str]:
    """Send an email alert when a caregiver declines a shift."""
    recipient = to_address or SUPERVISOR_EMAIL
    if not recipient:
        return False, "No supervisor email configured (set SUPERVISOR_EMAIL)"
    if not all([SMTP_HOST, SMTP_USER, SMTP_PASS]):
        return False, "SMTP not configured"
    sched_start = datetime.fromisoformat(visit["scheduled_start"]).strftime("%a %b %d @ %I:%M %p")
    subject = f"Shift Declined – {visit['client_name']} needs reassignment"
    html = f"""<html><body style="font-family:-apple-system,Helvetica,Arial,sans-serif;background:#f5f6f8;margin:0;padding:24px">
<div style="max-width:480px;margin:0 auto;background:white;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
  <div style="background:#1f4e79;padding:20px 24px">
    <p style="margin:0;color:white;font-size:18px;font-weight:600">Visiting Systems Alert</p>
    <p style="margin:4px 0 0;color:rgba(255,255,255,0.7);font-size:13px">Action Required: Reschedule Needed</p>
  </div>
  <div style="padding:24px">
    <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:12px 16px;margin-bottom:20px">
      <p style="margin:0;color:#92400e;font-size:13px;font-weight:600">&#9888;&#65039; SHIFT DECLINED &#8211; RESCHEDULE NEEDED</p>
    </div>
    <p style="color:#374151;font-size:14px;line-height:1.6">
      <b>{visit['caregiver_name']}</b> has declined their scheduled visit with <b>{visit['client_name']}</b>.
      This shift needs to be reassigned immediately.
    </p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px">
      <tr><td style="padding:6px 0;color:#6b7280;width:40%">Caregiver</td><td style="padding:6px 0;color:#111827;font-weight:500">{visit['caregiver_name']}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280">Client</td><td style="padding:6px 0;color:#111827;font-weight:500">{visit['client_name']}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280">Scheduled</td><td style="padding:6px 0;color:#111827;font-weight:500">{sched_start}</td></tr>
    </table>
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:12px;margin-top:8px">
      <p style="margin:0 0 4px;color:#991b1b;font-size:12px;font-weight:600;text-transform:uppercase">Decline reason</p>
      <p style="margin:0;color:#374151;font-size:13px;font-style:italic">&#8220;{reason}&#8221;</p>
    </div>
    <p style="color:#374151;font-size:13px;background:#f3f4f6;padding:12px;border-radius:6px;margin-top:16px">
      Log in to Visiting Systems and open the Alerts tab to reassign this shift to another caregiver.
    </p>
  </div>
  <div style="padding:12px 24px;background:#f9fafb;border-top:1px solid #e5e7eb">
    <p style="margin:0;color:#9ca3af;font-size:11px">Sent by Visiting Systems</p>
  </div>
</div>
</body></html>"""
    plain = (
        f"SHIFT DECLINED – RESCHEDULE NEEDED\n\n"
        f"{visit['caregiver_name']} declined their visit with {visit['client_name']} "
        f"scheduled for {sched_start}.\n\n"
        f"Decline reason: {reason}\n\n"
        f"Log in to Visiting Systems and open the Alerts tab to reassign this shift."
    )
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = ALERT_FROM or SMTP_USER
    msg["To"] = recipient
    msg.attach(MIMEText(plain, "plain"))
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


def _send_exception_alert_email(visit: dict, flag: str) -> tuple[bool, str]:
    """Send an email alert for a post-checkin/checkout exception flag."""
    if not _smtp_configured():
        return False, "SMTP not configured"
    label = _EXCEPTION_LABELS.get(flag, flag.replace("_", " ").title())
    sched_start = datetime.fromisoformat(visit["scheduled_start"]).strftime("%I:%M %p")
    sched_end = datetime.fromisoformat(visit["scheduled_end"]).strftime("%I:%M %p")
    details = {
        "late_start": f"<b>{visit['caregiver_name']}</b> checked in late for their visit with <b>{visit['client_name']}</b> (scheduled {sched_start}).",
        "location_mismatch": f"<b>{visit['caregiver_name']}</b>'s check-in location for <b>{visit['client_name']}</b> did not match the client's address.",
        "short_visit": f"<b>{visit['caregiver_name']}</b>'s visit with <b>{visit['client_name']}</b> was shorter than scheduled (ended before {sched_end}).",
    }
    detail_html = details.get(flag, f"Exception detected: {label}")
    html = f"""<html><body style="font-family:-apple-system,Helvetica,Arial,sans-serif;background:#f5f6f8;margin:0;padding:24px">
<div style="max-width:480px;margin:0 auto;background:white;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
  <div style="background:#1f4e79;padding:20px 24px">
    <p style="margin:0;color:white;font-size:18px;font-weight:600">Visiting Systems Alert</p>
  </div>
  <div style="padding:24px">
    <div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;padding:12px 16px;margin-bottom:16px">
      <p style="margin:0;color:#92400e;font-size:13px;font-weight:600">⚠️ {label.upper()}</p>
    </div>
    <p style="color:#374151;font-size:14px;line-height:1.6">{detail_html}</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px">
      <tr><td style="padding:6px 0;color:#6b7280;width:40%">Caregiver</td><td style="padding:6px 0;color:#111827;font-weight:500">{visit['caregiver_name']}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280">Client</td><td style="padding:6px 0;color:#111827;font-weight:500">{visit['client_name']}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280">Scheduled</td><td style="padding:6px 0;color:#111827;font-weight:500">{sched_start} – {sched_end}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280">Alerted at</td><td style="padding:6px 0;color:#111827;font-weight:500">{datetime.now().strftime("%I:%M %p")}</td></tr>
    </table>
  </div>
</div></body></html>"""
    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"EVV Alert: {visit['client_name']} — {label}"
    msg["From"] = ALERT_FROM or SMTP_USER
    msg["To"] = SUPERVISOR_EMAIL
    msg.attach(MIMEText(f"EVV Exception: {label}\n{detail_html}\nCaregiver: {visit['caregiver_name']}\nClient: {visit['client_name']}", "plain"))
    msg.attach(MIMEText(html, "html"))
    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15) as s:
            s.ehlo(); s.starttls(); s.ehlo()
            s.login(SMTP_USER, SMTP_PASS)
            s.send_message(msg)
        return True, ""
    except Exception as e:
        return False, str(e)


def _fire_exception_alerts(visit_id: int, flags: list, visit: dict):
    """Fire immediate email+SMS alerts for exception flags found at check-in/checkout."""
    for flag in flags:
        if flag not in _EXCEPTION_LABELS:
            continue
        with _exception_alerts_lock:
            key = (visit_id, flag)
            if key in _exception_alerts_sent:
                continue
            _exception_alerts_sent.add(key)
        label = _EXCEPTION_LABELS[flag]
        sms_body = f"EVV Alert [{label}]: {visit.get('caregiver_name','?')} / {visit.get('client_name','?')}"
        if _smtp_configured():
            ok, err = _send_exception_alert_email(visit, flag)
            if not ok:
                logger.warning(f"[ALERT] Exception email failed for visit {visit_id} flag={flag}: {err}")
            else:
                logger.info(f"[ALERT] Exception email sent: visit {visit_id} flag={flag}")
        else:
            logger.info(f"[ALERT] {flag} — {visit.get('client_name','?')} ({visit.get('caregiver_name','?')}) — SMTP not configured, logged only")
        if _sms_configured():
            ok, err = _send_sms(sms_body)
            if not ok:
                logger.warning(f"[ALERT] SMS failed for visit {visit_id} flag={flag}: {err}")
            else:
                logger.info(f"[ALERT] SMS sent: visit {visit_id} flag={flag}")


def _alert_watcher():
    """Background thread: checks for overdue visits every ALERT_CHECK_INTERVAL seconds."""
    while True:
        time.sleep(ALERT_CHECK_INTERVAL)
        try:
            _check_and_send_alerts()
        except Exception as e:
            logger.error(f"[ALERT] Watcher error: {e}", exc_info=True)


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
    rows = conn.execute(
        """
        SELECT u.name as caregiver_name,
               vv.check_in_time, vv.check_out_time, vv.exception_flags
        FROM visits v
        JOIN users u ON u.id = v.caregiver_id
        LEFT JOIN visit_verifications vv ON vv.visit_id = v.id
        WHERE v.agency_id = ? AND v.status = 'completed'
          AND date(v.scheduled_start) >= date(?)
          AND date(v.scheduled_start) <= date(?)
        ORDER BY u.name, v.scheduled_start
    """,
        (agency_id, monday.isoformat(), sunday.isoformat()),
    ).fetchall()

    summary: dict = {}
    for r in rows:
        name = r["caregiver_name"]
        if name not in summary:
            summary[name] = {
                "caregiver_name": name,
                "visit_count": 0,
                "total_hours": 0.0,
                "flag_set": set(),
            }
        summary[name]["visit_count"] += 1
        if r["check_in_time"] and r["check_out_time"]:
            delta = datetime.fromisoformat(
                r["check_out_time"]
            ) - datetime.fromisoformat(r["check_in_time"])
            summary[name]["total_hours"] += delta.total_seconds() / 3600
        if r["exception_flags"]:
            for f in r["exception_flags"].split(","):
                f = f.strip()
                if f:
                    summary[name]["flag_set"].add(f)

    result = []
    for s in summary.values():
        result.append(
            {
                "caregiver_name": s["caregiver_name"],
                "visit_count": s["visit_count"],
                "total_hours": round(s["total_hours"], 2),
                "flags": sorted(s["flag_set"]),
            }
        )
    return result


def _send_weekly_payroll_email(
    summary_rows: list, week_start: str, week_end: str
) -> tuple:
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
            f"{f.replace('_', ' ')}</span>"
            for f in r["flags"]
        )
        rows_html += (
            f"<tr>"
            f'<td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-weight:500;color:#111827">{r["caregiver_name"]}</td>'
            f'<td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:center;color:#374151">{r["visit_count"]}</td>'
            f'<td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:center;color:#374151">{r["total_hours"]:.2f}</td>'
            f'<td style="padding:8px 12px;border-bottom:1px solid #f1f5f9">'
            f"{flag_html if flag_html else "<span style='color:#9ca3af'>—</span>"}"
            f"</td></tr>"
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
    <p style="margin:0;font-size:12px;color:#9ca3af">Generated by Visiting Systems · {now_str}</p>
  </div>
</div>
</body></html>"""

    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"Visiting Systems Weekly Payroll — Week of {week_start}"
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
            ok, err = _send_weekly_payroll_email(
                rows, monday.isoformat(), sunday.isoformat()
            )
            with _weekly_email_lock:
                _weekly_email_state["last_sent_week"] = week_key
                _weekly_email_state["last_sent_at"] = now.isoformat(timespec="seconds")
            logger.info(f"[PAYROLL] Weekly email sent") if ok else logger.error(
                f"[PAYROLL] Weekly email FAILED: {err}"
            )
        except Exception as e:
            logger.error(f"[PAYROLL] Watcher error: {e}", exc_info=True)


# ---------- HTTP Handler ----------


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, data, status=200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        return json.loads(self.rfile.read(length))

    def do_OPTIONS(self):
        self._send_json({})

    def _proxy_billing(self, body: bytes = b""):
        import http.client
        billing_port = int(os.environ.get("BILLING_PORT", "8081"))
        conn = http.client.HTTPConnection("localhost", billing_port, timeout=30)
        headers = {}
        for h in ["Content-Type", "Authorization", "Stripe-Signature"]:
            val = self.headers.get(h)
            if val:
                headers[h] = val
        if body:
            headers["Content-Length"] = str(len(body))
        try:
            conn.request(self.command, self.path, body=body or None, headers=headers)
            resp = conn.getresponse()
            resp_body = resp.read()
            self.send_response(resp.status)
            for header, value in resp.getheaders():
                if header.lower() not in ("transfer-encoding", "connection"):
                    self.send_header(header, value)
            self.end_headers()
            self.wfile.write(resp_body)
        except Exception as exc:
            logger.error(f"[BILLING PROXY] {exc}")
            self._send_json({"error": "Billing service unavailable"}, 502)
        finally:
            conn.close()

    def _serve_static(self, path):
        if path == "/":
            path = "/index.html"
        full_path = os.path.normpath(os.path.join(FRONTEND_DIR, path.lstrip("/")))
        if not full_path.startswith(os.path.normpath(FRONTEND_DIR)):
            self.send_error(403)
            return
        if not os.path.isfile(full_path):
            full_path = os.path.join(FRONTEND_DIR, "index.html")
            return
        ext = os.path.splitext(full_path)[1]
        content_types = {
            ".html": "text/html",
            ".js": "application/javascript",
            ".css": "text/css",
            ".json": "application/json",
        }
        ctype = content_types.get(ext, "application/octet-stream")
        with open(full_path, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        if full_path.endswith("index.html"):
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
        elif ext in (".js", ".css") and ("-" in os.path.basename(full_path)):
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
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
        if path.startswith("/api/caregivers/"):
            try:
                cg_id = int(path.split("/")[3])
                return self.handle_get_caregiver(cg_id)
            except (IndexError, ValueError):
                return self._send_json({"error": "not found"}, 404)
        if path == "/api/exceptions":
            return self.handle_get_exceptions()
        if path == "/api/exceptions/acknowledge":
            return self.handle_acknowledge_exception(body)   
        if path == "/api/payroll/export":
            return self.handle_payroll_export(qs)
        if path == "/api/payroll/summary":
            return self.handle_payroll_summary()
        if path == "/api/alerts/status":
            return self.handle_get_alert_status()
        if path == "/api/config":
            return self.handle_get_config()
        if path == "/api/admin/pending":
            return self.handle_get_pending()
        if path == "/api/admin/unbilled-visits":
            return self.handle_get_unbilled_visits()
        if path == "/api/admin/invoices/export":
            return self.handle_export_paid_invoices(qs)
        if path == "/api/admin/invoices":
            return self.handle_get_invoices()
        if path.startswith("/api/admin/invoices/"):
            try:
                inv_id = int(path.split("/")[4])
                return self.handle_get_invoice(inv_id)
            except (IndexError, ValueError):
                return self._send_json({"error": "not found"}, 404)
        if path == "/api/admin/users":
            return self.handle_get_users()
        if path == "/api/audit-log":
            return self.handle_get_audit_log()
        if path.startswith("/api/billing/") or path.startswith("/api/stripe/"):
            return self._proxy_billing()
        if path.startswith("/api/"):
            return self._send_json({"error": "not found"}, 404)

        return self._serve_static(path)

    def do_PATCH(self):
        parsed = urlparse(self.path)
        path   = parsed.path
        body   = self._read_json()
        if path.startswith("/api/caregivers/"):
            try:
                cg_id = int(path.split("/")[3])
                return self.handle_update_caregiver(cg_id, body)
            except (IndexError, ValueError):
                return self._send_json({"error": "not found"}, 404)
        if path.startswith("/api/admin/users/"):
            try:
                uid = int(path.split("/")[4])
                return self.handle_update_user_role(uid, body)
            except (IndexError, ValueError):
                return self._send_json({"error": "not found"}, 404)
        return self._send_json({"error": "not found"}, 404)

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        # Proxy billing/stripe requests before reading body (webhook needs raw bytes)
        if path.startswith("/api/billing/") or path.startswith("/api/stripe/"):
            content_length = int(self.headers.get("Content-Length", 0))
            raw_body = self.rfile.read(content_length) if content_length > 0 else b""
            return self._proxy_billing(raw_body)

        body = self._read_json()

        if path == "/api/login":
            return self.handle_login(body)
        if path == "/api/signup":
            return self.handle_signup(body)
        if path == "/api/admin/approve":
            return self.handle_approve_user(body)
        if path == "/api/admin/reject":
            return self.handle_reject_user(body)
        if path.startswith("/api/visits/") and path.endswith("/checkin"):
            visit_id = int(path.split("/")[3])
            return self.handle_checkin(visit_id, body)
        if path.startswith("/api/visits/") and path.endswith("/checkout"):
            visit_id = int(path.split("/")[3])
            return self.handle_checkout(visit_id, body)
        if path.startswith("/api/visits/") and path.endswith("/notes"):
            visit_id = int(path.split("/")[3])
            return self.handle_add_note(visit_id, body)
        if path == "/api/visits":
            return self.handle_create_visit(body)
        if path == "/api/clients":
            return self.handle_create_client(body)
        if path == "/api/caregivers":
            return self.handle_create_caregiver(body)
        if path == "/api/config":
            return self.handle_update_config(body)
        if path == "/api/alerts/test":
            return self.handle_alert_test(body)
        if path == "/api/alerts/dismiss":
            return self.handle_alert_dismiss(body)
        if path == "/api/payroll/email-now":
            return self.handle_payroll_email_now()
        if path.startswith("/api/visits/") and path.endswith("/reassign"):
            try:
                visit_id = int(path.split("/")[3])
                return self.handle_reassign_visit(visit_id, body)
            except (IndexError, ValueError):
                return self._send_json({"error": "not found"}, 404)
        if path.startswith("/api/visits/") and path.endswith("/decline"):
            try:
                visit_id = int(path.split("/")[3])
                return self.handle_decline_visit(visit_id, body)
            except (IndexError, ValueError):
                return self._send_json({"error": "not found"}, 404)
        if path == "/api/admin/invoices":
            return self.handle_create_invoice(body)
        if path.startswith("/api/admin/invoices/") and path.endswith("/status"):
            try:
                inv_id = int(path.split("/")[4])
                return self.handle_update_invoice_status(inv_id, body)
            except (IndexError, ValueError):
                return self._send_json({"error": "not found"}, 404)
        if path.startswith("/api/admin/invoices/") and path.endswith("/email"):
            try:
                inv_id = int(path.split("/")[4])
                return self.handle_email_invoice(inv_id, body)
            except (IndexError, ValueError):
                return self._send_json({"error": "not found"}, 404)

        return self._send_json({"error": "not found"}, 404)

    # ---------- Config handlers ----------

    def handle_get_config(self):
        user = authenticate(self.headers)
        if not user or user["role"] != "admin":
            return self._send_json({"error": "unauthorized"}, 401)
        cfg = get_all_config()
        cfg["smtp_configured"] = _smtp_configured()
        cfg["smtp_host_display"] = (SMTP_HOST[:4] + "***") if SMTP_HOST else ""
        sup = get_config_val("supervisor_email_override") or SUPERVISOR_EMAIL
        cfg["supervisor_email_display"] = sup[:2] + "***@" + sup.split("@")[1] if "@" in sup else sup
        cfg["security_token_ttl_hours"] = str(TOKEN_TTL_SECONDS // 3600)
        cfg["security_max_login_failures"] = str(_MAX_LOGIN_FAILURES)
        cfg["security_lockout_minutes"] = str(_LOCKOUT_SECONDS // 60)
        cfg["security_session_window_minutes"] = str(_LOGIN_WINDOW_SECONDS // 60)
        return self._send_json(cfg)

    def handle_update_config(self, body):
        user = authenticate(self.headers)
        if not user or user["role"] != "admin":
            return self._send_json({"error": "unauthorized"}, 401)
        updates = {k: v for k, v in body.items() if k in CONFIG_DEFAULTS}
        if not updates:
            return self._send_json({"error": "no valid fields"}, 400)
        # Validate numeric fields
        numeric_fields = {"late_start_minutes", "short_visit_minutes", "location_mismatch_km", "alert_check_interval"}
        for k in numeric_fields:
            if k in updates:
                try:
                    val = float(updates[k])
                    if val < 0:
                        return self._send_json({"error": f"{k} must be non-negative"}, 400)
                except (ValueError, TypeError):
                    return self._send_json({"error": f"{k} must be a number"}, 400)
        set_config_values(updates)
        return self._send_json({"ok": True})

    # ---------- Alert handlers ----------

    def handle_get_alert_status(self):
        user = authenticate(self.headers)
        if not user or user["role"] != "admin":
            return self._send_json({"error": "unauthorized"}, 401)

        masked_email = ""
        if SUPERVISOR_EMAIL:
            parts = SUPERVISOR_EMAIL.split("@")
            masked_email = (
                parts[0][:2] + "***@" + parts[1] if len(parts) == 2 else "***"
            )

        with _alerts_lock:
            alerts_list = sorted(
                _sent_alerts.values(), key=lambda a: a["sent_at"], reverse=True
            )

        return self._send_json(
            {
                "configured": _smtp_configured(),
                "supervisor_email_masked": masked_email,
                "smtp_host": SMTP_HOST or "",
                "alerts": alerts_list,
            }
        )

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
            "scheduled_start": datetime.now()
            .replace(hour=9, minute=0, second=0)
            .isoformat(),
            "scheduled_end": datetime.now()
            .replace(hour=10, minute=0, second=0)
            .isoformat(),
        }
        ok, err = _send_alert_email(test_visit, "missed_checkin", to_address=to)
        if ok:
            return self._send_json({"ok": True, "message": f"Test alert sent to {to}"})
        return self._send_json(
            {"ok": False, "error": err or "Failed to send test email"}, 500
        )

    def handle_alert_dismiss(self, body):
        user = authenticate(self.headers)
        if not user or user["role"] != "admin":
            return self._send_json({"error": "unauthorized"}, 401)
        visit_id = body.get("visit_id")
        if visit_id is None:
            return self._send_json({"error": "visit_id required"}, 400)
        with _alerts_lock:
            alert = _sent_alerts.pop(visit_id, None)
            alert_type = alert.get("type") if alert else None
        try:
            conn = db()
            conn.execute(
                "INSERT INTO alert_dismissals (visit_id, alert_type, admin_id, admin_name, dismissed_at) VALUES (?, ?, ?, ?, datetime('now'))",
                (visit_id, alert_type, user["id"], user["name"])
            )
            conn.commit()
            conn.close()
        except Exception:
            pass
        log_audit(user["agency_id"], user["id"], user["name"], "alert_dismissed", f"visit_id={visit_id} type={alert_type}")
        return self._send_json({"ok": True})
        
    # ---------- Core handlers ----------

    def handle_login(self, body):
        ip = self.client_address[0]
        if not _check_rate_limit(ip):
            logger.warning(f"[AUTH] Blocked login attempt from {ip} — still locked out")
            return self._send_json(
                {"error": "Too many failed attempts. Try again later."}, 429
            )
        email = body.get("email", "")
        password = body.get("password", "")
        conn = db()
        user = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        if not user or not verify_pw(password, user["password_hash"]):
            conn.close()
            _record_failed_login(ip)
            logger.info(f"[AUTH] Failed login for '{email}' from {ip}")
            return self._send_json({"error": "invalid credentials"}, 401)
        if not user["approved"]:
            conn.close()
            logger.info(f"[AUTH] Login blocked for '{email}' — pending approval")
            return self._send_json(
                {"error": "pending_approval",
                 "message": "Your account is pending approval. An existing administrator must approve your agency before you can log in."},
                403,
            )
        _clear_login_attempts(ip)
        token = create_jwt({"uid": user["id"], "role": user["role"], "agency_id": user["agency_id"], "email": email})
        conn.close()
        logger.info(f"[AUTH] Login OK: {user['name']} ({user['role']}) from {ip}")
        return self._send_json(
            {
                "token": token,
                "user": {
                    "id": user["id"],
                    "name": user["name"],
                    "role": user["role"],
                    "agency_id": user["agency_id"],
                },
            }
        )

    def handle_signup(self, body):
        ip = self.client_address[0]
        if not _check_rate_limit(ip):
            return self._send_json({"error": "Too many attempts. Try again later."}, 429)

        agency_name = (body.get("agency_name") or "").strip()
        admin_name = (body.get("name") or "").strip()
        email = (body.get("email") or "").strip().lower()
        password = body.get("password") or ""
        timezone = (body.get("timezone") or "America/Chicago").strip()

        if not agency_name:
            return self._send_json({"error": "Agency name is required"}, 400)
        if not admin_name:
            return self._send_json({"error": "Your name is required"}, 400)
        if not _is_valid_email(email):
            return self._send_json({"error": "Invalid email address"}, 400)
        if len(password) < 8:
            return self._send_json({"error": "Password must be at least 8 characters"}, 400)
        if timezone not in _VALID_TIMEZONES:
            return self._send_json({"error": "Invalid timezone"}, 400)

        conn = db()
        existing = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
        if existing:
            conn.close()
            return self._send_json({"error": "An account with that email already exists"}, 409)

        try:
            conn.execute(
                "INSERT INTO agencies (name, timezone) VALUES (?, ?)",
                (agency_name, timezone),
            )
            agency_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
            pw_hash = hash_pw(password)
            conn.execute(
                "INSERT INTO users (agency_id, name, email, role, password_hash, approved) "
                "VALUES (?, ?, ?, 'admin', ?, 1)",
                (agency_id, admin_name, email, pw_hash),
            )
            user_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
            conn.commit()
            logger.info(f"[SIGNUP] New agency '{agency_name}' registered by {email} from {ip}")
        except Exception as exc:
            conn.close()
            logger.error(f"[SIGNUP] DB error for {email}: {exc}", exc_info=True)
            return self._send_json({"error": "Registration failed. Please try again."}, 500)

    def handle_get_audit_log(self):
        user = authenticate(self.headers)
        if not user or user["role"] != "admin":
            return self._send_json({"error": "forbidden"}, 403)
        conn = db()
        rows = conn.execute(
            """SELECT id, admin_name, action, details, created_at
               FROM audit_log WHERE agency_id = ?
               ORDER BY created_at DESC LIMIT 500""",
            (user["agency_id"],)
        ).fetchall()
        conn.close()
        return self._send_json({"log": [dict(r) for r in rows]})

    def handle_get_users(self):
        user = authenticate(self.headers)
        if not user or user["role"] != "admin":
            return self._send_json({"error": "unauthorized"}, 401)
        conn = db()
        rows = conn.execute(
            "SELECT id, name, email, role, approved FROM users WHERE agency_id = ? ORDER BY role, name",
            (user["agency_id"],)
        ).fetchall()
        conn.close()
        return self._send_json({"users": [dict(r) for r in rows]})

    def handle_update_user_role(self, uid, body):
        user = authenticate(self.headers)
        if not user or user["role"] != "admin":
            return self._send_json({"error": "unauthorized"}, 401)
        new_role = (body or {}).get("role")
        if new_role not in ("admin", "caregiver"):
            return self._send_json({"error": "invalid role"}, 400)
        if uid == user["id"]:
            return self._send_json({"error": "cannot change your own role"}, 400)
        conn = db()
        row = conn.execute(
            "SELECT id FROM users WHERE id = ? AND agency_id = ?",
            (uid, user["agency_id"])
        ).fetchone()
        if not row:
            conn.close()
            return self._send_json({"error": "user not found"}, 404)
        conn.execute("UPDATE users SET role = ? WHERE id = ?", (new_role, uid))
        conn.commit()
        conn.close()
        log_audit(user["agency_id"], user["id"], user["name"], "role_changed", f"user_id={uid} new_role={new_role}")
        return self._send_json({"ok": True})

    def handle_get_pending(self):
        user = authenticate(self.headers)
        if not user or user["role"] != "admin":
            return self._send_json({"error": "unauthorized"}, 401)
        conn = db()
        rows = conn.execute(
            "SELECT u.id, u.name, u.email, u.agency_id, a.name as agency_name, a.timezone "
            "FROM users u JOIN agencies a ON a.id = u.agency_id "
            "WHERE u.approved = 0 ORDER BY u.id ASC"
        ).fetchall()
        conn.close()
        return self._send_json([dict(r) for r in rows])

    def handle_approve_user(self, body):
        user = authenticate(self.headers)
        if not user or user["role"] != "admin":
            return self._send_json({"error": "unauthorized"}, 401)
        uid = body.get("user_id")
        if not uid:
            return self._send_json({"error": "user_id required"}, 400)
        conn = db()
        row = conn.execute("SELECT id FROM users WHERE id = ? AND approved = 0", (uid,)).fetchone()
        if not row:
            conn.close()
            return self._send_json({"error": "pending user not found"}, 404)
        conn.execute("UPDATE users SET approved = 1 WHERE id = ?", (uid,))
        conn.commit()
        conn.close()
        logger.info(f"[SIGNUP] User {uid} approved by admin {user['id']} ({user['email']})")
        return self._send_json({"ok": True})

    def handle_reject_user(self, body):
        user = authenticate(self.headers)
        if not user or user["role"] != "admin":
            return self._send_json({"error": "unauthorized"}, 401)
        uid = body.get("user_id")
        if not uid:
            return self._send_json({"error": "user_id required"}, 400)
        conn = db()
        row = conn.execute(
            "SELECT u.id, u.agency_id FROM users u WHERE u.id = ? AND u.approved = 0", (uid,)
        ).fetchone()
        if not row:
            conn.close()
            return self._send_json({"error": "pending user not found"}, 404)
        agency_id = row["agency_id"]
        conn.execute("DELETE FROM users WHERE id = ?", (uid,))
        remaining = conn.execute("SELECT COUNT(*) FROM users WHERE agency_id = ?", (agency_id,)).fetchone()[0]
        if remaining == 0:
            conn.execute("DELETE FROM agencies WHERE id = ?", (agency_id,))
        conn.commit()
        conn.close()
        logger.info(f"[SIGNUP] User {uid} rejected by admin {user['id']} ({user['email']})")
        return self._send_json({"ok": True})

    def handle_get_visits(self, qs):
        user = authenticate(self.headers)
        if not user:
            return self._send_json({"error": "unauthorized"}, 401)
        conn = db()
        query = """
            SELECT v.*, c.name as client_name, c.address as client_address,
                   u.name as caregiver_name,
                   vv.check_in_time, vv.check_out_time, vv.exception_flags, vv.notes,
                   vv.reassigned_from, vv.decline_reason
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
        if "date_from" in qs:
            query += " AND date(v.scheduled_start) >= ?"
            params.append(qs["date_from"][0])
        if "date_to" in qs:
            query += " AND date(v.scheduled_start) <= ?"
            params.append(qs["date_to"][0])
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
        rows = conn.execute(
            "SELECT * FROM clients WHERE agency_id = ?", (user["agency_id"],)
        ).fetchall()
        conn.close()
        return self._send_json({"clients": [dict(r) for r in rows]})

    def handle_get_caregivers(self):
        user = authenticate(self.headers)
        if not user:
            return self._send_json({"error": "unauthorized"}, 401)
        conn = db()
        rows = conn.execute(
            "SELECT id, name, email, employee_id, COALESCE(timezone, 'America/Chicago') as timezone "
            "FROM users WHERE agency_id = ? AND role = 'caregiver' ORDER BY name",
            (user["agency_id"],),
        ).fetchall()
        conn.close()
        return self._send_json({"caregivers": [dict(r) for r in rows]})

    def handle_get_caregiver(self, cg_id):
        user = authenticate(self.headers)
        if not user:
            return self._send_json({"error": "unauthorized"}, 401)
        conn = db()
        row = conn.execute(
            "SELECT id, name, email, employee_id, COALESCE(timezone, 'America/Chicago') as timezone "
            "FROM users WHERE id = ? AND agency_id = ? AND role = 'caregiver'",
            (cg_id, user["agency_id"]),
        ).fetchone()
        conn.close()
        if not row:
            return self._send_json({"error": "not found"}, 404)
        return self._send_json({"caregiver": dict(row)})

    def handle_update_caregiver(self, cg_id, body):
        user = authenticate(self.headers)
        if not user or user["role"] != "admin":
            return self._send_json({"error": "unauthorized"}, 401)
        conn = db()
        existing = conn.execute(
            "SELECT id FROM users WHERE id = ? AND agency_id = ? AND role = 'caregiver'",
            (cg_id, user["agency_id"]),
        ).fetchone()
        if not existing:
            conn.close()
            return self._send_json({"error": "not found"}, 404)

        updates = {}

        employee_id = (body.get("employee_id") or "").strip()
        if employee_id:
            conflict = conn.execute(
                "SELECT id FROM users WHERE agency_id = ? AND employee_id = ? AND id != ?",
                (user["agency_id"], employee_id, cg_id),
            ).fetchone()
            if conflict:
                conn.close()
                return self._send_json({"error": "That Employee ID is already in use"}, 409)
            updates["employee_id"] = employee_id
        elif "employee_id" in body:
            conn.close()
            return self._send_json({"error": "employee_id cannot be empty"}, 400)

        if "timezone" in body:
            tz = (body["timezone"] or "").strip()
            if tz and tz not in _VALID_TIMEZONES:
                conn.close()
                return self._send_json({"error": "Invalid timezone"}, 400)
            if tz:
                updates["timezone"] = tz

        if "name" in body and body["name"].strip():
            updates["name"] = body["name"].strip()
        if "email" in body and body["email"].strip():
            updates["email"] = body["email"].strip()

        if not updates:
            conn.close()
            return self._send_json({"error": "No valid fields to update"}, 400)

        set_clause = ", ".join(f"{k} = ?" for k in updates)
        conn.execute(
            f"UPDATE users SET {set_clause} WHERE id = ?",
            list(updates.values()) + [cg_id],
        )
        conn.commit()
        conn.close()
        return self._send_json({"ok": True})

    def handle_get_exceptions(self):
        user = authenticate(self.headers)
        if not user or user["role"] != "admin":
            return self._send_json({"error": "unauthorized"}, 401)
        conn = db()
        rows = conn.execute(
            """
            SELECT v.*, c.name as client_name, u.name as caregiver_name,
                   vv.exception_flags, vv.reassigned_from, vv.decline_reason
            FROM visits v
            JOIN clients c ON c.id = v.client_id
            JOIN users u ON u.id = v.caregiver_id
            LEFT JOIN visit_verifications vv ON vv.visit_id = v.id
            WHERE v.agency_id = ? AND (v.exception_acknowledged IS NULL OR v.exception_acknowledged = 0) AND (
                (vv.exception_flags IS NOT NULL AND vv.exception_flags != '')
                OR v.status = 'declined'
            )
        """,
            (user["agency_id"],),
        ).fetchall()
        conn.close()
        return self._send_json({"exceptions": [dict(r) for r in rows]})

    def handle_acknowledge_exception(self, body):
        user = authenticate(self.headers)
        if not user or user["role"] != "admin":
            return self._send_json({"error": "unauthorized"}, 401)
        visit_id = body.get("visit_id")
        if visit_id is None:
            return self._send_json({"error": "visit_id required"}, 400)
        conn = db()
        conn.execute(
            "UPDATE visits SET exception_acknowledged = 1 WHERE id = ? AND agency_id = ?",
            (visit_id, user["agency_id"])
        )
        conn.commit()
        conn.close()
        return self._send_json({"ok": True})
        
    def handle_create_visit(self, body):
        user = authenticate(self.headers)
        if not user or user["role"] != "admin":
            return self._send_json({"error": "unauthorized"}, 401)
        recurrence_rule = body.get("recurrence_rule", "none")
        occurrences = int(body.get("occurrences", 1))
        if recurrence_rule not in ("none", "daily", "weekly", "biweekly", "monthly"):
            recurrence_rule = "none"
        occurrences = max(1, min(occurrences, 52))

        # Day-targeting params (0=Mon … 6=Sun, matching Python weekday())
        days_of_week  = [int(d) for d in body.get("days_of_week", [])]   # daily multi-day
        day_of_week   = body.get("day_of_week")                           # weekly/biweekly/monthly
        if day_of_week is not None:
            day_of_week = int(day_of_week)
        week_of_month = body.get("week_of_month")                         # monthly: 1-4
        if week_of_month is not None:
            week_of_month = int(week_of_month)

        start_dt = datetime.fromisoformat(body["scheduled_start"])
        end_dt   = datetime.fromisoformat(body["scheduled_end"])
        duration = end_dt - start_dt
        count    = occurrences if recurrence_rule != "none" else 1

        # Build the list of (start, end) datetimes to insert
        visit_times: list[tuple] = []

        if recurrence_rule == "none":
            visit_times = [(start_dt, end_dt)]

        elif recurrence_rule == "daily":
            if days_of_week:
                current = start_dt
                safety  = start_dt + timedelta(days=400)
                while len(visit_times) < count and current < safety:
                    if current.weekday() in days_of_week:
                        visit_times.append((current, current + duration))
                    current += timedelta(days=1)
            else:
                for i in range(count):
                    s = start_dt + timedelta(days=i)
                    visit_times.append((s, s + duration))

        elif recurrence_rule in ("weekly", "biweekly"):
            interval = timedelta(weeks=1) if recurrence_rule == "weekly" else timedelta(weeks=2)
            # Support both multi-day array (days_of_week) and legacy single day (day_of_week)
            target_days = days_of_week if days_of_week else ([day_of_week] if day_of_week is not None else [])
            if target_days:
                # Find the first occurrence of each target day on/after start_dt
                anchors = sorted(
                    start_dt + timedelta(days=(d - start_dt.weekday()) % 7)
                    for d in target_days
                )
                all_times = []
                cycle = 0
                while len(all_times) < count:
                    for anchor in anchors:
                        s = anchor + interval * cycle
                        all_times.append((s, s + duration))
                    cycle += 1
                    if cycle > count + 10:
                        break
                all_times.sort(key=lambda x: x[0])
                visit_times = all_times[:count]
            else:
                for i in range(count):
                    s = start_dt + interval * i
                    visit_times.append((s, s + duration))

        elif recurrence_rule == "monthly":
            # Support multi-day array (days_of_week) and legacy single day (day_of_week)
            target_days = days_of_week if days_of_week else ([day_of_week] if day_of_week is not None else [])
            if target_days and week_of_month is not None:
                year, month = start_dt.year, start_dt.month
                all_times = []
                attempts  = 0
                while len(all_times) < count and attempts < count + 48:
                    for d in sorted(target_days):
                        fom = datetime(year, month, 1, start_dt.hour, start_dt.minute, start_dt.second)
                        days_ahead = (d - fom.weekday()) % 7
                        candidate  = fom + timedelta(days=days_ahead) + timedelta(weeks=week_of_month - 1)
                        if candidate.month == month and candidate >= start_dt - timedelta(days=1):
                            all_times.append((candidate, candidate + duration))
                    month += 1
                    if month > 12:
                        month = 1
                        year  += 1
                    attempts += 1
                all_times.sort(key=lambda x: x[0])
                visit_times = all_times[:count]
            else:
                for i in range(count):
                    s = start_dt + timedelta(days=28 * i)
                    visit_times.append((s, s + duration))

        group_id = secrets.token_hex(8) if len(visit_times) > 1 else None
        conn = db()
        first_id = None
        for s, e in visit_times:
            cur = conn.execute(
                "INSERT INTO visits (agency_id, client_id, caregiver_id, scheduled_start, scheduled_end, status, recurrence_rule, recurrence_group_id) "
                "VALUES (?,?,?,?,?,'scheduled',?,?)",
                (user["agency_id"], body["client_id"], body["caregiver_id"],
                 s.isoformat(timespec="seconds"), e.isoformat(timespec="seconds"),
                 recurrence_rule, group_id),
            )
            vid = cur.lastrowid
            if first_id is None:
                first_id = vid
            conn.execute("INSERT INTO visit_verifications (visit_id) VALUES (?)", (vid,))
        conn.commit()
        conn.close()
        return self._send_json({"id": first_id, "count": len(visit_times)}, 201)

    def handle_checkin(self, visit_id, body):
        user = authenticate(self.headers)
        if not user:
            return self._send_json({"error": "unauthorized"}, 401)
        conn = db()
        now = datetime.now().isoformat(timespec="seconds")
        conn.execute(
            "UPDATE visit_verifications SET check_in_time=?, check_in_lat=?, check_in_lng=? WHERE visit_id=?",
            (now, body.get("lat"), body.get("lng"), visit_id),
        )
        conn.execute("UPDATE visits SET status='in_progress' WHERE id=?", (visit_id,))
        self._recompute_flags(conn, visit_id)
        conn.commit()
        # Grab flags + visit info for exception alert firing
        vv = conn.execute("SELECT exception_flags FROM visit_verifications WHERE visit_id=?", (visit_id,)).fetchone()
        visit_info = conn.execute(
            "SELECT v.scheduled_start, v.scheduled_end, c.name as client_name, u.name as caregiver_name "
            "FROM visits v JOIN clients c ON c.id=v.client_id JOIN users u ON u.id=v.caregiver_id WHERE v.id=?",
            (visit_id,)
        ).fetchone()
        conn.close()
        # Clear any missed_checkin alert for this visit since they checked in
        with _alerts_lock:
            if visit_id in _sent_alerts and _sent_alerts[visit_id]["type"] == "missed_checkin":
                _sent_alerts.pop(visit_id)
        # Fire late_start alert if detected
        if vv and vv["exception_flags"] and visit_info:
            flags = [f.strip() for f in vv["exception_flags"].split(",") if f.strip()]
            late_flags = [f for f in flags if f == "late_start"]
            if late_flags:
                threading.Thread(target=_fire_exception_alerts, args=(visit_id, late_flags, dict(visit_info)), daemon=True).start()
        return self._send_json({"ok": True, "check_in_time": now})

    def handle_checkout(self, visit_id, body):
        user = authenticate(self.headers)
        if not user:
            return self._send_json({"error": "unauthorized"}, 401)
        conn = db()
        now = datetime.now().isoformat(timespec="seconds")
        notes = (body.get("notes") or "").strip() or None
        signature_data = body.get("signature_data") or None
        signature_reason_code = (body.get("signature_reason_code") or "").strip() or None
        conn.execute(
            "UPDATE visit_verifications SET check_out_time=?, check_out_lat=?, check_out_lng=?, notes=?, "
            "signature_data=?, signature_reason_code=? WHERE visit_id=?",
            (now, body.get("lat"), body.get("lng"), notes, signature_data, signature_reason_code, visit_id),
        )
        conn.execute("UPDATE visits SET status='completed' WHERE id=?", (visit_id,))
        self._recompute_flags(conn, visit_id)
        conn.commit()
        # Grab flags + visit info for exception alert firing
        vv = conn.execute("SELECT exception_flags FROM visit_verifications WHERE visit_id=?", (visit_id,)).fetchone()
        visit_info = conn.execute(
            "SELECT v.scheduled_start, v.scheduled_end, c.name as client_name, u.name as caregiver_name "
            "FROM visits v JOIN clients c ON c.id=v.client_id JOIN users u ON u.id=v.caregiver_id WHERE v.id=?",
            (visit_id,)
        ).fetchone()
        conn.close()
        # Clear overdue_checkout alert
        with _alerts_lock:
            _sent_alerts.pop(visit_id, None)
        # Fire exception alerts for short_visit / location_mismatch detected at checkout
        if vv and vv["exception_flags"] and visit_info:
            flags = [f.strip() for f in vv["exception_flags"].split(",") if f.strip()]
            checkout_flags = [f for f in flags if f in ("short_visit", "location_mismatch")]
            if checkout_flags:
                threading.Thread(target=_fire_exception_alerts, args=(visit_id, checkout_flags, dict(visit_info)), daemon=True).start()
        return self._send_json({"ok": True, "check_out_time": now})

    def handle_add_note(self, visit_id, body):
        user = authenticate(self.headers)
        if not user:
            return self._send_json({"error": "unauthorized"}, 401)
        notes = (body.get("notes") or "").strip()
        if not notes:
            return self._send_json({"error": "notes cannot be empty"}, 400)
        conn = db()
        row = conn.execute(
            "SELECT v.agency_id, v.caregiver_id, vv.notes FROM visits v "
            "LEFT JOIN visit_verifications vv ON vv.visit_id = v.id WHERE v.id = ?",
            (visit_id,),
        ).fetchone()
        if not row or row["agency_id"] != user["agency_id"]:
            conn.close()
            return self._send_json({"error": "not found"}, 404)
        if user["role"] == "caregiver" and row["caregiver_id"] != user["id"]:
            conn.close()
            return self._send_json({"error": "forbidden"}, 403)
        if row["notes"]:
            conn.close()
            return self._send_json({"error": "notes are read-only once saved"}, 409)
        conn.execute(
            "UPDATE visit_verifications SET notes=? WHERE visit_id=?", (notes, visit_id)
        )
        conn.commit()
        conn.close()
        return self._send_json({"ok": True})

    def handle_create_client(self, body):
        user = authenticate(self.headers)
        if not user or user["role"] != "admin":
            return self._send_json({"error": "unauthorized"}, 401)
        if not body.get("name"):
            return self._send_json({"error": "name is required"}, 400)
        conn = db()
        cur = conn.execute(
            "INSERT INTO clients (agency_id, name, address, lat, lng, payer_type, notes) VALUES (?,?,?,?,?,?,?)",
            (
                user["agency_id"],
                body["name"],
                body.get("address"),
                body.get("lat"),
                body.get("lng"),
                body.get("payer_type", "private_pay"),
                body.get("notes"),
            ),
        )
        client_id = cur.lastrowid
        conn.commit()
        conn.close()
        log_audit(user["agency_id"], user["id"], user["name"], "client_created", f"client_id={client_id} name={body['name']}")
        return self._send_json({"id": client_id}, 201)

    def handle_create_caregiver(self, body):
        user = authenticate(self.headers)
        if not user or user["role"] != "admin":
            return self._send_json({"error": "unauthorized"}, 401)
        name = body.get("name")
        email = body.get("email")
        password = body.get("password")
        if not all([name, email, password]):
            return self._send_json(
                {"error": "name, email, and password are required"}, 400
            )
        conn = db()
        # Resolve employee_id: use provided value or auto-generate
        employee_id = (body.get("employee_id") or "").strip()
        if employee_id:
            conflict = conn.execute(
                "SELECT id FROM users WHERE agency_id = ? AND employee_id = ?",
                (user["agency_id"], employee_id),
            ).fetchone()
            if conflict:
                conn.close()
                return self._send_json({"error": "That Employee ID is already in use"}, 409)
        else:
            # Auto-generate: find the highest numeric suffix in use and increment
            existing = conn.execute(
                "SELECT employee_id FROM users WHERE agency_id = ? AND employee_id IS NOT NULL",
                (user["agency_id"],),
            ).fetchall()
            max_num = 0
            for row in existing:
                eid = row["employee_id"] or ""
                if eid.startswith("EMP-"):
                    try:
                        max_num = max(max_num, int(eid[4:]))
                    except ValueError:
                        pass
            employee_id = f"EMP-{(max_num + 1):04d}"
        timezone = (body.get("timezone") or "America/Chicago").strip()
        if timezone not in _VALID_TIMEZONES:
            timezone = "America/Chicago"
        try:
            cur = conn.execute(
                "INSERT INTO users (agency_id, name, email, role, password_hash, employee_id, timezone) VALUES (?,?,?,'caregiver',?,?,?)",
                (user["agency_id"], name, email, hash_pw(password), employee_id, timezone),
            )
        except sqlite3.IntegrityError:
            conn.close()
            return self._send_json(
                {"error": "a user with that email already exists"}, 400
            )
        caregiver_id = cur.lastrowid
        conn.commit()
        conn.close()
        log_audit(user["agency_id"], user["id"], user["name"], "caregiver_created", f"caregiver_id={caregiver_id} name={name} email={email}")
        return self._send_json({"id": caregiver_id, "employee_id": employee_id}, 201)

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
        return self._send_json(
            {
                "week_start": monday.isoformat(),
                "week_end": sunday.isoformat(),
                "rows": rows,
                "smtp_configured": _smtp_configured(),
                "supervisor_email": SUPERVISOR_EMAIL,
                "last_sent_at": last_sent,
                "next_scheduled": f"{next_monday.isoformat()}T08:00:00",
            }
        )

    def handle_payroll_email_now(self):
        user = authenticate(self.headers)
        if not user or user["role"] != "admin":
            return self._send_json({"error": "unauthorized"}, 401)
        conn = db()
        rows = _build_weekly_summary(user["agency_id"], conn)
        conn.close()
        monday, sunday = _last_week_range()
        ok, err = _send_weekly_payroll_email(
            rows, monday.isoformat(), sunday.isoformat()
        )
        if ok:
            with _weekly_email_lock:
                _weekly_email_state["last_sent_at"] = datetime.now().isoformat(
                    timespec="seconds"
                )
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
        writer.writerow(
            [
                "Caregiver",
                "Email",
                "Client",
                "Scheduled Start",
                "Scheduled End",
                "Check In",
                "Check Out",
                "Hours Worked",
            ]
        )
        for r in rows:
            hours = ""
            if r["check_in_time"] and r["check_out_time"]:
                delta = datetime.fromisoformat(
                    r["check_out_time"]
                ) - datetime.fromisoformat(r["check_in_time"])
                hours = f"{delta.total_seconds() / 3600:.2f}"
            writer.writerow(
                [
                    r["caregiver_name"],
                    r["caregiver_email"],
                    r["client_name"],
                    r["scheduled_start"],
                    r["scheduled_end"],
                    r["check_in_time"] or "",
                    r["check_out_time"] or "",
                    hours,
                ]
            )

        body = buf.getvalue().encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/csv")
        self.send_header(
            "Content-Disposition", 'attachment; filename="payroll_export.csv"'
        )
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    # ---------- Invoice handlers ----------

    def handle_get_unbilled_visits(self):
        user = authenticate(self.headers)
        if not user or user["role"] != "admin":
            return self._send_json({"error": "unauthorized"}, 401)
        conn = db()
        rows = conn.execute(
            """SELECT v.id, v.scheduled_start, v.scheduled_end,
                      vv.check_in_time, vv.check_out_time,
                      c.name as client_name, c.id as client_id,
                      u.name as caregiver_name
               FROM visits v
               JOIN clients c ON c.id = v.client_id
               JOIN users u ON u.id = v.caregiver_id
               LEFT JOIN visit_verifications vv ON vv.visit_id = v.id
               WHERE v.agency_id = ? AND v.status = 'completed'
                 AND v.id NOT IN (SELECT visit_id FROM invoice_items)
               ORDER BY v.scheduled_start DESC""",
            (user["agency_id"],)
        ).fetchall()
        conn.close()
        result = []
        for r in rows:
            if r["check_in_time"] and r["check_out_time"]:
                hrs = round((datetime.fromisoformat(r["check_out_time"]) - datetime.fromisoformat(r["check_in_time"])).total_seconds() / 3600, 2)
            else:
                hrs = round((datetime.fromisoformat(r["scheduled_end"]) - datetime.fromisoformat(r["scheduled_start"])).total_seconds() / 3600, 2)
            d = dict(r)
            d["hours"] = hrs
            result.append(d)
        return self._send_json({"visits": result})

    def handle_get_invoices(self):
        user = authenticate(self.headers)
        if not user or user["role"] != "admin":
            return self._send_json({"error": "unauthorized"}, 401)
        conn = db()
        rows = conn.execute(
            "SELECT i.*, c.name as client_name FROM invoices i "
            "JOIN clients c ON c.id = i.client_id "
            "WHERE i.agency_id = ? ORDER BY i.created_at DESC",
            (user["agency_id"],)
        ).fetchall()
        conn.close()
        return self._send_json({"invoices": [dict(r) for r in rows]})

    def handle_get_invoice(self, invoice_id):
        user = authenticate(self.headers)
        if not user or user["role"] != "admin":
            return self._send_json({"error": "unauthorized"}, 401)
        conn = db()
        inv = conn.execute(
            "SELECT i.*, c.name as client_name, c.address as client_address "
            "FROM invoices i JOIN clients c ON c.id = i.client_id "
            "WHERE i.id = ? AND i.agency_id = ?",
            (invoice_id, user["agency_id"])
        ).fetchone()
        if not inv:
            conn.close()
            return self._send_json({"error": "not found"}, 404)
        items = conn.execute(
            "SELECT ii.*, v.scheduled_start, v.scheduled_end, u.name as caregiver_name "
            "FROM invoice_items ii "
            "JOIN visits v ON v.id = ii.visit_id "
            "JOIN users u ON u.id = v.caregiver_id "
            "WHERE ii.invoice_id = ? ORDER BY v.scheduled_start",
            (invoice_id,)
        ).fetchall()
        agency = conn.execute("SELECT name FROM agencies WHERE id = ?", (user["agency_id"],)).fetchone()
        conn.close()
        return self._send_json({
            "invoice": dict(inv),
            "items": [dict(i) for i in items],
            "agency_name": agency["name"] if agency else "",
        })

    def handle_create_invoice(self, body):
        user = authenticate(self.headers)
        if not user or user["role"] != "admin":
            return self._send_json({"error": "unauthorized"}, 401)
        rate_per_hour = float(body.get("rate_per_hour", 25.0))
        visit_ids = body.get("visit_ids")  # optional: list of specific visit IDs
        conn = db()

        if visit_ids:
            # Invoice specific visits (single or batch)
            placeholders = ",".join("?" * len(visit_ids))
            rows = conn.execute(
                f"""SELECT v.id, v.scheduled_start, v.scheduled_end, v.client_id,
                          vv.check_in_time, vv.check_out_time
                   FROM visits v
                   LEFT JOIN visit_verifications vv ON vv.visit_id = v.id
                   WHERE v.id IN ({placeholders}) AND v.agency_id = ? AND v.status = 'completed'
                   ORDER BY v.scheduled_start""",
                visit_ids + [user["agency_id"]]
            ).fetchall()
            if not rows:
                conn.close()
                return self._send_json({"error": "No eligible visits found"}, 400)
            # Derive client/period from the visits themselves
            client_id = rows[0]["client_id"]
            period_start = rows[0]["scheduled_start"][:10]
            period_end   = rows[-1]["scheduled_start"][:10]
        else:
            client_id    = body.get("client_id")
            period_start = body.get("period_start")
            period_end   = body.get("period_end")
            if not all([client_id, period_start, period_end]):
                conn.close()
                return self._send_json({"error": "client_id, period_start, period_end required"}, 400)
            rows = conn.execute(
                """SELECT v.id, v.scheduled_start, v.scheduled_end, v.client_id,
                          vv.check_in_time, vv.check_out_time
                   FROM visits v
                   LEFT JOIN visit_verifications vv ON vv.visit_id = v.id
                   WHERE v.agency_id = ? AND v.client_id = ? AND v.status = 'completed'
                     AND date(v.scheduled_start) >= date(?) AND date(v.scheduled_start) <= date(?)
                   ORDER BY v.scheduled_start""",
                (user["agency_id"], client_id, period_start, period_end)
            ).fetchall()
            if not rows:
                conn.close()
                return self._send_json({"error": "No completed visits found for this client in the selected period"}, 400)

        # Check not already invoiced
        already = conn.execute(
            "SELECT id FROM invoice_items WHERE visit_id IN (%s)" % ",".join("?" * len(rows)),
            [r["id"] for r in rows]
        ).fetchone()
        if already:
            conn.close()
            return self._send_json({"error": "One or more visits are already on an invoice"}, 409)

        # Generate invoice number
        count = conn.execute("SELECT COUNT(*) FROM invoices WHERE agency_id = ?", (user["agency_id"],)).fetchone()[0]
        invoice_number = f"INV-{datetime.now().year}-{(count + 1):04d}"
        total_hours = 0.0
        for r in rows:
            if r["check_in_time"] and r["check_out_time"]:
                delta = (datetime.fromisoformat(r["check_out_time"]) - datetime.fromisoformat(r["check_in_time"])).total_seconds() / 3600
            else:
                delta = (datetime.fromisoformat(r["scheduled_end"]) - datetime.fromisoformat(r["scheduled_start"])).total_seconds() / 3600
            total_hours += delta
        total_amount = round(total_hours * rate_per_hour, 2)
        total_hours  = round(total_hours, 2)
        cur = conn.execute(
            "INSERT INTO invoices (agency_id, client_id, invoice_number, period_start, period_end, "
            "rate_per_hour, total_hours, total_amount, status, created_at) VALUES (?,?,?,?,?,?,?,?,'draft',?)",
            (user["agency_id"], client_id, invoice_number, period_start, period_end,
             rate_per_hour, total_hours, total_amount, datetime.now().isoformat(timespec="seconds"))
        )
        invoice_id = cur.lastrowid
        for r in rows:
            if r["check_in_time"] and r["check_out_time"]:
                hrs = round((datetime.fromisoformat(r["check_out_time"]) - datetime.fromisoformat(r["check_in_time"])).total_seconds() / 3600, 2)
            else:
                hrs = round((datetime.fromisoformat(r["scheduled_end"]) - datetime.fromisoformat(r["scheduled_start"])).total_seconds() / 3600, 2)
            conn.execute(
                "INSERT INTO invoice_items (invoice_id, visit_id, hours, amount) VALUES (?,?,?,?)",
                (invoice_id, r["id"], hrs, round(hrs * rate_per_hour, 2))
            )
        conn.commit()
        conn.close()
        return self._send_json({"id": invoice_id, "invoice_number": invoice_number, "total_amount": total_amount}, 201)

    def handle_update_invoice_status(self, invoice_id, body):
        user = authenticate(self.headers)
        if not user or user["role"] != "admin":
            return self._send_json({"error": "unauthorized"}, 401)
        status = body.get("status", "")
        if status not in ("draft", "sent", "paid"):
            return self._send_json({"error": "status must be draft, sent, or paid"}, 400)
        conn = db()
        if status == "paid":
            paid_at = datetime.now().isoformat(timespec="seconds")
            conn.execute(
                "UPDATE invoices SET status = ?, paid_at = ? WHERE id = ? AND agency_id = ?",
                (status, paid_at, invoice_id, user["agency_id"])
            )
        else:
            conn.execute(
                "UPDATE invoices SET status = ?, paid_at = NULL WHERE id = ? AND agency_id = ?",
                (status, invoice_id, user["agency_id"])
            )
        conn.commit()
        conn.close()
        return self._send_json({"ok": True})

    def handle_export_paid_invoices(self, qs):
        user = authenticate(self.headers)
        if not user or user["role"] != "admin":
            return self._send_json({"error": "unauthorized"}, 401)

        inv_filter = qs.get("filter", ["paid"])[0]   # all | paid | unpaid
        fmt        = qs.get("format", ["json"])[0]   # json | csv

        conn = db()
        if inv_filter == "paid":
            where = "i.agency_id = ? AND i.status = 'paid'"
        elif inv_filter == "unpaid":
            where = "i.agency_id = ? AND i.status != 'paid'"
        else:
            where = "i.agency_id = ?"

        rows = conn.execute(
            f"""SELECT i.invoice_number, c.name as client_name,
                      i.period_start, i.period_end,
                      i.total_hours, i.rate_per_hour, i.total_amount,
                      i.status, i.paid_at, i.created_at
               FROM invoices i
               JOIN clients c ON c.id = i.client_id
               WHERE {where}
               ORDER BY i.created_at DESC""",
            (user["agency_id"],)
        ).fetchall()
        conn.close()

        def fmt_date(iso):
            if not iso:
                return ""
            try:
                return datetime.fromisoformat(iso).strftime("%Y-%m-%d")
            except Exception:
                return iso

        if fmt == "json":
            return self._send_json({
                "rows": [
                    {
                        "invoice_number": r["invoice_number"],
                        "client_name":    r["client_name"],
                        "period_start":   fmt_date(r["period_start"]),
                        "period_end":     fmt_date(r["period_end"]),
                        "total_hours":    round(r["total_hours"], 2),
                        "rate_per_hour":  round(r["rate_per_hour"], 2),
                        "total_amount":   round(r["total_amount"], 2),
                        "status":         r["status"],
                        "invoice_date":   fmt_date(r["created_at"]),
                        "payment_date":   fmt_date(r["paid_at"]),
                    }
                    for r in rows
                ]
            })

        # CSV download
        filter_label = {"paid": "paid", "unpaid": "unpaid", "all": "all"}.get(inv_filter, "paid")
        filename = f"invoices_{filter_label}_{datetime.now().strftime('%Y-%m-%d')}.csv"
        lines = ["Invoice #,Client,Period Start,Period End,Hours,Rate/hr,Amount,Status,Invoice Date,Payment Date"]
        for r in rows:
            lines.append(
                f'"{r["invoice_number"]}","{r["client_name"]}",'
                f'"{fmt_date(r["period_start"])}","{fmt_date(r["period_end"])}",'
                f'"{r["total_hours"]:.2f}","{r["rate_per_hour"]:.2f}","{r["total_amount"]:.2f}",'
                f'"{r["status"]}","{fmt_date(r["created_at"])}","{fmt_date(r["paid_at"])}"'
            )
        csv_body = "\n".join(lines).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/csv; charset=utf-8")
        self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.send_header("Content-Length", str(len(csv_body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(csv_body)

    def handle_email_invoice(self, invoice_id, body):
        user = authenticate(self.headers)
        if not user or user["role"] != "admin":
            return self._send_json({"error": "unauthorized"}, 401)
        to_email = body.get("to_email", "").strip()
        if not to_email:
            return self._send_json({"error": "to_email is required"}, 400)
        if not all([SMTP_HOST, SMTP_USER, SMTP_PASS]):
            return self._send_json({"error": "SMTP not configured — set SMTP_HOST, SMTP_USER, SMTP_PASS"}, 503)
        conn = db()
        inv = conn.execute(
            "SELECT i.*, c.name as client_name FROM invoices i "
            "JOIN clients c ON c.id = i.client_id "
            "WHERE i.id = ? AND i.agency_id = ?",
            (invoice_id, user["agency_id"])
        ).fetchone()
        if not inv:
            conn.close()
            return self._send_json({"error": "not found"}, 404)
        items = conn.execute(
            "SELECT ii.*, v.scheduled_start, v.scheduled_end, u.name as caregiver_name "
            "FROM invoice_items ii "
            "JOIN visits v ON v.id = ii.visit_id "
            "JOIN users u ON u.id = v.caregiver_id "
            "WHERE ii.invoice_id = ? ORDER BY v.scheduled_start",
            (invoice_id,)
        ).fetchall()
        agency = conn.execute("SELECT name FROM agencies WHERE id = ?", (user["agency_id"],)).fetchone()
        conn.close()
        agency_name = agency["name"] if agency else ""
        inv = dict(inv)
        items = [dict(i) for i in items]

        def fmt(iso):
            try:
                return datetime.fromisoformat(iso).strftime("%b %d, %Y")
            except Exception:
                return iso
        def fmt_time(iso):
            try:
                return datetime.fromisoformat(iso).strftime("%I:%M %p")
            except Exception:
                return iso

        rows_html = ""
        for it in items:
            rows_html += (
                f"<tr>"
                f"<td style='padding:8px 12px;border-bottom:1px solid #f1f5f9;color:#374151'>{fmt(it['scheduled_start'])}</td>"
                f"<td style='padding:8px 12px;border-bottom:1px solid #f1f5f9;color:#6b7280'>{fmt_time(it['scheduled_start'])} – {fmt_time(it['scheduled_end'])}</td>"
                f"<td style='padding:8px 12px;border-bottom:1px solid #f1f5f9;color:#374151'>{it['caregiver_name']}</td>"
                f"<td style='padding:8px 12px;border-bottom:1px solid #f1f5f9;color:#374151;text-align:right'>{it['hours']:.2f}</td>"
                f"<td style='padding:8px 12px;border-bottom:1px solid #f1f5f9;color:#111827;font-weight:600;text-align:right'>${it['amount']:.2f}</td>"
                f"</tr>"
            )

        status_color = "#10b981" if inv["status"] == "paid" else "#6b7280"
        status_label = "PAID" if inv["status"] == "paid" else "UNPAID"
        html = f"""
<html><body style="font-family:-apple-system,Helvetica,Arial,sans-serif;background:#f5f6f8;margin:0;padding:24px">
<div style="max-width:620px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08)">
  <div style="background:#1f4e79;padding:24px 28px;display:flex;justify-content:space-between;align-items:flex-start">
    <div>
      <p style="margin:0;color:rgba(255,255,255,0.6);font-size:11px;text-transform:uppercase;letter-spacing:0.08em">Invoice</p>
      <p style="margin:4px 0 0;color:white;font-size:24px;font-weight:700">{inv['invoice_number']}</p>
      <p style="margin:4px 0 0;color:rgba(255,255,255,0.65);font-size:13px">{agency_name}</p>
    </div>
    <span style="background:rgba(255,255,255,0.15);color:white;font-size:11px;font-weight:700;padding:5px 12px;border-radius:20px;letter-spacing:0.06em">{status_label}</span>
  </div>
  <div style="padding:24px 28px">
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;font-size:13px">
      <tr>
        <td style="padding:0 20px 12px 0;color:#9ca3af;font-size:11px;text-transform:uppercase;letter-spacing:0.05em">Bill to</td>
        <td style="padding:0 20px 12px 0;color:#9ca3af;font-size:11px;text-transform:uppercase;letter-spacing:0.05em">Service period</td>
        <td style="padding:0 20px 12px 0;color:#9ca3af;font-size:11px;text-transform:uppercase;letter-spacing:0.05em">Rate</td>
        <td style="padding:0 0 12px 0;color:#9ca3af;font-size:11px;text-transform:uppercase;letter-spacing:0.05em">Created</td>
      </tr>
      <tr>
        <td style="padding:0 20px 0 0;color:#111827;font-weight:600;font-size:14px">{inv['client_name']}</td>
        <td style="padding:0 20px 0 0;color:#111827;font-weight:600;font-size:14px">{fmt(inv['period_start'])} – {fmt(inv['period_end'])}</td>
        <td style="padding:0 20px 0 0;color:#111827;font-weight:600;font-size:14px">${inv['rate_per_hour']:.2f}/hr</td>
        <td style="color:#111827;font-weight:600;font-size:14px">{fmt(inv['created_at'])}</td>
      </tr>
    </table>
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:4px">
      <thead>
        <tr style="background:#f8fafc">
          <th style="padding:8px 12px;text-align:left;color:#9ca3af;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;border-bottom:2px solid #e5e7eb">Date</th>
          <th style="padding:8px 12px;text-align:left;color:#9ca3af;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;border-bottom:2px solid #e5e7eb">Time</th>
          <th style="padding:8px 12px;text-align:left;color:#9ca3af;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;border-bottom:2px solid #e5e7eb">Caregiver</th>
          <th style="padding:8px 12px;text-align:right;color:#9ca3af;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;border-bottom:2px solid #e5e7eb">Hours</th>
          <th style="padding:8px 12px;text-align:right;color:#9ca3af;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;border-bottom:2px solid #e5e7eb">Amount</th>
        </tr>
      </thead>
      <tbody>{rows_html}</tbody>
      <tfoot>
        <tr>
          <td colspan="3"></td>
          <td style="padding:12px 12px 0;text-align:right;color:#374151;font-weight:600;border-top:2px solid #e5e7eb">{inv['total_hours']:.2f} hrs</td>
          <td style="padding:12px 12px 0;text-align:right;color:#1f4e79;font-size:18px;font-weight:700;border-top:2px solid #e5e7eb">${inv['total_amount']:.2f}</td>
        </tr>
      </tfoot>
    </table>
  </div>
  <div style="padding:14px 28px;background:#f9fafb;border-top:1px solid #e5e7eb">
    <p style="margin:0;color:#9ca3af;font-size:11px">Sent by Visiting Systems · {agency_name}</p>
  </div>
</div>
</body></html>"""

        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"Invoice {inv['invoice_number']} — {inv['client_name']}"
        msg["From"] = ALERT_FROM or SMTP_USER
        msg["To"] = to_email
        plain = (
            f"Invoice {inv['invoice_number']}\n"
            f"Client: {inv['client_name']}\n"
            f"Period: {fmt(inv['period_start'])} – {fmt(inv['period_end'])}\n"
            f"Total: ${inv['total_amount']:.2f} ({inv['total_hours']:.2f} hrs @ ${inv['rate_per_hour']:.2f}/hr)\n"
            f"Status: {status_label}"
        )
        msg.attach(MIMEText(plain, "plain"))
        msg.attach(MIMEText(html, "html"))
        try:
            with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15) as s:
                s.ehlo(); s.starttls(); s.ehlo()
                s.login(SMTP_USER, SMTP_PASS)
                s.send_message(msg)
            return self._send_json({"ok": True})
        except Exception as e:
            return self._send_json({"error": f"Email failed: {e}"}, 500)

    def handle_reassign_visit(self, visit_id, body):
        user = authenticate(self.headers)
        if not user or user["role"] != "admin":
            return self._send_json({"error": "unauthorized"}, 401)
        new_caregiver_id = body.get("new_caregiver_id") or body.get("caregiver_id")
        if not new_caregiver_id:
            return self._send_json({"error": "caregiver_id or new_caregiver_id required"}, 400)
        conn = db()
        visit = conn.execute(
            "SELECT caregiver_id, status FROM visits WHERE id = ? AND agency_id = ?",
            (visit_id, user["agency_id"]),
        ).fetchone()
        if not visit:
            conn.close()
            return self._send_json({"error": "visit not found"}, 404)
        if visit["status"] == "completed":
            conn.close()
            return self._send_json({"error": "Cannot reassign a completed visit"}, 409)
        cg = conn.execute(
            "SELECT id, name FROM users WHERE id = ? AND agency_id = ? AND role = 'caregiver'",
            (new_caregiver_id, user["agency_id"]),
        ).fetchone()
        if not cg:
            conn.close()
            return self._send_json({"error": "caregiver not found"}, 404)
        # Look up the old caregiver's name for the audit trail
        old_cg = conn.execute(
            "SELECT name FROM users WHERE id = ?",
            (visit["caregiver_id"],),
        ).fetchone()
        old_caregiver_name = old_cg["name"] if old_cg else str(visit["caregiver_id"])
        conn.execute("UPDATE visits SET caregiver_id = ? WHERE id = ?", (new_caregiver_id, visit_id))
        # If the visit was declined, reset it to scheduled so the new caregiver sees it
        if visit["status"] == "declined":
            conn.execute("UPDATE visits SET status = 'scheduled' WHERE id = ?", (visit_id,))
        # Ensure a verification stub exists so the UPDATE is not a no-op
        conn.execute(
            "INSERT OR IGNORE INTO visit_verifications (visit_id, exception_flags) VALUES (?, '')",
            (visit_id,),
        )
        conn.execute(
            "UPDATE visit_verifications SET reassigned_from = ? WHERE visit_id = ?",
            (old_caregiver_name, visit_id),
        )
        conn.commit()
        conn.close()
        # Clear any pending decline alert for this visit
        with _alerts_lock:
            _sent_alerts.pop(visit_id, None)
        logger.info(
            f"[VISIT] Visit {visit_id} reassigned from '{old_caregiver_name}' "
            f"to caregiver {new_caregiver_id} by admin {user['id']}"
        )
        log_audit(user["agency_id"], user["id"], user["name"], "visit_reassigned",
                  f"visit_id={visit_id} from={old_caregiver_name} to={cg['name']}")
        return self._send_json({"ok": True})

    def handle_decline_visit(self, visit_id, body):
        user = authenticate(self.headers)
        if not user or user["role"] != "caregiver":
            return self._send_json({"error": "unauthorized"}, 401)
        reason = (body.get("reason") or "").strip()
        if not reason:
            return self._send_json({"error": "reason is required"}, 400)
        if len(reason) > 200:
            return self._send_json({"error": "reason must be 200 characters or fewer"}, 400)
        conn = db()
        visit = conn.execute(
            "SELECT id, status FROM visits WHERE id = ? AND caregiver_id = ? AND agency_id = ?",
            (visit_id, user["id"], user["agency_id"]),
        ).fetchone()
        if not visit:
            conn.close()
            return self._send_json({"error": "visit not found"}, 404)
        if visit["status"] != "scheduled":
            conn.close()
            return self._send_json({"error": "Only scheduled visits can be declined"}, 409)
        # Fetch details needed for the alert before committing
        detail = conn.execute(
            """SELECT v.id, v.scheduled_start, v.caregiver_id,
                      c.name AS client_name, u.name AS caregiver_name
               FROM visits v
               JOIN clients c ON c.id = v.client_id
               JOIN users u ON u.id = v.caregiver_id
               WHERE v.id = ?""",
            (visit_id,),
        ).fetchone()
        conn.execute("UPDATE visits SET status = 'declined' WHERE id = ?", (visit_id,))
        conn.execute(
            "INSERT OR IGNORE INTO visit_verifications (visit_id, exception_flags) VALUES (?, '')",
            (visit_id,),
        )
        conn.execute(
            "UPDATE visit_verifications SET decline_reason = ? WHERE visit_id = ?",
            (reason, visit_id),
        )
        conn.commit()
        conn.close()
        logger.info(
            f"[VISIT] Visit {visit_id} declined by caregiver {user['id']} ({user['email']}): {reason!r}"
        )
        # Fire admin alert
        now = datetime.now()
        email_sent = False
        if detail:
            detail_dict = dict(detail)
            if _smtp_configured():
                email_sent, err = _send_decline_alert_email(detail_dict, reason)
                if not email_sent:
                    logger.warning(f"[ALERT] Decline email failed for visit {visit_id}: {err}")
            else:
                logger.info(
                    f"[ALERT] shift_declined — {detail_dict['client_name']} "
                    f"({detail_dict['caregiver_name']}) — SMTP not configured, alert logged only"
                )
            with _alerts_lock:
                _sent_alerts[visit_id] = {
                    "visit_id": visit_id,
                    "type": "shift_declined",
                    "sent_at": now.isoformat(timespec="seconds"),
                    "client_name": detail_dict["client_name"],
                    "caregiver_name": detail_dict["caregiver_name"],
                    "caregiver_id": detail_dict["caregiver_id"],
                    "scheduled_start": detail_dict["scheduled_start"],
                    "decline_reason": reason,
                    "email_sent": email_sent,
                    "reschedule_flag": True,
                }
        return self._send_json({"ok": True})

    def _recompute_flags(self, conn, visit_id):
        visit = conn.execute("SELECT * FROM visits WHERE id=?", (visit_id,)).fetchone()
        verification = conn.execute(
            "SELECT * FROM visit_verifications WHERE visit_id=?", (visit_id,)
        ).fetchone()
        client = conn.execute(
            "SELECT * FROM clients WHERE id=?", (visit["client_id"],)
        ).fetchone()
        flags = compute_exceptions(visit, verification, client)
        conn.execute(
            "UPDATE visit_verifications SET exception_flags=? WHERE visit_id=?",
            (",".join(flags), visit_id),
        )

    def log_message(self, format, *args):
        logger.debug(f"[HTTP] {self.address_string()} {format % args}")

    def log_error(self, format, *args):
        logger.error(f"[HTTP] {self.address_string()} {format % args}")


if __name__ == "__main__":
    # Warn loudly if running with the default insecure secret key
    if SECRET_KEY == "dev-only-insecure-secret-change-me":
        logger.warning(
            "[AUTH] EVV_SECRET_KEY is set to the default insecure placeholder. "
            "Set a strong random secret before any real deployment: "
            "export EVV_SECRET_KEY=$(openssl rand -hex 32)"
        )

    if not os.path.exists(DB_PATH):
        logger.info("No database found — seeding demo data...")
        import seed

        seed.main()

    # Migrate: add notes column to visit_verifications if missing
    try:
        _mconn = db()
        _mconn.execute("ALTER TABLE visit_verifications ADD COLUMN notes TEXT")
        _mconn.commit()
        _mconn.close()
        logger.info("[MIGRATE] Added notes column to visit_verifications")
    except Exception:
        pass  # Column already exists

    # Migrate: add approved column to users if missing (1 = approved, 0 = pending)
    try:
        _mconn = db()
        _mconn.execute("ALTER TABLE users ADD COLUMN approved INTEGER NOT NULL DEFAULT 1")
        _mconn.commit()
        _mconn.close()
        logger.info("[MIGRATE] Added approved column to users (existing users set to approved=1)")
    except Exception:
        pass  # Column already exists

    # Migrate: recurrence columns on visits
    for _col, _defn in [("recurrence_rule", "TEXT DEFAULT 'none'"), ("recurrence_group_id", "TEXT")]:
        try:
            _mconn = db()
            _mconn.execute(f"ALTER TABLE visits ADD COLUMN {_col} {_defn}")
            _mconn.commit()
            _mconn.close()
            logger.info(f"[MIGRATE] Added {_col} to visits")
        except Exception:
            pass

    # Migrate: signature columns on visit_verifications
    for _col, _defn in [("signature_data", "TEXT"), ("signature_reason_code", "TEXT")]:
        try:
            _mconn = db()
            _mconn.execute(f"ALTER TABLE visit_verifications ADD COLUMN {_col} {_defn}")
            _mconn.commit()
            _mconn.close()
            logger.info(f"[MIGRATE] Added {_col} to visit_verifications")
        except Exception:
            pass

    # Migrate: create invoices and invoice_items tables
    try:
        _mconn = db()
        _mconn.executescript("""
            CREATE TABLE IF NOT EXISTS invoices (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                agency_id INTEGER NOT NULL,
                client_id INTEGER NOT NULL,
                invoice_number TEXT NOT NULL UNIQUE,
                period_start TEXT NOT NULL,
                period_end TEXT NOT NULL,
                rate_per_hour REAL NOT NULL DEFAULT 25.0,
                total_hours REAL NOT NULL DEFAULT 0,
                total_amount REAL NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'draft',
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS invoice_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                invoice_id INTEGER NOT NULL,
                visit_id INTEGER NOT NULL,
                hours REAL NOT NULL,
                amount REAL NOT NULL,
                FOREIGN KEY (invoice_id) REFERENCES invoices(id),
                FOREIGN KEY (visit_id) REFERENCES visits(id)
            );
        """)
        _mconn.commit()
        _mconn.close()
        logger.info("[MIGRATE] Created invoices and invoice_items tables")
    except Exception as _e:
        logger.warning(f"[MIGRATE] invoices tables: {_e}")

    # Migrate: add paid_at column to invoices if missing
    try:
        _mconn = db()
        _mconn.execute("ALTER TABLE invoices ADD COLUMN paid_at TEXT")
        _mconn.commit()
        _mconn.close()
        logger.info("[MIGRATE] Added paid_at column to invoices")
    except Exception:
        pass  # Column already exists

    # Migrate: add employee_id column to users if missing
    try:
        _mconn = db()
        _mconn.execute("ALTER TABLE users ADD COLUMN employee_id TEXT")
        _mconn.commit()
        _mconn.close()
        logger.info("[MIGRATE] Added employee_id column to users")
    except Exception:
        pass  # Column already exists

    # Migrate: add timezone column to users if missing
    try:
        _mconn = db()
        _mconn.execute("ALTER TABLE users ADD COLUMN timezone TEXT DEFAULT 'America/Chicago'")
        _mconn.commit()
        _mconn.close()
        logger.info("[MIGRATE] Added timezone column to users")
    except Exception:
        pass  # Column already exists

    # Migrate: add reassigned_from column to visit_verifications if missing
    try:
        _mconn = db()
        _mconn.execute("ALTER TABLE visit_verifications ADD COLUMN reassigned_from TEXT")
        _mconn.commit()
        _mconn.close()
        logger.info("[MIGRATE] Added reassigned_from column to visit_verifications")
    except Exception:
        pass  # Column already exists

    # Migrate: add decline_reason column to visit_verifications if missing
    try:
        _mconn = db()
        _mconn.execute("ALTER TABLE visit_verifications ADD COLUMN decline_reason TEXT")
        _mconn.commit()
        _mconn.close()
        logger.info("[MIGRATE] Added decline_reason column to visit_verifications")
    except Exception:
        pass  # Column already exists

    # Migrate: deduplicate visit_verifications and add unique index on visit_id
    try:
        _mconn = db()
        # Remove duplicate rows, keeping the one with the highest id (most data)
        _mconn.execute("""
            DELETE FROM visit_verifications
            WHERE id NOT IN (
                SELECT MAX(id) FROM visit_verifications GROUP BY visit_id
            )
        """)
        _mconn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_vv_visit_id ON visit_verifications(visit_id)"
        )
        _mconn.commit()
        _mconn.close()
        logger.info("[MIGRATE] Deduped visit_verifications and added unique index on visit_id")
    except Exception:
        pass

    # Migrate: create app_config table
    try:
        _mconn = db()
        _mconn.execute("""
            CREATE TABLE IF NOT EXISTS app_config (
                key        TEXT PRIMARY KEY,
                value      TEXT NOT NULL,
                updated_at TEXT DEFAULT (datetime('now'))
            )
        """)
        _mconn.commit()
        _mconn.close()
        logger.info("[MIGRATE] Created app_config table")
    except Exception:
        pass

    # Migrate: create alert_dismissals table
    try:
        _mconn = db()
        _mconn.execute("""
            CREATE TABLE IF NOT EXISTS alert_dismissals (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                visit_id     INTEGER NOT NULL,
                alert_type   TEXT,
                admin_id     INTEGER NOT NULL,
                admin_name   TEXT NOT NULL,
                dismissed_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)
        _mconn.commit()
        _mconn.close()
        logger.info("[MIGRATE] Created alert_dismissals table")
    except Exception:
        pass

   # Migrate: add exception_acknowledged column
    try:
        _mconn = db()
        _mconn.execute("ALTER TABLE visits ADD COLUMN exception_acknowledged INTEGER DEFAULT 0")
        _mconn.commit()
        _mconn.close()
        logger.info("[MIGRATE] Added exception_acknowledged column")
    except Exception:
        pass

   # Migrate: create audit_log table
    try:
        _mconn = db()
        _mconn.execute("""
            CREATE TABLE IF NOT EXISTS audit_log (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                agency_id  INTEGER NOT NULL,
                admin_id   INTEGER NOT NULL,
                admin_name TEXT NOT NULL,
                action     TEXT NOT NULL,
                details    TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)
        _mconn.commit()
        _mconn.close()
        logger.info("[MIGRATE] Created audit_log table")
    except Exception:
        pass

    # Start background alert watcher
    watcher = threading.Thread(target=_alert_watcher, daemon=True)
    watcher.start()
    logger.info(
        f"[ALERT] Watcher started (checks every {ALERT_CHECK_INTERVAL}s, "
        f"SMTP {'configured' if _smtp_configured() else 'not configured — set SMTP_HOST, SMTP_USER, SMTP_PASS, SUPERVISOR_EMAIL'})"
    )

    # Start weekly payroll email watcher
    weekly_watcher = threading.Thread(target=_weekly_email_watcher, daemon=True)
    weekly_watcher.start()
    logger.info("[PAYROLL] Weekly email watcher started (fires Mondays at 8 AM)")

    # Start daily R2 backup
    backup_thread = threading.Thread(target=_backup_scheduler, daemon=True)
    backup_thread.start()
    logger.info("[BACKUP] Daily R2 backup scheduler started")

    port = int(os.environ.get("PORT", 8000))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    logger.info(f"Visiting Systems server running on http://localhost:{port}")
    server.serve_forever()
