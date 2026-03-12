import argparse
import json
import re
import time
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import requests
from bs4 import BeautifulSoup

from term_utils import term_code_from_date, today_in_tz


BASE = "https://suis.sabanciuniv.edu/prod"
DYN_SCHED_URL = f"{BASE}/bwckschd.p_disp_dyn_sched"
PROC_TERM_URL = f"{BASE}/bwckgens.p_proc_term_date"
SEARCH_URL = f"{BASE}/bwckschd.p_get_crse_unsec"


def _parse_float(s: str) -> float:
    try:
        return float(str(s).strip())
    except Exception:
        return 0.0


def _clock_to_minutes(token: str) -> Optional[int]:
    t = str(token).strip().lower()
    if not t:
        return None
    m = re.match(r"^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$", t)
    if not m:
        return None
    hh = int(m.group(1))
    mm = int(m.group(2) or "0")
    ap = m.group(3) or ""
    if ap == "am":
        if hh == 12:
            hh = 0
    elif ap == "pm":
        if hh != 12:
            hh += 12
    return hh * 60 + mm


def _parse_time_range_to_minutes(time_str: str) -> Tuple[Optional[int], Optional[int]]:
    s = str(time_str or "").strip()
    if not s or re.search(r"\bTBA\b", s, re.I):
        return None, None
    parts = [p.strip() for p in s.split("-")]
    if len(parts) < 2:
        return None, None
    start = _clock_to_minutes(parts[0])
    end = _clock_to_minutes(parts[1])
    return start, end


def _norm_course_id(subj: str, numb: str) -> str:
    return f"{subj}{numb}".upper().replace(" ", "")


def _extract_term_code_from_dyn_sched(html: str) -> Optional[str]:
    codes = _extract_term_codes_from_dyn_sched(html)
    return codes[0] if codes else None


def _extract_term_codes_from_dyn_sched(html: str) -> List[str]:
    soup = BeautifulSoup(html, "lxml")
    sel = soup.select_one("select#term_input_id")
    if not sel:
        return []
    out: List[str] = []
    for opt in sel.select("option"):
        val = (opt.get("value") or "").strip()
        if re.fullmatch(r"\d{6}", val or ""):
            out.append(val)
    return out


def _resolve_terms_to_scrape(explicit_term: str, explicit_terms: str, *, timeout: float) -> List[str]:
    if explicit_term:
        return [explicit_term]

    if explicit_terms:
        out: List[str] = []
        for part in explicit_terms.split(","):
            code = str(part or "").strip()
            if not code:
                continue
            if not re.fullmatch(r"\d{6}", code):
                raise ValueError(f"Invalid term code: {code!r}")
            out.append(code)
        if not out:
            raise ValueError("No valid term codes were provided in --terms.")
        return out

    sess = requests.Session()
    dyn_html = _fetch_with_retry(sess, "GET", DYN_SCHED_URL, timeout=timeout)
    available_terms = _extract_term_codes_from_dyn_sched(dyn_html)
    if not available_terms:
        raise RuntimeError("Could not determine available term codes from dynamic schedule page.")

    current_term = term_code_from_date(today_in_tz())
    terms = sorted((code for code in available_terms if code >= current_term), key=int)
    if terms:
        return terms

    fallback = _extract_term_code_from_dyn_sched(dyn_html)
    return [fallback] if fallback else []


def _fetch_with_retry(
    sess: requests.Session,
    method: str,
    url: str,
    *,
    data: Optional[Iterable[Tuple[str, str]]] = None,
    timeout: float = 30.0,
    retries: int = 4,
    backoff_s: float = 1.0,
) -> str:
    last_err: Optional[Exception] = None
    for i in range(retries + 1):
        try:
            if method.upper() == "GET":
                resp = sess.get(url, timeout=timeout)
            else:
                resp = sess.post(url, data=data, timeout=timeout)
            resp.raise_for_status()
            return resp.text
        except Exception as e:
            last_err = e
            sleep_s = backoff_s * (2**i)
            time.sleep(min(8.0, sleep_s))
    raise RuntimeError(f"Failed to fetch {url}: {last_err}")


def _parse_subject_codes_from_search(html: str) -> List[str]:
    soup = BeautifulSoup(html, "lxml")
    sel = soup.select_one("select#subj_id")
    if not sel:
        return []
    out = []
    for opt in sel.select("option"):
        val = (opt.get("value") or "").strip()
        if val and re.fullmatch(r"[A-Z0-9]{1,6}", val):
            out.append(val)
    return out


