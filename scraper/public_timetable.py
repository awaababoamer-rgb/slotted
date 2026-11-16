"""
Scrapes Western's PUBLIC undergraduate timetable (no login needed) and saves
course data to data/courses.json.

The public timetable has: course code, title, term, section, component,
class number, status and notes. It does NOT have days, times, rooms or
instructors; dms_enrich.py fills those in later.

Usage:
    python scraper/public_timetable.py                 # Computer Science only
    python scraper/public_timetable.py --subject MATH  # another subject
"""

import argparse
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
from bs4 import BeautifulSoup

URL = "https://studentservices.uwo.ca/secure/Timetables/mastertt/ttindex.cfm"
USER_AGENT = "SlottedStudentProject/0.1 (independent student course planner for UWO students)"
DELAY_SECONDS = 2  # polite pause between requests

PROJECT_ROOT = Path(__file__).resolve().parent.parent
OUTPUT = PROJECT_ROOT / "data" / "courses.json"

# The letter after the course number says when the course runs.
FIRST_TERM = set("AFQRW")
SECOND_TERM = set("BGSTX")
OTHER_SESSION = set("YZ")  # "offered in other than a regular session"


def term_from_suffix(suffix: str) -> str:
    if suffix in ("", "E"):
        return "full_year"
    if suffix in FIRST_TERM:
        return "first_term"
    if suffix in SECOND_TERM:
        return "second_term"
    if suffix in OTHER_SESSION:
        return "other_session"
    return "unknown"


def clean(text: str) -> str:
    """Collapse runs of spaces/newlines into single spaces."""
    return re.sub(r"\s+", " ", text or "").strip()


def parse_subject_list(html: str) -> dict:
    """Read {code: name} from the Subject dropdown on the search page."""
    soup = BeautifulSoup(html, "html.parser")
    select = soup.find("select", attrs={"name": "subject"})
    subjects = {}
    for option in select.find_all("option") if select else []:
        code = option.get("value", "").strip()
        if code:  # skip "All Subjects" (empty value)
            # Options aren't closed in Western's HTML, so take only the first text bit.
            subjects[code] = clean(next(option.strings, ""))
    return subjects


def fetch_subject_list(session: requests.Session) -> dict:
    response = session.get(URL, timeout=60)
    response.raise_for_status()
    check_not_blocked(response.text)
    return parse_subject_list(response.text)


class BlockedError(Exception):
    """Western showed a CAPTCHA / bot check. We must stop, never work around it."""


def check_not_blocked(html: str):
    if re.search(r"captcha|bot attack", html, re.IGNORECASE):
        raise BlockedError("Western's timetable is showing a CAPTCHA (bot check). Stopping.")


def fetch_subject(session: requests.Session, subject: str) -> str:
    form = {
        "subject": subject, "Designation": "Any", "catalognbr": "",
        "CourseTime": "All", "Component": "All", "LocationCode": "Any",
        "command": "search",
    }
    response = session.post(URL, data=form, timeout=60)
    response.raise_for_status()
    check_not_blocked(response.text)
    return response.text


def parse_sections(table, problems: list, code: str) -> list:
    sections = {}
    for row in table.select("tbody tr"):
        cells = row.find_all("td", recursive=False)
        if len(cells) != 7:
            problems.append(f"{code}: row with {len(cells)} cells, expected 7")
            continue
        section, component, class_nbr = (clean(c.get_text()) for c in cells[:3])
        if not class_nbr.isdigit():
            problems.append(f"{code}: bad class number {class_nbr!r}")
            continue

        # The requisites cell holds notes, then "REQUISITES: ..." after a <b> tag.
        req_text = clean(cells[3].get_text(" "))
        notes, _, requisites = req_text.partition("REQUISITES:")
        status = clean(cells[4].get_text())

        # Western lists a section once per meeting time (with times hidden),
        # so the same class number can appear on several rows. Keep one.
        if class_nbr in sections:
            continue
        sections[class_nbr] = {
            "section": section,
            "component": component,  # LEC, LAB or TUT
            "class_number": int(class_nbr),
            "full": status.lower() == "full",
            "status": status,
            "campus": clean(cells[5].get_text()),
            "delivery": clean(cells[6].get_text()),
            "notes": clean(notes),
            "requisites": clean(requisites),
            # Filled in by dms_enrich.py:
            "instructors": [],
            "meetings": [],  # [{day, start, end, location}]
            "data_source": "public",
        }
    return list(sections.values())


