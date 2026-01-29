from __future__ import annotations

import datetime as _dt
import re as _re
from typing import Iterable, List, Optional, Tuple

try:
    from zoneinfo import ZoneInfo as _ZoneInfo
except Exception:  # pragma: no cover
    _ZoneInfo = None


_TERM_SUFFIX = {"Fall": "01", "Spring": "02", "Summer": "03"}
_SUFFIX_ORDER = ["01", "02", "03"]


def today_in_tz(tz_name: str = "Europe/Istanbul") -> _dt.date:
    if _ZoneInfo is None:
        return _dt.date.today()
    try:
        return _dt.datetime.now(_ZoneInfo(tz_name)).date()
    except Exception:
        return _dt.date.today()


def term_name_from_date(d: _dt.date) -> str:
    """
    Mirror scripts/helper_functions.js:getCurrentTermNameFromDate.

    Rules:
    - Jan 1-19: Fall of (year-1)-(year)
    - Jan 20 - Jun 19: Spring of (year-1)-(year)
    - Jun 20 - Aug 31: Summer of (year-1)-(year)
    - Sep 1 - Dec 31: Fall of (year)-(year+1)
    """
    y = int(d.year)
    m = int(d.month)  # 1-12
    day = int(d.day)

    # Jan 1-19
    if m == 1 and day < 20:
        start = y - 1
        return f"Fall {start}-{start + 1}"

    # Jan 20 -> Jun 19
    if (m < 6) or (m == 6 and day < 20):
        start = y - 1
        return f"Spring {start}-{start + 1}"

    # Jun 20 -> Aug 31
    if m < 9:
        start = y - 1
        return f"Summer {start}-{start + 1}"

    # Sep -> Dec
    start = y
    return f"Fall {start}-{start + 1}"


def term_code_from_name(name: str) -> str:
    m = _re.search(r"(Fall|Spring|Summer)\s+(\d{4})-(\d{4})", str(name or ""))
    if not m:
        return ""
    term = m.group(1)
    year = m.group(2)
    suf = _TERM_SUFFIX.get(term, "")
    return f"{year}{suf}" if suf else ""


def term_code_from_date(d: _dt.date) -> str:
    return term_code_from_name(term_name_from_date(d))


def _parse_term_code(code: str) -> Optional[Tuple[int, str]]:
    c = str(code or "").strip()
    if not _re.fullmatch(r"\d{6}", c):
        return None
    year = int(c[:4])
    suf = c[4:]
    if suf not in _SUFFIX_ORDER:
        return None
    return year, suf


def generate_terms(
    *,
    start_year: int = 2019,
    through_term_code: str = "",
    through_date: Optional[_dt.date] = None,
    tz_name: str = "Europe/Istanbul",
) -> List[str]:
    """
    Generate term codes (YYYY01/02/03) starting at start_year up to the
    current term (inclusive) determined by date rules.

    If through_term_code is provided, it overrides through_date.
    """
    end_code = through_term_code.strip() if through_term_code else ""
    if end_code:
        parsed = _parse_term_code(end_code)
        if not parsed:
            raise ValueError(f"Invalid term code: {end_code!r}")
        end_year, end_suf = parsed
    else:
        d = through_date or today_in_tz(tz_name)
        parsed = _parse_term_code(term_code_from_date(d))
        if not parsed:
            raise RuntimeError("Failed to determine current term code from date.")
        end_year, end_suf = parsed

    start_year = int(start_year)
    if end_year < start_year:
        return []

    end_idx = _SUFFIX_ORDER.index(end_suf)
    out: List[str] = []
    for y in range(start_year, end_year + 1):
        suffixes = _SUFFIX_ORDER if y < end_year else _SUFFIX_ORDER[: end_idx + 1]
        for suf in suffixes:
            out.append(f"{y}{suf}")
    return out

