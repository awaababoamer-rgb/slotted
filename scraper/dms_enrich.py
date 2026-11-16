"""
Fills in meeting days/times, rooms and instructors in data/courses.json using
Draft My Schedule (DMS). Run this MANUALLY. Never on a schedule.

How it works, in plain words:
1. Opens a visible Edge window at DMS. YOU log in yourself; this script never
   sees, types or stores your password.
2. It waits until the file .dms-logs/GO exists (created after you
   confirm you are logged in; you can create it yourself).
3. For each subject: it opens the course list for each course level, then each
   course's "View details" page, waiting 2 seconds before EVERY page.
4. Sections already in data/courses.json (from the public timetable) are
   matched by class number and get times/rooms/instructors.
   Courses that aren't in the file yet are created from DMS data.
   Either way the section gets data_source = "dms".
5. If DMS logs you out mid-run, it saves progress, deletes GO, and waits for
   you to log in again.

It only reads course pages (course_listing.cfm and courses.cfm). It never opens
your draft schedule or clicks "Save to Draft".

Usage:
    python scraper/dms_enrich.py                    # Computer Science
    python scraper/dms_enrich.py --subject MATH --subject STATS
"""

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urljoin, urlsplit

from bs4 import BeautifulSoup

DMS = "https://draftmyschedule.uwo.ca"
DELAY_MS = 2000  # polite wait before every page
DEFAULT_LEVELS = ["1000", "2000", "3000", "4000"]
MAX_CODE_MISMATCH = 0.05  # stop if >5% of a checkable subject's codes are wrong

PROJECT_ROOT = Path(__file__).resolve().parent.parent
COURSES_FILE = PROJECT_ROOT / "data" / "courses.json"
LOG_DIR = PROJECT_ROOT / ".dms-logs"  # git-ignored
GO_FILE = LOG_DIR / "GO"
PROFILE_DIR = Path.home() / ".slotted-dms" / "profile"  # outside the project

DAY_NAMES = {"M": "Mon", "Tu": "Tue", "W": "Wed", "Th": "Thu", "F": "Fri", "Sa": "Sat", "Su": "Sun"}
TIME_RANGE = re.compile(r"(\d{1,2}):(\d{2})\s*([AP]M)\s*-\s*(\d{1,2}):(\d{2})\s*([AP]M)", re.IGNORECASE)
COURSE_NUMBER = re.compile(r"\b(\d{4}[A-Z]?)\b")