def _parse_sections_from_listing(html: str) -> List[Dict[str, Any]]:
    soup = BeautifulSoup(html, "lxml")
    sections_table = None
    for t in soup.select("table.datadisplaytable"):
        cap = t.find("caption")
        if cap and "Sections Found" in cap.get_text(" ", strip=True):
            sections_table = t
            break
    if not sections_table:
        return []

    # Banner sometimes omits explicit <tbody>. Collect only the rows whose
    # nearest table ancestor is this "Sections Found" table (exclude nested
    # meeting-time tables).
    rows = []
    for tr in sections_table.find_all("tr"):
        parent_table = tr.find_parent("table")
        if parent_table is sections_table:
            rows.append(tr)

    out: List[Dict[str, Any]] = []

    def parse_header_text(text: str) -> Optional[Tuple[str, str, str, str]]:
        # "<title> - <crn> - <SUBJ> <NUMB> - <SECTION>"
        parts = [p.strip() for p in text.split(" - ")]
        if len(parts) < 4:
            return None
        section = parts[-1]
        course_part = parts[-2]  # "CS 201" or "CS 201R"
        crn = parts[-3]
        title = " - ".join(parts[:-3]).strip()
        # Course numbers are usually 3 digits (e.g., CS 201 / CS 201R) but some
        # programs use 4–5 digits (e.g., CS 48004 in the dynamic schedule).
        m = re.match(r"^([A-Z0-9]+)\s+([0-9]{3,5}[A-Z0-9]?)$", course_part.strip().upper())
        if not m:
            return None
        course_id = _norm_course_id(m.group(1), m.group(2))
        return title, crn, course_id, section

    for i in range(len(rows) - 1):
        th = rows[i].find("th", class_="ddlabel")
        if not th:
            continue
        a = th.find("a")
        if not a:
            continue
        header_text = a.get_text(" ", strip=True)
        parsed = parse_header_text(header_text)
        if not parsed:
            continue
        title, crn, course_id, section = parsed

        td = rows[i + 1].find("td", class_="dddefault")
        if not td:
            continue

        # Component like "Lecture Schedule Type" / "Recitation Schedule Type"
        component = ""
        comp_m = re.search(r"\b([A-Za-z]+)\s+Schedule Type\b", td.get_text(" ", strip=True))
        if comp_m:
            component = comp_m.group(1).strip()

        # Credits like "3.000 Credits"
        credits = 0.0
        cred_m = re.search(r"(\d+(?:\.\d+)?)\s+Credits\b", td.get_text(" ", strip=True))
        if cred_m:
            credits = _parse_float(cred_m.group(1))

        meetings: List[Dict[str, Any]] = []
        mt = None
        for t in td.select("table.datadisplaytable"):
            cap = t.find("caption")
            if cap and "Scheduled Meeting Times" in cap.get_text(" ", strip=True):
                mt = t
                break
        if mt:
            mt_rows = mt.select("tr")
            # skip header row(s)
            for r in mt_rows[1:]:
                cols = r.find_all("td")
                if len(cols) < 7:
                    continue
                time_s = cols[1].get_text(" ", strip=True)
                days_s = cols[2].get_text(" ", strip=True)
                where_s = cols[3].get_text(" ", strip=True)
                date_range_s = cols[4].get_text(" ", strip=True)
                instr_s = cols[6].get_text(" ", strip=True)
                start_min, end_min = _parse_time_range_to_minutes(time_s)
                meetings.append(
                    {
                        "time": time_s,
                        "days": days_s,
                        "where": where_s,
                        "date_range": date_range_s,
                        "instructors": instr_s,
                        "start_min": start_min,
                        "end_min": end_min,
                    }
                )

        href = a.get("href") or ""
        if href and href.startswith("/"):
            href = BASE + href
        out.append(
            {
                "course_id": course_id,
                "title": title,
                "crn": crn,
                "section": section,
                "component": component,
                "credits": credits,
                "meetings": meetings,
                "source_url": href,
            }
        )

    return out


