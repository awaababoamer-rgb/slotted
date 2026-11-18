"""
Imports programs (degree modules) from Draft My Schedule pages that a student
BROWSED with the recorder running (scraper/dms_investigate.py). Nothing here
fetches anything from Western: it only reads the saved, already-redacted
.dms-logs/program_*.html files.

    python scraper/import_programs.py            # show what would be imported
    python scraper/import_programs.py --upload   # upload as DRAFT programs

Each requirement line like "0.5 course from: Computer Science 2214A/B, Mathematics 2155F/G"
becomes a group. A course that can be taken in either term ("2214A/B") is stored as
alternatives "COMPSCI 2214A|COMPSCI 2214B", so students add just one of them.
Anything that isn't a specific course ("courses at the 4000 level") is kept in the
group's title for the admin to read. Admins check every draft before publishing.
"""

import argparse
import json
import re
import sys
from pathlib import Path

from bs4 import BeautifulSoup

PROJECT_ROOT = Path(__file__).resolve().parent.parent
LOG_DIR = PROJECT_ROOT / ".dms-logs"
COURSES_FILE = PROJECT_ROOT / "data" / "courses.json"

YEAR_WORDS = {"first": 1, "second": 2, "third": 3, "fourth": 4}
COURSE_REF = re.compile(
    r"(?P<former>the former\s+)?"
    r"(?:(?P<subject>[A-Z][A-Za-z&']+(?:\s+(?:and\s+|&\s+)?[A-Z][A-Za-z&']+)*)\s+)?"
    r"(?P<number>\d{4})(?P<suffix>[A-Z](?:/[A-Z])*)(?!\s*level)"
)


def norm(name: str) -> str:
    return re.sub(r"\s+", " ", name.lower().replace("&", "and")).strip()


class SubjectMap:
    """'Computer Science' -> 'COMPSCI', using the subject names from the public timetable."""

    def __init__(self, subjects: dict[str, str]):
        self.items = [(norm(name), code) for code, name in subjects.items()]

    def code_for(self, name: str) -> str | None:
        n = norm(name)
        for public, code in self.items:
            if n == public:
                return code
        # The public list cuts long names at 30 characters ("Numerical & Mathematical Methd").
        for public, code in self.items:
            if len(public) >= 28 and n.startswith(public[:-1]):
                return code
        return None


def clean(text: str) -> str:
    return re.sub(r"\s+", " ", text.replace("\xa0", " ").replace("�", " ")).strip()


def parse_refs(text: str, subjects: SubjectMap, catalog: set[str]) -> tuple[list[str], list[str]]:
    """Course references in a list -> ['COMPSCI 2208A|COMPSCI 2208B', ...] plus unparsed bits."""
    entries, last_subject = [], None
    for m in COURSE_REF.finditer(text):
        subject_name = m.group("subject")
        # Strip leading filler words captured with the subject ("Or Biology" can't happen, but "From X" can).
        if subject_name:
            subject_name = re.sub(r"^(?:From|And|Or|Plus|Either)\s+", "", subject_name)
        code = subjects.code_for(subject_name) if subject_name else last_subject
        if subject_name and code:
            last_subject = code
        if m.group("former") or not code:
            continue
        variants = [f"{code} {m.group('number')}{s}" for s in m.group("suffix").split("/")]
        offered = [v for v in variants if v in catalog]
        entry = "|".join(offered or variants)
        if entry not in entries:
            entries.append(entry)
    # What's left once course references are removed, e.g. "Computer Science courses at the 4000 level".
    leftover = COURSE_REF.sub("", text)
    bits = [clean(b) for b in re.split(r"[,;]|\bor\b", leftover)]
    unparsed = [b for b in bits if re.search(r"\blevel\b|\bany\b|\bdesignation\b", b, re.I)]
    return entries, unparsed


LINE = re.compile(r"^(?P<credits>\d+(?:\.\d+)?)\s+courses?\b(?P<rest>.*)$", re.I)


def parse_line(line: str, subjects: SubjectMap, catalog: set[str], default_title: str = ""):
    line = clean(line)
    m = LINE.match(line)
    if not m or ":" not in line:
        return None
    credits = float(m.group("credits"))
    head, _, body = line.partition(":")
    year = re.search(r"normally taken in (first|second|third|fourth) year", head, re.I)
    is_choice = bool(re.search(r"\bfrom\b|additional", head, re.I))
    entries, unparsed = parse_refs(body, subjects, catalog)
    halves = max(1, round(credits / 0.5))
    if not entries and not unparsed:
        return None
    kind = "required" if (not is_choice and len(entries) == halves and not unparsed) else "choose"
    label = f"{credits:g} course{'s' if credits > 1 else ''}"
    if kind == "choose":
        label += " from"
    if year:
        label += f" (normally {year.group(1).lower()} year)"
    if default_title:
        label = f"{default_title}: {label}"
    if unparsed:
        label += f" - also counts: {'; '.join(unparsed)}"
    return {
        "kind": kind,
        "title": label[:160],
        # Never ask for more picks than there are listed courses (the admin can raise it).
        "choose_count": max(1, min(10, halves, len(entries) or halves)) if kind == "choose" else 1,
        "course_codes": entries,
        "year": YEAR_WORDS[year.group(1).lower()] if year else None,
    }