def clean(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def to_24h(hour: str, minute: str, ampm: str) -> str:
    """'9', '30', 'PM' -> '21:30'"""
    h = int(hour) % 12 + (12 if ampm.upper() == "PM" else 0)
    return f"{h:02d}:{minute}"


def term_from_suffix(suffix: str) -> str:
    # Same rules as public_timetable.py
    if suffix in ("", "E"):
        return "full_year"
    if suffix in "AFQRW":
        return "first_term"
    if suffix in "BGSTX":
        return "second_term"
    if suffix in "YZ":
        return "other_session"
    return "unknown"


# ---------- Parsing (pure functions, testable without a browser) ----------

def parse_listing(html: str):
    """From a course list page return:
    links:  [(CourseAcadCalendarID, href)] for each 'View details' button
    titles: {"1020A": {"title": ..., "description": ...}}"""
    soup = BeautifulSoup(html, "html.parser")
    links = []
    for a in soup.select('a[href*="courses.cfm"]'):
        key = (parse_qs(urlsplit(a["href"]).query).get("CourseAcadCalendarID") or [None])[0]
        if key and key not in {k for k, _ in links}:
            links.append((key, a["href"]))

    titles = {}
    for block in soup.select('div[id^="descr_content_"]'):
        heading = block.find("b")
        if not heading:
            continue
        # e.g. "FOUNDATIONS OF COMPUTER SCI 1020A"
        match = re.match(r"^(.*\S)\s+(\d{4}[A-Z]?)$", clean(heading.get_text()))
        if not match:
            continue
        title, number = match.groups()
        description = block.find("p", class_="displayNone")
        titles.setdefault(number, {
            "title": title,
            "description": clean(description.get_text()) if description else "",
        })
    return links, titles


def find_course_number(table, known: set):
    """The course code appears in a heading above each sections table.
    Walk backwards through the text before the table and return the first
    course number (e.g. '1020A') that is one we saw in the course list."""
    for text in table.find_all_previous(string=True, limit=60):
        for number in reversed(COURSE_NUMBER.findall(text)):
            if number in known:
                return number
    return None


def parse_meetings(cell, problems: list, class_nbr: str) -> list:
    """Read the nested Days/Times/Location table into a list of meetings."""
    meetings = []
    for row in cell.find_all("tr"):
        tds = row.find_all("td", recursive=False)
        if len(tds) < 3:
            continue
        day_tokens = clean(tds[0].get_text()).split()
        time_text = clean(tds[1].get_text())
        location = clean(tds[2].get_text())
        times = TIME_RANGE.search(time_text)
        if not times and not day_tokens:
            # No day and no time (DMS shows "-"): an online/asynchronous section
            # with no fixed meeting. It can never cause a time conflict.
            continue
        start = to_24h(*times.group(1, 2, 3)) if times else None
        end = to_24h(*times.group(4, 5, 6)) if times else None
        if not times:
            problems.append(f"class {class_nbr}: has days {day_tokens} but unreadable time {time_text!r}")
        if not day_tokens:
            problems.append(f"class {class_nbr}: has a time but no day")
            meetings.append({"day": None, "start": start, "end": end, "location": location})
        for token in day_tokens:
            day = DAY_NAMES.get(token)
            if day is None:
                problems.append(f"class {class_nbr}: unknown day {token!r}")
                continue
            meetings.append({"day": day, "start": start, "end": end, "location": location})
    return meetings


def parse_details(html: str, problems: list, known_numbers: set = frozenset()) -> dict:
    """Return {class_number: section info} from a courses.cfm page."""
    soup = BeautifulSoup(html, "html.parser")
    found = {}
    for table in soup.find_all("table"):
        header_row = table.find("tr")
        headers = [clean(th.get_text()) for th in header_row.find_all("th", recursive=False)] if header_row else []
        if "Class Nbr" not in headers:
            continue
        col = {name: i for i, name in enumerate(headers)}
        number = find_course_number(table, known_numbers) if known_numbers else None

        def cell(tds, name):
            return tds[col[name]] if name in col and col[name] < len(tds) else None

        for row in table.find_all("tr"):
            if row.find_parent("table") is not table:
                continue  # skip rows of the nested meetings table
            tds = row.find_all("td", recursive=False)
            if len(tds) < len(col) - 2:  # header row, or malformed
                if tds:
                    problems.append(f"row with {len(tds)} cells, expected ~{len(col)}")
                continue
            class_nbr = clean(cell(tds, "Class Nbr").get_text())
            if not class_nbr.isdigit():
                problems.append(f"bad class number {class_nbr!r}")
                continue
            req_text = clean(cell(tds, "Requisites and Constraints").get_text(" ")) if cell(tds, "Requisites and Constraints") else ""
            notes, _, requisites = req_text.partition("REQUISITES:")
            status = clean(cell(tds, "Status").get_text()) if cell(tds, "Status") else ""
            waitlist = clean(cell(tds, "Waitlist").get_text()) if cell(tds, "Waitlist") else ""
            entry = {
                "course_number": number,  # e.g. "1020A", or None if not found
                "component": clean(cell(tds, "Component").get_text()),
                "section": clean(cell(tds, "Section").get_text()),
                "instructors": [clean(t) for t in cell(tds, "Instructor").stripped_strings if clean(t)],
                "meetings": parse_meetings(cell(tds, "Days/Times/Location"), problems, class_nbr),
                "credit_units": clean(cell(tds, "Credit Units").get_text()) if cell(tds, "Credit Units") else "",
                "waitlist": int(waitlist) if waitlist.isdigit() else waitlist,
                "status": status,
                "campus": clean(cell(tds, "Campus").get_text()) if cell(tds, "Campus") else "",
                "delivery": clean(cell(tds, "Delivery Type").get_text()) if cell(tds, "Delivery Type") else "",
                "notes": clean(notes),
                "requisites": clean(requisites),
            }
            found[int(class_nbr)] = entry
    return found


def new_section(class_nbr: int, info: dict, now: str) -> dict:
    """A section built only from DMS (no public timetable data for it)."""
    return {
        "section": info["section"],
        "component": info["component"],
        "class_number": class_nbr,
        "full": info["status"].lower() == "full",
        "status": info["status"],
        "campus": info["campus"],
        "delivery": info["delivery"],
        "notes": info["notes"],
        "requisites": info["requisites"],
        "instructors": info["instructors"],
        "meetings": info["meetings"],
        "credit_units": info["credit_units"],
        "waitlist": info["waitlist"],
        "data_source": "dms",
        "dms_updated": now,
    }


# ---------- Browser part ----------

def wait_for_go(page):
    print("Waiting for you to log in (then create .dms-logs/GO)...", flush=True)
    while not GO_FILE.exists():
        page.wait_for_timeout(1000)


def open_page(page, url: str) -> str:
    """Polite visit. If DMS sent us to the login page, wait for re-login and retry."""
    while True:
        page.wait_for_timeout(DELAY_MS)
        page.goto(url)
        if "login" not in page.url.lower():
            return page.content()
        print("DMS logged us out. Please log in again in the Edge window.", flush=True)
        GO_FILE.unlink(missing_ok=True)
        wait_for_go(page)


def enrich_subject(page, subject: str, courses: list, problems: list) -> dict:
    subject_courses = [c for c in courses if c["subject"] == subject]
    our_sections = {s["class_number"]: (c, s) for c in subject_courses for s in c["sections"]}
    levels = sorted({c["number"][0] + "000" for c in subject_courses}) or DEFAULT_LEVELS

    links, titles, empty_levels = [], {}, []
    for level in levels:
        url = f"{DMS}/secure/course_listing.cfm?search_subject_value={subject}&course_level={level}&command=SEARCH_Subject"
        print(f"  list {subject} {level}", flush=True)
        found, level_titles = parse_listing(open_page(page, url))
        if not found:
            empty_levels.append(level)
        titles.update(level_titles)
        for key, href in found:
            if key not in {k for k, _ in links}:
                links.append((key, urljoin(f"{DMS}/secure/", href)))
    if empty_levels and len(empty_levels) == len(levels):
        problems.append(f"{subject}: no courses found at any level - is the subject code right in DMS?")

    dms_sections = {}
    for i, (key, url) in enumerate(links, 1):
        print(f"  details {i}/{len(links)} {key}", flush=True)
        dms_sections.update(parse_details(open_page(page, url), problems, set(titles)))

    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    stats = {"dms_sections": len(dms_sections), "matched": 0, "added": 0, "no_code": [],
             "code_checked": 0, "code_mismatch": [], "public_not_in_dms": [], "empty_levels": empty_levels}
    by_code = {c["code"]: c for c in subject_courses}

    for class_nbr, info in sorted(dms_sections.items()):
        number = info["course_number"]
        if class_nbr in our_sections:
            course, section = our_sections[class_nbr]
            # Check our code-finding against the public timetable's real code.
            if number is not None:
                stats["code_checked"] += 1
                if f"{course['number']}{course['suffix']}" != number:
                    stats["code_mismatch"].append(f"{class_nbr}: public {course['code']} vs DMS {number}")
            for field in ("instructors", "meetings", "credit_units", "waitlist"):
                section[field] = info[field]
            section["data_source"] = "dms"
            section["dms_updated"] = now
            stats["matched"] += 1
            continue

        if number is None:
            stats["no_code"].append(class_nbr)
            continue
        code = f"{subject} {number}"
        course = by_code.get(code)
        if course is None:
            listed = titles.get(number, {})
            course = {
                "code": code, "subject": subject, "number": number[:4], "suffix": number[4:],
                "title": listed.get("title", ""), "term": term_from_suffix(number[4:]),
                "description": listed.get("description", ""), "sections": [], "data_source": "dms",
            }
            courses.append(course)
            by_code[code] = course
        course["sections"].append(new_section(class_nbr, info, now))
        stats["added"] += 1

    stats["public_not_in_dms"] = sorted(set(our_sections) - set(dms_sections))
    return stats


def main():
    from playwright.sync_api import sync_playwright  # imported here so tests don't need a browser

    parser = argparse.ArgumentParser()
    parser.add_argument("--subject", action="append", help="subject code, e.g. COMPSCI (repeatable)")
    subjects = parser.parse_args().subject or ["COMPSCI"]

    data = json.loads(COURSES_FILE.read_text(encoding="utf-8"))
    has_public = {c["subject"] for c in data["courses"]}
    # Subjects we can check against public data go first, as a safety test.
    subjects.sort(key=lambda s: s not in has_public)

    LOG_DIR.mkdir(exist_ok=True)
    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    GO_FILE.unlink(missing_ok=True)

    report = {"problems": [], "subjects": {}}
    with sync_playwright() as p:
        browser = p.chromium.launch_persistent_context(
            str(PROFILE_DIR), channel="msedge", headless=False, viewport={"width": 1280, "height": 860}
        )
        page = browser.pages[0] if browser.pages else browser.new_page()
        page.goto(f"{DMS}/")
        wait_for_go(page)

        for subject in subjects:
            print(f"Subject {subject}", flush=True)
            stats = enrich_subject(page, subject, data["courses"], report["problems"])
            report["subjects"][subject] = stats
            data["courses"].sort(key=lambda c: (c["subject"], c["number"], c["suffix"]))
            data["dms_last_updated"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
            COURSES_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")  # save progress
            print(f"  DMS sections {stats['dms_sections']}, matched {stats['matched']}, added {stats['added']}, "
                  f"code mismatches {len(stats['code_mismatch'])}/{stats['code_checked']}", flush=True)

            if stats["code_checked"] and len(stats["code_mismatch"]) > MAX_CODE_MISMATCH * stats["code_checked"]:
                print(f"\nSTOPPING: course codes were wrong for {len(stats['code_mismatch'])} of "
                      f"{stats['code_checked']} {subject} sections, so codes for new subjects can't be trusted.")
                break

        browser.close()

    (LOG_DIR / "dms_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print_summary(report, data)


def print_summary(report: dict, data: dict):
    print("\n========================== DMS SUMMARY ==========================")
    print(f"{'Subject':10} {'In DMS':>7} {'Matched':>8} {'Added':>6} {'No code':>8} {'Public, not in DMS':>19} {'Code errors':>12}")
    totals = [0] * 6
    for subject, s in report["subjects"].items():
        row = [s["dms_sections"], s["matched"], s["added"], len(s["no_code"]),
               len(s["public_not_in_dms"]), len(s["code_mismatch"])]
        totals = [a + b for a, b in zip(totals, row)]
        print(f"{subject:10} {row[0]:>7} {row[1]:>8} {row[2]:>6} {row[3]:>8} {row[4]:>19} {row[5]:>12}")
    print(f"{'TOTAL':10} {totals[0]:>7} {totals[1]:>8} {totals[2]:>6} {totals[3]:>8} {totals[4]:>19} {totals[5]:>12}")

    all_sections = [s for c in data["courses"] for s in c["sections"]]
    with_times = sum(1 for s in all_sections if s["data_source"] == "dms")
    print(f"\nWhole file: {with_times} of {len(all_sections)} sections have DMS data; "
          f"the rest will show 'Times not available yet'.")
    print(f"Parse problems: {len(report['problems'])}")
    for problem in report["problems"][:30]:
        print("  -", problem)
    print("Full report: .dms-logs/dms_report.json")


if __name__ == "__main__":
    main()