def write_jsonl(path: Path, rows: Iterable[Dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def scrape_term_schedule(
    term: str,
    *,
    timeout: float,
    delay_s: float,
    max_subjects: Optional[int],
) -> List[Dict[str, Any]]:
    sess = requests.Session()
    sess.headers.update(
        {
            "User-Agent": "Mozilla/5.0 (compatible; SUrriculum/3.0; +https://github.com/)",
        }
    )

    dyn_html = _fetch_with_retry(sess, "GET", DYN_SCHED_URL, timeout=timeout)
    if not term:
        term = _extract_term_code_from_dyn_sched(dyn_html) or term
    if not term:
        raise RuntimeError("Could not determine term code.")

    # Establish a term-bound session. Banner commonly expects this step and
    # returns the search form for the selected term.
    search_html = _fetch_with_retry(
        sess,
        "POST",
        PROC_TERM_URL,
        data=[("p_calling_proc", "bwckschd.p_disp_dyn_sched"), ("p_term", term)],
        timeout=timeout,
    )

    subjects = _parse_subject_codes_from_search(search_html)
    if not subjects:
        raise RuntimeError("Could not parse subject list from schedule search page.")
    if max_subjects is not None:
        subjects = subjects[: max_subjects]

    all_sections: List[Dict[str, Any]] = []
    for idx, subj in enumerate(subjects, start=1):
        print(f"[{idx}/{len(subjects)}] Fetching schedule listing for {subj}...")
        # Banner can return 500 errors if time fields are omitted; send a full
        # inclusive range by default (00:00–23:55).
        data: List[Tuple[str, str]] = [
            ("term_in", term),
            ("sel_subj", "dummy"),
            ("sel_subj", subj),
            ("sel_day", "dummy"),
            ("sel_schd", "dummy"),
            ("sel_insm", "dummy"),
            ("sel_camp", "dummy"),
            ("sel_levl", "dummy"),
            ("sel_sess", "dummy"),
            ("sel_instr", "dummy"),
            ("sel_ptrm", "dummy"),
            ("sel_attr", "dummy"),
            ("sel_crse", ""),
            ("sel_title", ""),
            ("sel_from_cred", ""),
            ("sel_to_cred", ""),
            ("begin_hh", "0"),
            ("begin_mi", "0"),
            ("begin_ap", "a"),
            ("end_hh", "11"),
            ("end_mi", "55"),
            ("end_ap", "p"),
        ]
        try:
            html = _fetch_with_retry(sess, "POST", SEARCH_URL, data=data, timeout=timeout)
            rows = _parse_sections_from_listing(html)
            for r in rows:
                r["term"] = term
                r["subject"] = subj
            all_sections.extend(rows)
        except Exception as e:
            # Avoid aborting the entire scrape due to transient server errors.
            print(f"Warning: failed to fetch {subj}: {e}")
        if delay_s:
            time.sleep(delay_s)

    return all_sections


def parse_saved_listing_files(files: List[Path], term: Optional[str]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for p in files:
        html = p.read_text(encoding="utf-8", errors="ignore")
        rows = _parse_sections_from_listing(html)
        for r in rows:
            if term:
                r["term"] = term
            out.append(r)
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch schedule meeting times and write JSONL.")
    parser.add_argument("--term", default="", help="Single term code like 202502.")
    parser.add_argument(
        "--terms",
        default="",
        help="Comma-separated explicit term codes. If omitted, scrapes all available terms from the current term onward.",
    )
    parser.add_argument(
        "--out",
        default="",
        help="Output JSONL path. Only valid with a single scraped term. Default: courses/schedule/<term>.jsonl",
    )
    parser.add_argument("--timeout", type=float, default=30.0, help="HTTP timeout seconds.")
    parser.add_argument("--delay", type=float, default=0.5, help="Delay between subject requests (seconds).")
    parser.add_argument("--max-subjects", type=int, default=0, help="Limit subjects for testing (0 = no limit).")
    parser.add_argument(
        "--html",
        nargs="*",
        default=[],
        help="Parse saved 'Class Schedule Listing' HTML files instead of scraping.",
    )
    args = parser.parse_args()

    term = str(args.term or "").strip()
    terms_arg = str(args.terms or "").strip()
    max_subjects = args.max_subjects if args.max_subjects and args.max_subjects > 0 else None

    if args.html:
        if terms_arg:
            raise RuntimeError("--terms cannot be used with --html.")
        parsed_rows = parse_saved_listing_files([Path(x) for x in args.html], term or None)
        if not term:
            raise RuntimeError("--html requires --term so the output term is known.")
        terms_to_scrape = [term]
    else:
        terms_to_scrape = _resolve_terms_to_scrape(term, terms_arg, timeout=args.timeout)
        if not terms_to_scrape:
            raise RuntimeError("Missing term code(s).")

    if args.out and len(terms_to_scrape) != 1:
        raise RuntimeError("--out can only be used when scraping exactly one term.")

    for idx, resolved_term in enumerate(terms_to_scrape, start=1):
        if args.html:
            rows = parsed_rows
        else:
            print(f"[{idx}/{len(terms_to_scrape)}] Scraping term {resolved_term}...")
            rows = scrape_term_schedule(resolved_term, timeout=args.timeout, delay_s=args.delay, max_subjects=max_subjects)
        out_path = Path(args.out) if args.out else Path("courses") / "schedule" / f"{resolved_term}.jsonl"
        write_jsonl(out_path, rows)
        print(f"Wrote {len(rows)} sections to {out_path}")


if __name__ == "__main__":
    main()
