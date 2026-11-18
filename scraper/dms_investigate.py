"""
Investigation tool for Draft My Schedule (DMS). It does NOT scrape anything.

What it does, in plain words:
1. Opens a visible Chromium window at draftmyschedule.uwo.ca.
2. YOU log in yourself. This script never sees, types or stores your password.
3. While you browse (for example, searching for Computer Science), it quietly
   writes down which web requests the page makes, so we can find out whether
   course data arrives as JSON from an endpoint.
4. It stops when the file .dms-logs/STOP appears, or when you close the window.

Privacy rules this script follows:
- It only records requests to draftmyschedule.uwo.ca (never the login site).
- It never records headers, cookies or tokens. Sensitive URL parameters are redacted.
- For JSON responses it records the *shape* (key names and types), and only
  shows example values for course-like keys (times, rooms, instructors...).
- Your login session lives in a browser profile OUTSIDE the project folder
  (~/.slotted-dms/profile), so it can never be committed to git.
"""

import argparse
import json
import re
import time
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit

from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright

from program_pages import extract_program_section

DMS_URL = "https://draftmyschedule.uwo.ca/"
DMS_HOST = "draftmyschedule.uwo.ca"

PROJECT_ROOT = Path(__file__).resolve().parent.parent
LOG_DIR = PROJECT_ROOT / ".dms-logs"  # git-ignored
LOG_FILE = LOG_DIR / "network_summary.json"
STOP_FILE = LOG_DIR / "STOP"
GO_FILE = LOG_DIR / "GO"  # created only after the student confirms they are logged in
DELAY_MS = 2000  # polite wait before every page the script opens itself
PROFILE_DIR = Path.home() / ".slotted-dms" / "profile"  # outside the project

# Key names whose example values are safe and useful to see (course data).
COURSE_KEY = re.compile(
    r"time|day|room|loc|build|instr|prof|class|sect|comp|subj|catalog|course|"
    r"term|start|end|title|nbr|num|campus|status|desc|type|meet|week",
    re.IGNORECASE,
)
# Key names that might be about the logged-in student. These are never shown,
# even if they also match COURSE_KEY (e.g. "studentNumber" contains "num").
PERSONAL_KEY = re.compile(
    r"student|user|person|email|phone|birth|address|login|account|gpa|grade|"
    r"netid|emplid|enrol|owner|my[A-Z_]",
)
# URL parameter names that might carry secrets.
SECRET_PARAM = re.compile(
    r"token|ticket|code|state|session|auth|sid|key|jwt|saml|pass|cookie",
    re.IGNORECASE,
)
LOOKS_LIKE_TOKEN = re.compile(r"^[A-Za-z0-9+/=_\-.]{40,}$")


def safe_url(url: str) -> str:
    """Return the URL with secret-looking query parameters replaced."""
    parts = urlsplit(url)
    params = [
        (k, "[redacted]" if SECRET_PARAM.search(k) or LOOKS_LIKE_TOKEN.match(v) else v)
        for k, v in parse_qsl(parts.query, keep_blank_values=True)
    ]
    query = f"?{urlencode(params)}" if params else ""
    return f"{parts.path}{query}"


def example_value(key: str, value):
    """Show a value only if its key looks like course data and it isn't token-like."""
    if PERSONAL_KEY.search(key) or re.search(r"student|user|email", key, re.IGNORECASE):
        return None
    if not COURSE_KEY.search(key):
        return None
    if isinstance(value, str):
        if LOOKS_LIKE_TOKEN.match(value):
            return "[redacted]"
        return value[:80]
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    return None


def shape(value, key: str = "", depth: int = 0):
    """Describe JSON structure: key names and types, not personal values."""
    if depth > 6:
        return "..."
    if isinstance(value, dict):
        return {k: shape(v, k, depth + 1) for k, v in list(value.items())[:60]}
    if isinstance(value, list):
        if not value:
            return "list(empty)"
        return {f"list(len={len(value)}) first item": shape(value[0], key, depth + 1)}
    described = type(value).__name__
    example = example_value(key, value)
    return f"{described} e.g. {example!r}" if example is not None else described


def html_forms(html: str):
    """List each form's action and its field names (never the values)."""
    forms = []
    for form in re.finditer(r"<form\b(.*?)</form>", html, re.IGNORECASE | re.DOTALL):
        action = re.search(r'action\s*=\s*["\']?([^"\'\s>]+)', form.group(1), re.IGNORECASE)
        names = re.findall(r'<(?:input|select|textarea)\b[^>]*\bname\s*=\s*["\']?([^"\'\s>]+)', form.group(1), re.IGNORECASE)
        forms.append({"action": action.group(1) if action else None, "fields": sorted(set(names))})
    return forms


def save_page_content(html: str, index: int) -> str:
    """Save a page's main content (no scripts, styles, header, nav or forms)."""
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript", "header", "nav", "form", "footer", "iframe"]):
        tag.decompose()
    main = soup.find("main") or soup.find(id="content") or soup.body or soup
    out = LOG_DIR / f"page_{index}.html"
    out.write_text(str(main), encoding="utf-8")
    return f"{len(main.get_text(' ', strip=True))} characters of text -> {out.name}"


