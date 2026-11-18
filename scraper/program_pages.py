"""
Helpers for Draft My Schedule's program pages (the course selection page after
choosing a program). Shared by the recorder and the importer.

Those pages also show PERSONAL details: a welcome line with the student's name
and student number, their admission info, and their own draft schedule. We only
ever keep the program section (title + Admission Requirements + Module/Program
Information) and redact anything personal that might still be inside it.
"""

import re

from bs4 import BeautifulSoup

GREETING = re.compile(r"\b(welcome|hello|hi),?\s+([A-Z][\w'\-]+(?:\s+[A-Z][\w'\-]+){0,3})", re.I)


def find_names(html: str) -> set[str]:
    """Words from the 'Welcome <name>!' line, so we can redact them anywhere."""
    text = BeautifulSoup(html, "html.parser").get_text(" ")
    names = set()
    for m in GREETING.finditer(text):
        names.update(w for w in m.group(2).split() if len(w) >= 2 and w != "[NAME]")
    return names


def redact(text: str, names: set[str]) -> str:
    for name in sorted(names, key=len, reverse=True):
        text = re.sub(rf"\b{re.escape(name)}\b", "[NAME]", text, flags=re.I)
    text = re.sub(r"\b\d{9}\b", "[STUDENT-ID]", text)
    text = re.sub(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}", "[EMAIL]", text)
    return text


def extract_program_section(html: str) -> str | None:
    """Return only the program part of the page, redacted; None if there's no program on it."""
    soup = BeautifulSoup(html, "html.parser")
    title = None
    for h3 in soup.find_all("h3"):
        if h3.find(class_=re.compile("glyphicons-book")):
            title = h3
            break
    if title is None:
        return None
    parts = [str(title)]
    # Everything after the title up to (and including) the Module/Program Information box.
    node = title.find_next_sibling()
    seen_module = False
    while node is not None:
        text = node.get_text(" ", strip=True) if hasattr(node, "get_text") else ""
        if node.name == "h3" and "Courses in your" in text:
            break  # the student's own draft schedule starts here: stop
        parts.append(str(node))
        if node.name == "h3" and "Module/Program Information" in text:
            seen_module = True
        elif seen_module and node.name == "div":
            break
        node = node.find_next_sibling()
    return redact("\n".join(parts), find_names(html))
