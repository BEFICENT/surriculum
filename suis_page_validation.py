"""Semantic validation shared by the SUIS degree-page scrapers.

SUIS can return a successful HTTP status and a complete-looking fallback
curriculum for an unavailable term.  The displayed ``Admit Term`` heading is
therefore part of the response identity, not optional presentation text.
"""

from __future__ import annotations

from typing import Any

from term_utils import term_name_from_code


class DegreePageTermMismatch(ValueError):
    """The response is not the requested term, despite being valid HTML."""


def validate_suis_term_code(term_code: Any) -> str:
    """Return a normalized YYYY01/02/03 code or reject it."""

    code = str(term_code or "").strip()
    if not term_name_from_code(code):
        raise ValueError(
            f"Invalid SUIS term code {term_code!r}; expected YYYY01, YYYY02, or YYYY03."
        )
    return code


def expected_admit_term_label(term_code: Any) -> str:
    code = validate_suis_term_code(term_code)
    return f"Admit Term: {term_name_from_code(code)}"


def displayed_admit_term_label(soup: Any) -> str:
    """Extract the normalized Admit Term heading from a parsed degree page."""

    for heading in soup.find_all("h3"):
        text = " ".join(heading.get_text(" ", strip=True).split())
        if text.lower().startswith("admit term"):
            return text
    return ""


def require_matching_admit_term(soup: Any, term_code: Any) -> str:
    """Reject missing, blank, or mismatched degree-page term headings."""

    code = validate_suis_term_code(term_code)
    expected = expected_admit_term_label(code)
    actual = displayed_admit_term_label(soup)
    if actual != expected:
        shown = actual or "<missing>"
        raise DegreePageTermMismatch(
            f"SUIS degree page term mismatch for {code}: expected {expected!r}, got {shown!r}."
        )
    return code
