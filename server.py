"""WorkMate marketing site — local dev server.

Prototype of the production edge/backend described in
website-tech-foundation.md and website-analytics-design.md:
  * static pages with strict security headers (nonce CSP)
  * edge A/B assignment before render (no flicker)
  * POST /e      first-party analytics collector (schema allowlist, bot flag, no IP stored)
  * POST /api/demo  lead capture (server-side validation, honeypot, rate limit)
  * GET  /_stats    local-only debug view of collected data

Storage is SQLite here; production uses PostgreSQL with the same tables.
Run:  python3 server.py [site_dir] [db_path] [port]
"""
import hashlib
import html
import json
import os
import re
import secrets
import sqlite3
import sys
import threading
import time
import uuid
from datetime import date, datetime, timezone
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

# realpath, not abspath: serve_static compares realpath()s, and /tmp is a symlink on macOS
SITE_DIR = os.path.realpath(sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__)))
DB_PATH = sys.argv[2] if len(sys.argv) > 2 else os.path.join(SITE_DIR, "dev.sqlite3")
PORT = int(sys.argv[3]) if len(sys.argv) > 3 else 9030

MAX_BODY = 16 * 1024
DAILY_SALT = {"day": None, "salt": None}

# Tracking plan: event name -> allowed prop keys. Unknown events/props are rejected.
EVENTS = {
    "page_view": {"load_ms"},
    "page_leave": {"time_on_page_ms", "max_scroll_pct"},
    "scroll_depth": {"pct"},
    "section_view": {"section_id"},
    "cta_click": {"cta_id", "location"},
    "role_tab_select": {"role"},
    "module_card_click": {"module"},
    "pricing_toggle": {"billing", "currency"},
    "pricing_plan_click": {"plan"},
    "demo_form_start": {"form_id"},
    "demo_form_field_complete": {"form_id", "field_name"},
    "demo_form_error": {"form_id", "field_name", "error_code"},
    "experiment_exposure": {"experiment_id", "variant"},
    "outbound_click": {"href_host"},
    "web_vitals": {"metric", "value"},
    "consent_update": {"state"},
}
ENVELOPE = {"event_id", "event_name", "ts", "anonymous_id", "session_id", "page_path", "page_title",
            "referrer_host", "utm", "viewport_w", "locale", "consent_state", "experiments", "props"}

# Experiments: id -> weighted variants. Assignment is deterministic per visitor.
EXPERIMENTS = {"hero_h1": [("control", 50), ("same_page", 50)]}