def parse_program(html: str, subjects: SubjectMap, catalog: set[str]) -> dict | None:
    soup = BeautifulSoup(html, "html.parser")
    title_el = soup.find("h3")
    if not title_el:
        return None
    title = clean(title_el.get_text(" "))
    full_name = re.sub(r"\s*\(.*?\)\s*$", "", title).strip()  # drop "(COMPUTER SCIENCE PROGRAM)"
    pretty = " ".join(w.capitalize() if w not in {"IN", "OF", "AND"} else w.lower() for w in full_name.split())
    short = re.sub(r"^(Honours Specialization|Specialization|Major|Minor|Honours Double Major)\s+in\s+", "", pretty, flags=re.I)

    groups = []
    sections = {"admission": None, "module": None}
    for h3 in soup.find_all("h3"):
        text = h3.get_text(" ")
        box = h3.find_next_sibling("div")
        if "Admission Requirements" in text:
            sections["admission"] = box
        elif "Module/Program Information" in text:
            sections["module"] = box

    for key, box in sections.items():
        if box is None:
            continue
        # Each requirement is a line; lines are separated by <br> or new paragraphs.
        for br in box.find_all("br"):
            br.replace_with("\n")
        lines = [ln for p in box.find_all("p") for ln in p.get_text("").split("\n")]
        for ln in lines:
            group = parse_line(ln, subjects, catalog, "First-year (admission)" if key == "admission" else "")
            if group:
                groups.append(group)

    if not groups:
        return None
    return {"name": pretty, "short_name": short[:40], "year": 2, "requirements": groups}


def load_programs() -> list[dict]:
    data = json.loads(COURSES_FILE.read_text(encoding="utf-8"))
    catalog = {c["code"] for c in data["courses"]}
    subjects = SubjectMap(data.get("subjects", {}))
    programs, seen = [], set()
    for f in sorted(LOG_DIR.glob("program_*.html"), key=lambda p: int(p.stem.split("_")[1])):
        program = parse_program(f.read_text(encoding="utf-8"), subjects, catalog)
        if program and program["name"] not in seen:
            seen.add(program["name"])
            programs.append(program)
    return programs


def upload(programs: list[dict]):
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from upload_to_supabase import Supabase, read_env  # same .env and secret key as the course upload

    env = read_env()
    if not env.get("SUPABASE_URL") or not env.get("SUPABASE_SECRET_KEY"):
        sys.exit("Missing SUPABASE_URL or SUPABASE_SECRET_KEY in .env")
    db = Supabase(env["SUPABASE_URL"], env["SUPABASE_SECRET_KEY"])
    for p in programs:
        r = db.session.get(f"{db.base}/programs", params={"select": "id", "name": f"eq.{p['name']}", "year": f"eq.{p['year']}"}, timeout=30)
        r.raise_for_status()
        if r.json():
            print(f"  skipped (already exists): {p['name']}")
            continue
        r = db.session.post(f"{db.base}/programs", json={
            "name": p["name"], "short_name": p["short_name"], "year": p["year"], "published": False,
            "description": "Imported from Draft My Schedule. Check against the Academic Calendar before publishing.",
        }, headers={"Prefer": "return=representation"}, timeout=30)
        if r.status_code >= 300:
            sys.exit(f"Couldn't create {p['name']}: {r.text[:300]}")
        program_id = r.json()[0]["id"]
        rows = [{
            "program_id": program_id, "kind": g["kind"], "title": g["title"], "choose_count": g["choose_count"],
            "course_codes": g["course_codes"], "sort_order": i,
        } for i, g in enumerate(p["requirements"])]
        r = db.session.post(f"{db.base}/program_requirements", json=rows, headers={"Prefer": "return=minimal"}, timeout=30)
        if r.status_code >= 300:
            sys.exit(f"Couldn't add requirements for {p['name']}: {r.text[:300]}")
        print(f"  uploaded as draft: {p['name']} ({len(rows)} groups)")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--upload", action="store_true", help="upload as draft programs (admins publish them)")
    args = parser.parse_args()
    programs = load_programs()
    for p in programs:
        print(f"\n{p['name']}  [short: {p['short_name']}]")
        for g in p["requirements"]:
            codes = ", ".join(c.replace("|", " or ") for c in g["course_codes"]) or "(no specific courses)"
            print(f"  - {g['kind']:8} {g['title']}\n      {codes}")
    print(f"\n{len(programs)} programs found in {LOG_DIR.name}/program_*.html")
    if args.upload:
        print("Uploading as drafts...")
        upload(programs)


if __name__ == "__main__":
    main()