def save_course_tables(html: str, index: int, page_name: str = "course_listing"):
    """Save only the top-level <table> elements of a course page, so we can
    study the layout of sections/times/rooms without the rest of the page."""
    soup = BeautifulSoup(html, "html.parser")
    tables = [t for t in soup.find_all("table") if t.find_parent("table") is None]
    if not tables:
        return "no tables"
    out = LOG_DIR / f"{page_name}_{index}.html"
    out.write_text("\n\n".join(str(t) for t in tables), encoding="utf-8")
    rows = sum(len(t.find_all("tr")) for t in tables)
    return f"{len(tables)} tables, {rows} rows -> {out.name}"


def post_body_keys(request):
    """Record which fields a POST sends (names only; values only if course-like)."""
    if "login" in urlsplit(request.url).path.lower():
        return "skipped (login page)"
    data = request.post_data
    if not data:
        return None
    try:
        body = json.loads(data)
        return shape(body)
    except (ValueError, TypeError):
        pass
    pairs = parse_qsl(data, keep_blank_values=True)
    if pairs:
        return {k: (example_value(k, v) if example_value(k, v) is not None else "str") for k, v in pairs}
    return f"non-form body, {len(data)} chars"


def main():
    # Optional: pages to open AFTER the student confirms login, e.g.
    #   python dms_investigate.py --visit "/secure/courses.cfm?..."
    parser = argparse.ArgumentParser()
    parser.add_argument("--visit", action="append", default=[], help="DMS path to open after GO")
    visits = parser.parse_args().visit

    LOG_DIR.mkdir(exist_ok=True)
    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    for flag in (STOP_FILE, GO_FILE):
        if flag.exists():
            flag.unlink()

    records = []

    def save():
        LOG_FILE.write_text(json.dumps(records, indent=2), encoding="utf-8")

    def on_response(response):
        request = response.request
        if urlsplit(response.url).hostname != DMS_HOST:
            return  # ignore the login site and any other hosts
        if request.resource_type not in ("xhr", "fetch", "document"):
            return  # skip images, CSS, fonts, scripts
        content_type = response.headers.get("content-type", "")
        record = {
            "time": time.strftime("%H:%M:%S"),
            "kind": request.resource_type,
            "method": request.method,
            "url": safe_url(response.url),
            "status": response.status,
            "content_type": content_type.split(";")[0],
        }
        if request.method == "POST":
            record["post_fields"] = post_body_keys(request)
        try:
            body = response.body()
            record["size_bytes"] = len(body)
            if "json" in content_type:
                record["json_shape"] = shape(json.loads(body))
            elif "html" in content_type and "login" not in record["url"].lower():
                html = body.decode("utf-8", errors="replace")
                record["forms"] = html_forms(html)
                saved = False
                for page_name in ("course_listing", "courses"):
                    if f"/{page_name}.cfm" in record["url"]:
                        record["saved_tables"] = save_course_tables(html, len(records), page_name)
                        saved = True
                # Other DMS pages (e.g. program information): save the main content,
                # without scripts, header or navigation, for checking before reading.
                # Program pages: keep ONLY the program section, with anything personal
                # (name, student number, admission info, your own draft) removed.
                if not saved and "course_selection" in record["url"]:
                    section = extract_program_section(html)
                    if section:
                        out = LOG_DIR / f"program_{len(records)}.html"
                        out.write_text(section, encoding="utf-8")
                        record["saved_program"] = out.name
        except Exception as error:  # some responses (redirects) have no body
            record["body_note"] = type(error).__name__
        records.append(record)
        save()
        print(f"[{record['time']}] {record['method']} {record['url'][:100]} -> {record['status']} {record['content_type']}")

    with sync_playwright() as p:
        # channel="msedge" uses the Microsoft Edge built into Windows, with its own
        # separate profile folder (not your normal Edge profile or saved logins).
        browser = p.chromium.launch_persistent_context(
            str(PROFILE_DIR), channel="msedge", headless=False,
            viewport={"width": 1280, "height": 860},
        )
        page = browser.pages[0] if browser.pages else browser.new_page()
        browser.on("response", on_response)
        page.goto(DMS_URL)
        print("Browser is open. Log in yourself, then browse. Waiting for STOP file...")

        # Wait with Playwright's own timer (not time.sleep), so network events
        # keep being handled while we wait. time.sleep froze them until the end.
        while not STOP_FILE.exists():
            if not browser.pages:  # user closed the window
                break
            try:
                current = browser.pages[0]
                if visits and GO_FILE.exists():
                    path = visits.pop(0)
                    current.wait_for_timeout(DELAY_MS)
                    print(f"Visiting {path}")
                    current.goto(f"https://{DMS_HOST}{path}")
                    if not visits:
                        print("All visits done. Waiting for STOP file...")
                current.wait_for_timeout(1000)
            except Exception as error:
                print(f"Stopped: {type(error).__name__}")
                break

        save()
        browser.close()
    print(f"Done. Recorded {len(records)} requests to {LOG_FILE.relative_to(PROJECT_ROOT)}")


if __name__ == "__main__":
    main()