BOT_RE = re.compile(r"bot|crawl|spider|slurp|headless|lighthouse|pingdom|monitor|curl|wget|python-requests", re.I)
EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[A-Za-z]{2,24}$")
FREE_MAIL = {"gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "proton.me", "aol.com"}
SIZES = {"1-99", "100-249", "250-999", "1000-2000", "2000+"}

_rate = {}
_rate_lock = threading.Lock()
_db_lock = threading.Lock()


def db():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.execute("pragma journal_mode=wal")
    return conn


def init_db():
    with db() as c:
        c.executescript("""
        create table if not exists events(
          event_id text primary key, event_name text not null, ts text not null, received_at text not null,
          anonymous_id text not null, id_kind text not null, session_id text not null, lead_id text,
          page_path text, referrer_host text, utm text, geo text, device text, props text,
          experiments text, consent_state text, is_bot integer not null default 0);
        create index if not exists events_name_ts on events(event_name, ts);
        create table if not exists leads(
          lead_id text primary key, created_at text not null, name text not null, email text not null,
          company text not null, company_size text not null, role text, message text,
          consent_marketing integer not null, consent_policy_version text not null,
          anonymous_id text, session_id text, utm text);
        create table if not exists identity_links(anonymous_id text, lead_id text, linked_at text,
          primary key(anonymous_id, lead_id));
        """)


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def daily_salt():
    today = date.today().isoformat()
    if DAILY_SALT["day"] != today:  # previous salt is discarded, so old hashes can't be re-linked
        DAILY_SALT.update(day=today, salt=secrets.token_hex(16))
    return DAILY_SALT["salt"]


def cookieless_id(ip, ua):
    truncated = ".".join(ip.split(".")[:3]) if "." in ip else ip[:19]
    return "cl_" + hashlib.sha256((daily_salt() + truncated + ua).encode()).hexdigest()[:24]


def rate_ok(key, limit, window_s):
    t = time.time()
    with _rate_lock:
        hits = [h for h in _rate.get(key, []) if t - h < window_s]
        if len(hits) >= limit:
            _rate[key] = hits
            return False
        hits.append(t)
        _rate[key] = hits
        return True


def device_from_ua(ua, viewport_w):
    ua_l = ua.lower()
    dtype = "tablet" if "ipad" in ua_l or "tablet" in ua_l else "mobile" if "mobi" in ua_l else "desktop"
    os_ = next((n for k, n in [("windows", "Windows"), ("android", "Android"), ("iphone", "iOS"), ("ipad", "iOS"),
                                ("mac os", "macOS"), ("linux", "Linux")] if k in ua_l), "Other")
    br = next((n for k, n in [("edg/", "Edge"), ("firefox", "Firefox"), ("chrome", "Chrome"), ("safari", "Safari")] if k in ua_l), "Other")
    return {"type": dtype, "os": os_, "browser": br, "viewport_w": viewport_w}


def assign(exp_id, visitor_key):
    bucket = int(hashlib.sha256(f"{exp_id}:{visitor_key}".encode()).hexdigest(), 16) % 100
    acc = 0
    for variant, weight in EXPERIMENTS[exp_id]:
        acc += weight
        if bucket < acc:
            return variant
    return EXPERIMENTS[exp_id][0][0]


def clean_str(v, n=200):
    return v.strip()[:n] if isinstance(v, str) else None


class Handler(BaseHTTPRequestHandler):
    server_version = "wm"
    sys_version = ""

    def log_message(self, fmt, *args):  # no IPs or query strings in logs
        sys.stderr.write("%s %s\n" % (self.command, urlparse(self.path).path))

    # ── helpers ──
    def client_ip(self):
        return self.client_address[0]

    def cookies(self):
        c = SimpleCookie()
        c.load(self.headers.get("Cookie", ""))
        return {k: v.value for k, v in c.items()}

    def security_headers(self, nonce=None):
        csp = ("default-src 'self'; "
               f"script-src 'self'{f' {chr(39)}nonce-{nonce}{chr(39)}' if nonce else ''}; "
               "style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; "
               "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'")
        self.send_header("Content-Security-Policy", csp)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()")
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        # HSTS only meaningful over HTTPS; production sets max-age=63072000; includeSubDomains; preload
        if self.headers.get("X-Forwarded-Proto") == "https":
            self.send_header("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload")

    def send_json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.security_headers()
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            return None
        try:
            return json.loads(self.rfile.read(length))
        except (ValueError, UnicodeDecodeError):
            return None

    def same_origin(self):
        origin = self.headers.get("Origin")
        host = self.headers.get("Host", "")
        return origin is None or urlparse(origin).netloc == host

    # ── routes ──
    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/_stats":
            return self.stats()
        if path in ("/", "/index.html"):
            return self.serve_page("index.html")
        if path.startswith("/assets/"):
            return self.serve_static(path.lstrip("/"))
        if path == "/.well-known/security.txt":
            body = b"Contact: mailto:security@workmate.example\nPolicy: https://workmate.example/security\nPreferred-Languages: en\n"
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.security_headers()
            self.end_headers()
            return self.wfile.write(body)
        self.send_error(404)

    def do_POST(self):
        path = urlparse(self.path).path
        if not self.same_origin():
            return self.send_json(403, {"ok": False})
        if path == "/e":
            return self.collect()
        if path == "/api/demo":
            return self.demo()
        self.send_error(404)

    def serve_static(self, rel):
        full = os.path.realpath(os.path.join(SITE_DIR, rel))
        if not full.startswith(SITE_DIR + os.sep) or not os.path.isfile(full):
            return self.send_error(404)
        ctype = {".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml",
                 ".woff2": "font/woff2", ".png": "image/png", ".ico": "image/x-icon"}.get(os.path.splitext(full)[1], "application/octet-stream")
        with open(full, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.security_headers()
        self.end_headers()
        self.wfile.write(body)

    def serve_page(self, name):
        with open(os.path.join(SITE_DIR, name), encoding="utf-8") as f:
            page = f.read()
        nonce = secrets.token_urlsafe(16)
        cookies = self.cookies()
        ua = self.headers.get("User-Agent", "")
        # Consented visitors have wm_aid; others get a daily cookieless key. Same visitor -> same variant.
        visitor = cookies.get("wm_aid") or cookieless_id(self.client_ip(), ua)
        assigned = {e: assign(e, visitor) for e in EXPERIMENTS}
        for e in EXPERIMENTS:
            forced = re.search(rf"[?&]exp_{e}=([a-z_]+)", self.path)  # QA override
            if forced and forced.group(1) in dict(EXPERIMENTS[e]):
                assigned[e] = forced.group(1)
        page = page.replace("{{NONCE}}", nonce)
        page = page.replace("{{EXPERIMENTS}}", ",".join(f"{k}:{v}" for k, v in assigned.items()))
        body = page.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Vary", "Cookie")
        self.security_headers(nonce)
        self.end_headers()
        self.wfile.write(body)

    def collect(self):
        ip, ua = self.client_ip(), self.headers.get("User-Agent", "")
        if not rate_ok("e:" + cookieless_id(ip, ua), 120, 60):
            return self.send_json(429, {"ok": False})
        data = self.read_json()
        if not isinstance(data, dict) or not isinstance(data.get("events"), list) or len(data["events"]) > 50:
            return self.send_json(400, {"ok": False})
        is_bot = 1 if BOT_RE.search(ua) else 0
        fallback_id = cookieless_id(ip, ua)  # IP used only here, never stored
        rows, rejected = [], 0
        for ev in data["events"]:
            if not isinstance(ev, dict) or set(ev) - ENVELOPE or ev.get("event_name") not in EVENTS:
                rejected += 1
                continue
            props = ev.get("props") or {}
            if not isinstance(props, dict) or set(props) - EVENTS[ev["event_name"]]:
                rejected += 1
                continue
            props = {k: (v if isinstance(v, (int, float)) else clean_str(str(v), 80)) for k, v in props.items()}
            try:
                uuid.UUID(str(ev.get("event_id")))
            except ValueError:
                rejected += 1
                continue
            aid = clean_str(ev.get("anonymous_id"), 64)
            utm = ev.get("utm") if isinstance(ev.get("utm"), dict) else {}
            exps = ev.get("experiments") if isinstance(ev.get("experiments"), list) else []
            rows.append((
                ev["event_id"], ev["event_name"], clean_str(ev.get("ts"), 40) or now_iso(), now_iso(),
                aid or fallback_id, "cookie" if aid else "cookieless", clean_str(ev.get("session_id"), 64) or "none", None,
                clean_str(ev.get("page_path"), 200), clean_str(ev.get("referrer_host"), 200),
                json.dumps({k: clean_str(v, 100) for k, v in utm.items() if k in {"source", "medium", "campaign", "term", "content"}}),
                json.dumps({"country": self.headers.get("CF-IPCountry") or self.headers.get("X-Vercel-IP-Country") or "unknown"}),
                json.dumps(device_from_ua(ua, ev.get("viewport_w") if isinstance(ev.get("viewport_w"), int) else None)),
                json.dumps(props), json.dumps(exps[:5]), clean_str(ev.get("consent_state"), 12), is_bot))
        with _db_lock, db() as c:
            c.executemany("insert or ignore into events values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", rows)
        self.send_json(202, {"ok": True, "accepted": len(rows), "rejected": rejected})

    def demo(self):
        ip, ua = self.client_ip(), self.headers.get("User-Agent", "")
        if not rate_ok("demo:" + cookieless_id(ip, ua), 5, 600):
            return self.send_json(429, {"ok": False, "errors": {"_form": "Too many attempts. Please try again in a few minutes."}})
        d = self.read_json()
        if not isinstance(d, dict):
            return self.send_json(400, {"ok": False, "errors": {"_form": "Something went wrong. Please try again."}})
        if d.get("website"):  # honeypot: bots fill hidden fields; pretend success
            return self.send_json(200, {"ok": True})
        name, email, company = clean_str(d.get("name"), 120), clean_str(d.get("email"), 254), clean_str(d.get("company"), 160)
        size, role, message = clean_str(d.get("company_size"), 20), clean_str(d.get("role"), 120), clean_str(d.get("message"), 2000)
        errors = {}
        if not name or len(name) < 2:
            errors["name"] = "Please tell us your name."
        if not email or not EMAIL_RE.match(email):
            errors["email"] = "That doesn't look like an email address."
        elif email.split("@")[1].lower() in FREE_MAIL:
            errors["email"] = "Please use your work email."
        if not company:
            errors["company"] = "Which company are you with?"
        if size not in SIZES:
            errors["company_size"] = "Pick your company size."
        if d.get("consent_terms") is not True:
            errors["consent_terms"] = "Please agree so we can contact you about your demo."
        if errors:
            return self.send_json(422, {"ok": False, "errors": errors})
        lead_id = str(uuid.uuid4())
        aid = clean_str(d.get("anonymous_id"), 64) or cookieless_id(ip, ua)
        sid = clean_str(d.get("session_id"), 64)
        utm = d.get("utm") if isinstance(d.get("utm"), dict) else {}
        utm = {k: clean_str(v, 100) for k, v in utm.items() if k in {"source", "medium", "campaign", "term", "content"}}
        exps = d.get("experiments") if isinstance(d.get("experiments"), list) else []
        with _db_lock, db() as c:
            c.execute("insert into leads values (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                      (lead_id, now_iso(), name, email.lower(), company, size, role, message,
                       1 if d.get("consent_marketing") is True else 0, "privacy-2026-10", aid, sid, json.dumps(utm)))
            c.execute("insert or ignore into identity_links values (?,?,?)", (aid, lead_id, now_iso()))
            # Conversion recorded server-side: can't be blocked or faked from the browser.
            c.execute("insert into events values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                      (str(uuid.uuid4()), "demo_form_submit", now_iso(), now_iso(), aid,
                       "cookie" if d.get("anonymous_id") else "cookieless", sid or "none", lead_id, "/", None,
                       json.dumps(utm), json.dumps({"country": "unknown"}), json.dumps(device_from_ua(ua, None)),
                       json.dumps({"company_size": size}), json.dumps(exps[:5]), None, 0))
        # Production: notify sales (Slack/email) + push to CRM here, after commit.
        self.send_json(200, {"ok": True})

    def stats(self):
        if self.client_ip() not in ("127.0.0.1", "::1"):
            return self.send_error(404)
        with db() as c:
            by_event = c.execute("select event_name, count(*) from events where is_bot=0 group by 1 order by 2 desc").fetchall()
            ids = c.execute("select id_kind, count(distinct anonymous_id) from events group by 1").fetchall()
            sections = c.execute("select json_extract(props,'$.section_id'), count(*) from events where event_name='section_view' group by 1 order by 2 desc").fetchall()
            exp = c.execute("""select json_extract(props,'$.variant') v, count(distinct anonymous_id)
                               from events where event_name='experiment_exposure' group by 1""").fetchall()
            leads = c.execute("select count(*) from leads").fetchone()[0]
        rows = lambda r: "".join(f"<tr><td>{html.escape(str(a))}</td><td>{b}</td></tr>" for a, b in r)
        body = f"""<!doctype html><meta charset=utf-8><title>wm stats</title>
        <style>body{{font:14px system-ui;margin:32px;color:#14161F}}table{{border-collapse:collapse;margin:0 0 24px}}td{{border:1px solid #ddd;padding:4px 10px}}</style>
        <h1>Local analytics (dev only)</h1><p>Leads: <b>{leads}</b></p>
        <h3>Events</h3><table>{rows(by_event)}</table><h3>Visitors by id kind</h3><table>{rows(ids)}</table>
        <h3>Section views</h3><table>{rows(sections)}</table><h3>hero_h1 exposures (unique visitors)</h3><table>{rows(exp)}</table>""".encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.security_headers()
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    init_db()
    print(f"WorkMate site on http://127.0.0.1:{PORT}  (site={SITE_DIR}, db={DB_PATH})")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
