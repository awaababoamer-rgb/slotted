"""
Uploads data/courses.json into Supabase (tables: courses, sections, catalog_meta).
Run it after each scrape:

    python scraper/upload_to_supabase.py            # upload
    python scraper/upload_to_supabase.py --dry-run  # just show what would happen

It needs two values in the project's .env file (never committed to git):
    SUPABASE_URL=https://xxxx.supabase.co
    SUPABASE_SECRET_KEY=sb_secret_...     (or the legacy service_role key)

The secret key can bypass all security rules, so it lives ONLY in .env on the
computer that runs this script. Never put it in the website or in git.
"""

import argparse
import json
import sys
from pathlib import Path

import requests

PROJECT_ROOT = Path(__file__).resolve().parent.parent
COURSES_FILE = PROJECT_ROOT / "data" / "courses.json"
ENV_FILE = PROJECT_ROOT / ".env"
BATCH = 500


def read_env() -> dict:
    """Tiny .env reader (KEY=value lines), so we don't need another package."""
    values = {}
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, value = line.partition("=")
                values[key.strip()] = value.strip().strip('"').strip("'")
    return values


class Supabase:
    def __init__(self, url: str, key: str):
        self.base = url.rstrip("/") + "/rest/v1"
        self.session = requests.Session()
        self.session.headers["apikey"] = key
        if key.startswith("eyJ"):  # legacy JWT-style service_role key
            self.session.headers["Authorization"] = f"Bearer {key}"

    def upsert(self, table: str, rows: list, conflict: str):
        for i in range(0, len(rows), BATCH):
            chunk = rows[i:i + BATCH]
            r = self.session.post(
                f"{self.base}/{table}?on_conflict={conflict}",
                json=chunk,
                headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
                timeout=60,
            )
            if r.status_code >= 300:
                sys.exit(f"Upload to {table} failed ({r.status_code}): {r.text[:500]}")
            print(f"  {table}: {min(i + BATCH, len(rows))}/{len(rows)}")

    def all_ids(self, table: str, column: str) -> set:
        ids, start = set(), 0
        while True:
            r = self.session.get(
                f"{self.base}/{table}?select={column}",
                headers={"Range": f"{start}-{start + 999}"},
                timeout=60,
            )
            if r.status_code >= 300:
                sys.exit(f"Reading {table} failed ({r.status_code}): {r.text[:500]}")
            rows = r.json()
            ids.update(row[column] for row in rows)
            if len(rows) < 1000:
                return ids
            start += 1000

    def delete_in(self, table: str, column: str, values: list):
        for i in range(0, len(values), 200):
            chunk = values[i:i + 200]
            quoted = ",".join(json.dumps(v) for v in chunk)
            r = self.session.delete(f"{self.base}/{table}?{column}=in.({quoted})", timeout=60)
            if r.status_code >= 300:
                sys.exit(f"Delete from {table} failed ({r.status_code}): {r.text[:500]}")


def build_rows(data: dict):
    courses, sections = [], []
    for c in data["courses"]:
        courses.append({
            "code": c["code"], "subject": c["subject"], "number": c["number"],
            "suffix": c.get("suffix", ""), "title": c.get("title", ""),
            "term": c["term"], "description": c.get("description", ""),
        })
        for s in c["sections"]:
            waitlist = s.get("waitlist")
            sections.append({
                "class_number": s["class_number"], "course_code": c["code"],
                "section": s["section"], "component": s["component"],
                "full": bool(s.get("full")), "status": s.get("status", ""),
                "campus": s.get("campus", ""), "delivery": s.get("delivery", ""),
                "notes": s.get("notes", ""), "requisites": s.get("requisites", ""),
                "instructors": s.get("instructors", []), "meetings": s.get("meetings", []),
                "credit_units": s.get("credit_units") or None,
                "waitlist": waitlist if isinstance(waitlist, int) else None,
                "data_source": s.get("data_source", "public"),
                "dms_updated": s.get("dms_updated"),
            })
    return courses, sections


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    data = json.loads(COURSES_FILE.read_text(encoding="utf-8"))
    courses, sections = build_rows(data)
    print(f"Read {len(courses)} courses and {len(sections)} sections from {COURSES_FILE.relative_to(PROJECT_ROOT)}")
    if args.dry_run:
        print("Dry run: nothing uploaded.")
        return

    env = read_env()
    url, key = env.get("SUPABASE_URL"), env.get("SUPABASE_SECRET_KEY")
    if not url or not key:
        sys.exit("Missing SUPABASE_URL or SUPABASE_SECRET_KEY in .env (see .env.example).")
    db = Supabase(url, key)

    print("Uploading...")
    db.upsert("courses", courses, "code")
    db.upsert("sections", sections, "class_number")
    db.upsert("catalog_meta", [{
        "id": 1, "last_updated": data.get("last_updated"), "dms_last_updated": data.get("dms_last_updated"),
    }], "id")

    # Remove sections/courses that are no longer in the file (e.g. cancelled).
    stale_sections = sorted(db.all_ids("sections", "class_number") - {s["class_number"] for s in sections})
    stale_courses = sorted(db.all_ids("courses", "code") - {c["code"] for c in courses})
    if stale_sections:
        db.delete_in("sections", "class_number", stale_sections)
    if stale_courses:
        db.delete_in("courses", "code", stale_courses)
    print(f"Removed {len(stale_sections)} old sections and {len(stale_courses)} old courses.")
    print("Done.")


if __name__ == "__main__":
    main()