def parse_courses(html: str, problems: list) -> list:
    soup = BeautifulSoup(html, "html.parser")
    courses = []
    for heading in soup.find_all("h4"):
        match = re.match(r"^([A-Z]+)\s+(\d{4})([A-Z]?)\s+-\s+(.+)$", clean(heading.get_text()))
        if not match:
            problems.append(f"Unrecognised course heading: {clean(heading.get_text())!r}")
            continue
        subject, number, suffix, title = match.groups()
        code = f"{subject} {number}{suffix}"

        table = heading.find_next("table")
        # Make sure the table belongs to THIS heading, not the next course.
        if table is None or table.find_previous("h4") is not heading:
            problems.append(f"{code}: no sections table")
            continue

        description = heading.find_next("p")
        desc_text = ""
        if description is not None and description.find_previous("h4") is heading:
            desc_text = clean(description.get_text()).removeprefix("Course Description:").strip()

        courses.append({
            "code": code,
            "subject": subject,
            "number": number,
            "suffix": suffix,
            "title": title.strip(),
            "term": term_from_suffix(suffix),
            "description": desc_text,
            "sections": parse_sections(table, problems, code),
        })
    return courses


def keep_dms_fields(new_courses: list, old_path: Path) -> int:
    """Re-running this scraper must not wipe times that dms_enrich.py added.
    Copy DMS fields from the old file onto matching class numbers."""
    if not old_path.exists():
        return 0
    old = json.loads(old_path.read_text(encoding="utf-8"))
    dms = {
        s["class_number"]: s
        for c in old.get("courses", []) for s in c["sections"]
        if s.get("data_source") == "dms"
    }
    kept = 0
    for course in new_courses:
        for section in course["sections"]:
            previous = dms.get(section["class_number"])
            if previous:
                for field in ("instructors", "meetings", "credit_units", "waitlist", "dms_updated", "data_source"):
                    if field in previous:
                        section[field] = previous[field]
                kept += 1
    return kept


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--subject", action="append", help="subject code, e.g. COMPSCI (repeatable)")
    parser.add_argument("--all", action="store_true", help="every subject in Western's subject list")
    args = parser.parse_args()

    session = requests.Session()
    session.headers["User-Agent"] = USER_AGENT

    subject_names = {}
    if args.all:
        subject_names = fetch_subject_list(session)
        subjects = list(subject_names)
        print(f"Found {len(subjects)} subjects")
    else:
        subjects = args.subject or ["COMPSCI"]

    problems, courses, failed_subjects = [], [], []
    for i, subject in enumerate(subjects, 1):
        time.sleep(DELAY_SECONDS)
        print(f"[{i}/{len(subjects)}] {subject}", flush=True)
        try:
            courses.extend(parse_courses(fetch_subject(session, subject), problems))
        except BlockedError as error:
            print(f"\n{error}\nNothing was saved; data/courses.json is unchanged.")
            raise SystemExit(2)
        except requests.RequestException as error:
            # One bad subject shouldn't stop the whole run.
            failed_subjects.append(subject)
            problems.append(f"{subject}: request failed ({error})")

    # Safety net: never replace good data with a much smaller result.
    if OUTPUT.exists():
        old_count = sum(len(c["sections"]) for c in json.loads(OUTPUT.read_text(encoding="utf-8"))["courses"])
        new_count = sum(len(c["sections"]) for c in courses)
        if new_count < old_count * 0.8:
            print(f"\nNew result has {new_count} sections but the saved file has {old_count}. "
                  "That looks wrong, so data/courses.json was NOT overwritten.")
            raise SystemExit(3)

    kept = keep_dms_fields(courses, OUTPUT)
    OUTPUT.parent.mkdir(exist_ok=True)
    output = {
        "last_updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "Western University public undergraduate timetable",
        "subjects": subject_names or {s: "" for s in subjects},
        "courses": courses,
    }
    OUTPUT.write_text(json.dumps(output, indent=2, ensure_ascii=False), encoding="utf-8")

    sections = sum(len(c["sections"]) for c in courses)
    with_courses = len({c["subject"] for c in courses})
    print(f"\nSubjects: {len(subjects)} ({with_courses} with courses, {len(failed_subjects)} failed)"
          f"  Courses: {len(courses)}  Sections: {sections}")
    print(f"Kept DMS times for {kept} sections from the previous file")
    print(f"Rows that failed to parse: {len(problems)}")
    for problem in problems[:20]:
        print("  -", problem)
    print(f"Saved to {OUTPUT.relative_to(PROJECT_ROOT)}")


if __name__ == "__main__":
    main()
