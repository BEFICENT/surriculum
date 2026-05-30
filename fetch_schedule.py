import argparse
import json
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

import requests
from bs4 import BeautifulSoup

from term_utils import generate_terms, term_code_from_date, today_in_tz


BASE = "https://suis.sabanciuniv.edu/prod"
DYN_SCHED_URL = f"{BASE}/bwckschd.p_disp_dyn_sched"
PROC_TERM_URL = f"{BASE}/bwckgens.p_proc_term_date"
SEARCH_URL = f"{BASE}/bwckschd.p_get_crse_unsec"
DETAIL_URL = f"{BASE}/bwckschd.p_disp_detail_sched"
SCHEDULE_DIR = Path("courses") / "schedule"
SUBJECT_MANIFEST_PATH = Path("courses") / "schedule_subjects.json"


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


def _build_detail_url(term: str, crn: str) -> str:
    term_s = str(term or "").strip()
    crn_s = str(crn or "").strip()
    if not term_s or not crn_s:
        return ""
    return f"{DETAIL_URL}?term_in={term_s}&crn_in={crn_s}"


def _term_sort_key(code: str) -> int:
    try:
        return int(str(code or "").strip())
    except Exception:
        return -1


def _term_suffix(code: str) -> str:
    raw = str(code or "").strip()
    return raw[4:] if len(raw) == 6 else ""


def _is_summer_term(code: str) -> bool:
    return _term_suffix(code) == "03"


def _advance_term_code(code: str, steps: int = 1) -> str:
    raw = _validate_term_code(code, arg_name="term code")
    year = int(raw[:4])
    suffix = raw[4:]
    order = ["01", "02", "03"]
    idx = order.index(suffix)
    remaining = max(0, int(steps))
    while remaining > 0:
        idx += 1
        if idx >= len(order):
            idx = 0
            year += 1
        remaining -= 1
    return f"{year}{order[idx]}"


def _iter_term_codes_forward(start_code: str) -> Iterable[str]:
    current = _validate_term_code(start_code, arg_name="start term code")
    while True:
        yield current
        current = _advance_term_code(current)


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


def _validate_term_code(code: str, *, arg_name: str) -> str:
    out = str(code or "").strip()
    if not re.fullmatch(r"\d{6}", out):
        raise ValueError(f"Invalid term code for {arg_name}: {code!r}")
    return out


def _resolve_range_terms(from_term: str, through_term: str) -> List[str]:
    start_code = _validate_term_code(from_term, arg_name="--from-term")
    end_code = _validate_term_code(through_term, arg_name="--through-term") if through_term else term_code_from_date(today_in_tz())
    if int(start_code) > int(end_code):
        raise ValueError("--from-term cannot be later than --through-term.")
    all_terms = generate_terms(start_year=int(start_code[:4]), through_term_code=end_code)
    return [code for code in all_terms if int(code) >= int(start_code)]


def _resolve_terms_to_scrape(
    explicit_term: str,
    explicit_terms: str,
    *,
    from_term: str,
    through_term: str,
    timeout: float,
) -> List[str]:
    if explicit_term:
        return [_validate_term_code(explicit_term, arg_name="--term")]

    if explicit_terms:
        out: List[str] = []
        for part in explicit_terms.split(","):
            code = str(part or "").strip()
            if not code:
                continue
            out.append(_validate_term_code(code, arg_name="--terms"))
        if not out:
            raise ValueError("No valid term codes were provided in --terms.")
        return out

    if from_term:
        return _resolve_range_terms(from_term, through_term)

    current_term = term_code_from_date(today_in_tz())
    return [_validate_term_code(current_term, arg_name="current term")]


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


def _normalize_subject_codes(values: Iterable[str]) -> List[str]:
    seen: Set[str] = set()
    out: List[str] = []
    for value in values:
        code = str(value or "").strip().upper()
        if not code or not re.fullmatch(r"[A-Z0-9]{1,6}", code):
            continue
        if code in seen:
            continue
        seen.add(code)
        out.append(code)
    out.sort()
    return out


def _empty_subject_manifest() -> Dict[str, Any]:
    return {
        "latest_known_term": "",
        "latest_known_non_summer_term": "",
        "latest_subjects": [],
        "latest_non_summer_subjects": [],
        "terms": {},
    }


def _load_subject_manifest() -> Dict[str, Any]:
    manifest = _empty_subject_manifest()
    if SUBJECT_MANIFEST_PATH.exists():
        try:
            loaded = json.loads(SUBJECT_MANIFEST_PATH.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                for key in manifest.keys():
                    if key in loaded:
                        manifest[key] = loaded.get(key, manifest[key])
                if not manifest.get("latest_known_term"):
                    manifest["latest_known_term"] = str(loaded.get("latest_visible_term") or "")
                if not manifest.get("latest_known_non_summer_term"):
                    manifest["latest_known_non_summer_term"] = str(loaded.get("latest_visible_non_summer_term") or "")
        except Exception:
            pass
    terms = manifest.get("terms")
    manifest["terms"] = terms if isinstance(terms, dict) else {}
    _seed_subject_manifest_from_schedule_files(manifest)
    _refresh_subject_manifest_summary(manifest)
    return manifest


def _seed_subject_manifest_from_schedule_files(manifest: Dict[str, Any]) -> None:
    terms = manifest.setdefault("terms", {})
    try:
        files = sorted(SCHEDULE_DIR.glob("*.jsonl"))
    except Exception:
        files = []
    for path in files:
        term = path.stem
        if not re.fullmatch(r"\d{6}", term):
            continue
        existing = terms.get(term)
        if isinstance(existing, list) and existing:
            continue
        subjects: Set[str] = set()
        try:
            for line in path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line:
                    continue
                rec = json.loads(line)
                subj = str(rec.get("subject") or "").strip().upper()
                if subj and re.fullmatch(r"[A-Z0-9]{1,6}", subj):
                    subjects.add(subj)
        except Exception:
            continue
        if subjects:
            terms[term] = sorted(subjects)


def _refresh_subject_manifest_summary(manifest: Dict[str, Any]) -> None:
    terms = manifest.setdefault("terms", {})
    normalized_terms: Dict[str, List[str]] = {}
    for term, subjects in list(terms.items()):
        if not re.fullmatch(r"\d{6}", str(term or "").strip()):
            continue
        normalized = _normalize_subject_codes(subjects if isinstance(subjects, list) else [])
        if normalized:
            normalized_terms[str(term)] = normalized
    manifest["terms"] = normalized_terms

    sorted_terms = sorted(normalized_terms.keys(), key=_term_sort_key)
    manifest["latest_known_term"] = sorted_terms[-1] if sorted_terms else ""
    manifest["latest_subjects"] = normalized_terms.get(manifest["latest_known_term"], []) if sorted_terms else []

    non_summer_terms = [term for term in sorted_terms if not _is_summer_term(term)]
    manifest["latest_known_non_summer_term"] = non_summer_terms[-1] if non_summer_terms else ""
    manifest["latest_non_summer_subjects"] = (
        normalized_terms.get(manifest["latest_known_non_summer_term"], [])
        if non_summer_terms
        else []
    )


def _save_subject_manifest(manifest: Dict[str, Any]) -> None:
    _refresh_subject_manifest_summary(manifest)
    SUBJECT_MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "latest_known_term": manifest.get("latest_known_term", ""),
        "latest_known_non_summer_term": manifest.get("latest_known_non_summer_term", ""),
        "latest_subjects": manifest.get("latest_subjects", []),
        "latest_non_summer_subjects": manifest.get("latest_non_summer_subjects", []),
        "terms": manifest.get("terms", {}),
    }
    SUBJECT_MANIFEST_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _record_subject_manifest_entry(manifest: Dict[str, Any], term: str, subjects: Iterable[str]) -> None:
    existing = []
    try:
        existing = manifest.setdefault("terms", {}).get(term, [])
    except Exception:
        existing = []
    normalized = _normalize_subject_codes([*list(existing or []), *list(subjects or [])])
    if not normalized:
        return
    manifest.setdefault("terms", {})[term] = normalized
    _refresh_subject_manifest_summary(manifest)


def _resolve_subjects_for_term(term: str, manifest: Dict[str, Any], current_term_code: str = "") -> Tuple[List[str], str]:
    terms = manifest.get("terms") if isinstance(manifest.get("terms"), dict) else {}
    is_future_term = False
    try:
        if current_term_code and re.fullmatch(r"\d{6}", str(current_term_code or "").strip()):
            is_future_term = _term_sort_key(term) > _term_sort_key(current_term_code)
    except Exception:
        is_future_term = False

    exact = _normalize_subject_codes(terms.get(term, []))
    if exact and not is_future_term:
        return exact, f"manifest:{term}"

    candidate_terms = []
    for code in terms.keys():
        if not re.fullmatch(r"\d{6}", str(code or "").strip()):
            continue
        if _term_sort_key(code) >= _term_sort_key(term):
            continue
        if is_future_term and current_term_code and _term_sort_key(code) > _term_sort_key(current_term_code):
            continue
        candidate_terms.append(code)
    sorted_terms = sorted(candidate_terms, key=_term_sort_key, reverse=True)
    for code in sorted_terms:
        if _is_summer_term(code):
            continue
        subjects = _normalize_subject_codes(terms.get(code, []))
        if subjects:
            return subjects, f"fallback:{code}"

    latest_non_summer = _normalize_subject_codes(manifest.get("latest_non_summer_subjects", []))
    if latest_non_summer:
        source_term = str(manifest.get("latest_known_non_summer_term") or "latest_non_summer")
        return latest_non_summer, f"fallback:{source_term}"

    if exact:
        return exact, f"manifest:{term}"

    for code in sorted_terms:
        subjects = _normalize_subject_codes(terms.get(code, []))
        if subjects:
            return subjects, f"fallback:{code}"

    latest_any = _normalize_subject_codes(manifest.get("latest_subjects", []))
    if latest_any:
        source_term = str(manifest.get("latest_known_term") or "latest")
        return latest_any, f"fallback:{source_term}"

    return [], ""


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
    subject_manifest: Optional[Dict[str, Any]] = None,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
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

    live_subjects = _parse_subject_codes_from_search(search_html)
    live_subjects = _normalize_subject_codes(live_subjects)
    subject_source = "live"
    subjects = live_subjects
    if not subjects:
        subjects, subject_source = _resolve_subjects_for_term(
            term,
            subject_manifest or {},
            current_term_code=term_code_from_date(today_in_tz()),
        )
    if not subjects:
        raise RuntimeError("Could not determine subject list from schedule search page or local manifest.")
    subject_list_was_truncated = False
    if max_subjects is not None:
        subject_list_was_truncated = len(subjects) > max_subjects
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
                r["source_url"] = _build_detail_url(term, r.get("crn", ""))
            all_sections.extend(rows)
        except Exception as e:
            # Avoid aborting the entire scrape due to transient server errors.
            print(f"Warning: failed to fetch {subj}: {e}")
        if delay_s:
            time.sleep(delay_s)

    meta = {
        "term": term,
        "subjects": subjects,
        "live_subjects": live_subjects,
        "subject_source": subject_source,
        "used_fallback_subjects": subject_source != "live",
        "had_live_subjects": bool(live_subjects),
        "subject_list_was_truncated": subject_list_was_truncated,
        "section_count": len(all_sections),
    }
    return all_sections, meta


def parse_saved_listing_files(files: List[Path], term: Optional[str]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for p in files:
        html = p.read_text(encoding="utf-8", errors="ignore")
        rows = _parse_sections_from_listing(html)
        for r in rows:
            if term:
                r["term"] = term
                r["source_url"] = _build_detail_url(term, r.get("crn", ""))
            out.append(r)
    return out


def _is_schedule_output_path(path: Path) -> bool:
    try:
        rel = path.resolve().relative_to(SCHEDULE_DIR.resolve())
        return rel.suffix.lower() == ".jsonl"
    except Exception:
        return False


def rebuild_instructor_history() -> None:
    script_path = Path(__file__).with_name("build_course_instructor_history.py")
    subprocess.run([sys.executable, str(script_path)], check=True)


def rebuild_section_history(
    terms: Iterable[str],
    *,
    refresh: bool = True,
    crn_pairs: Optional[Iterable[Tuple[str, str]]] = None,
) -> None:
    requested_terms = sorted({str(term or "").strip() for term in terms if re.fullmatch(r"\d{6}", str(term or "").strip())})
    if not requested_terms:
        print("Skipping course section history: no valid terms requested.", flush=True)
        return
    script_path = Path(__file__).with_name("build_course_section_history.py")
    cmd = [sys.executable, str(script_path), "--terms", ",".join(requested_terms)]
    if refresh:
        cmd.append("--refresh")
    pairs: List[Tuple[str, str]] = []
    if crn_pairs:
        pairs = sorted(
            {
                (str(term or "").strip(), str(crn or "").strip())
                for term, crn in crn_pairs
                if re.fullmatch(r"\d{6}", str(term or "").strip()) and str(crn or "").strip()
            }
        )
        if pairs:
            cmd.extend(["--crns", ",".join(f"{term}:{crn}" for term, crn in pairs)])
    print(
        "Course section history command: "
        f"terms={','.join(requested_terms)} refresh={refresh} crn_filter={len(pairs)}",
        flush=True,
    )
    subprocess.run(cmd, check=True)


def _primary_section_signature(row: Dict[str, Any]) -> Optional[Tuple[str, str]]:
    try:
        crn = str(row.get("crn") or "").strip()
        if not crn:
            return None
        component = str(row.get("component") or "").strip().lower()
        if component in {"recitation", "lab", "laboratory"}:
            return None
        if _parse_float(row.get("credits")) <= 0:
            return None
        meetings = row.get("meetings") if isinstance(row.get("meetings"), list) else []
        normalized_meetings = []
        for meeting in meetings:
            if not isinstance(meeting, dict):
                continue
            normalized_meetings.append(
                {
                    "time": str(meeting.get("time") or "").strip(),
                    "days": str(meeting.get("days") or "").strip(),
                    "where": str(meeting.get("where") or "").strip(),
                    "date_range": str(meeting.get("date_range") or "").strip(),
                    "instructors": str(meeting.get("instructors") or "").strip(),
                }
            )
        signature = json.dumps(
            {
                "course_id": str(row.get("course_id") or "").strip(),
                "section": str(row.get("section") or "").strip(),
                "component": str(row.get("component") or "").strip(),
                "credits": _parse_float(row.get("credits")),
                "meetings": normalized_meetings,
            },
            ensure_ascii=False,
            sort_keys=True,
        )
        return crn, signature
    except Exception:
        return None


def _primary_section_signatures(rows: Iterable[Dict[str, Any]]) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for row in rows:
        item = _primary_section_signature(row)
        if not item:
            continue
        crn, signature = item
        out[crn] = signature
    return out


def _read_schedule_jsonl(path: Path) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    if not path.exists():
        return rows
    for line in path.read_text(encoding="utf-8").splitlines():
        raw = line.strip()
        if not raw:
            continue
        try:
            obj = json.loads(raw)
        except Exception:
            continue
        if isinstance(obj, dict):
            rows.append(obj)
    return rows


def _changed_primary_crns(old_rows: Iterable[Dict[str, Any]], new_rows: Iterable[Dict[str, Any]]) -> Set[str]:
    old = _primary_section_signatures(old_rows)
    new = _primary_section_signatures(new_rows)
    changed: Set[str] = set()
    for crn, signature in new.items():
        if old.get(crn) != signature:
            changed.add(crn)
    return changed


def _write_rows_if_nonempty(path: Path, rows: List[Dict[str, Any]]) -> bool:
    if not rows:
        return False
    write_jsonl(path, rows)
    return True


def scrape_terms_forward(
    start_term: str,
    *,
    timeout: float,
    delay_s: float,
    max_subjects: Optional[int],
    subject_manifest: Dict[str, Any],
    stop_after_empty_terms: int = 2,
) -> Tuple[List[Tuple[str, List[Dict[str, Any]], Dict[str, Any]]], Dict[str, Any]]:
    current_term = _validate_term_code(start_term, arg_name="start term code")
    consecutive_empty = 0
    results: List[Tuple[str, List[Dict[str, Any]], Dict[str, Any]]] = []
    for term in _iter_term_codes_forward(current_term):
        print(f"[auto] Scraping term {term}...")
        try:
            rows, meta = scrape_term_schedule(
                term,
                timeout=timeout,
                delay_s=delay_s,
                max_subjects=max_subjects,
                subject_manifest=subject_manifest,
            )
        except Exception as e:
            print(f"Warning: failed to scrape term {term}: {e}")
            rows = []
            meta = {
                "term": term,
                "subjects": [],
                "live_subjects": [],
                "subject_source": "",
                "used_fallback_subjects": False,
                "had_live_subjects": False,
                "section_count": 0,
                "error": str(e),
            }

        if meta.get("had_live_subjects"):
            _record_subject_manifest_entry(subject_manifest, term, meta.get("live_subjects", []))
        elif rows and not meta.get("subject_list_was_truncated"):
            _record_subject_manifest_entry(subject_manifest, term, meta.get("subjects", []))

        if rows:
            consecutive_empty = 0
            results.append((term, rows, meta))
            continue

        consecutive_empty += 1
        if consecutive_empty >= max(1, int(stop_after_empty_terms)):
            break
    return results, subject_manifest


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch schedule meeting times and write JSONL.")
    parser.add_argument("--term", default="", help="Single term code like 202502.")
    parser.add_argument(
        "--terms",
        default="",
        help="Comma-separated explicit term codes. If omitted, scrapes all available terms from the current term onward.",
    )
    parser.add_argument(
        "--from-term",
        default="",
        help="Inclusive start term code for manual backfills, e.g. 201901.",
    )
    parser.add_argument(
        "--through-term",
        default="",
        help="Inclusive end term code for manual backfills. Defaults to the current term.",
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
        "--future-stop-after",
        type=int,
        default=2,
        help="When auto-probing from the current term onward, stop after this many consecutive empty/unavailable terms.",
    )
    parser.add_argument(
        "--html",
        nargs="*",
        default=[],
        help="Parse saved 'Class Schedule Listing' HTML files instead of scraping.",
    )
    parser.add_argument(
        "--skip-instructor-history",
        action="store_true",
        help="Skip rebuilding courses/course_instructor_history.jsonl after schedule files are written.",
    )
    parser.add_argument(
        "--skip-section-history",
        action="store_true",
        help="Skip updating courses/course_section_history.jsonl after schedule files are written.",
    )
    parser.add_argument(
        "--section-history-mode",
        choices=("delta", "full", "skip"),
        default="delta",
        help="How to update section seat history after schedule writes.",
    )
    args = parser.parse_args()

    term = str(args.term or "").strip()
    terms_arg = str(args.terms or "").strip()
    from_term = str(args.from_term or "").strip()
    through_term = str(args.through_term or "").strip()
    max_subjects = args.max_subjects if args.max_subjects and args.max_subjects > 0 else None

    selection_flags = [bool(term), bool(terms_arg), bool(from_term)]
    if sum(selection_flags) > 1:
        raise RuntimeError("Use only one of --term, --terms, or --from-term.")
    if through_term and not from_term:
        raise RuntimeError("--through-term requires --from-term.")

    if args.html:
        if terms_arg or from_term or through_term:
            raise RuntimeError("--terms/--from-term/--through-term cannot be used with --html.")
        parsed_rows = parse_saved_listing_files([Path(x) for x in args.html], term or None)
        if not term:
            raise RuntimeError("--html requires --term so the output term is known.")
        terms_to_scrape = [term]
    else:
        terms_to_scrape = _resolve_terms_to_scrape(
            term,
            terms_arg,
            from_term=from_term,
            through_term=through_term,
            timeout=args.timeout,
        )
        if not terms_to_scrape:
            raise RuntimeError("Missing term code(s).")

    auto_forward_mode = not args.html and not term and not terms_arg and not from_term

    if args.out and (len(terms_to_scrape) != 1 or auto_forward_mode):
        raise RuntimeError("--out can only be used when scraping exactly one term.")

    written_paths: List[Path] = []
    changed_section_crns_by_term: Dict[str, Set[str]] = {}
    subject_manifest = _load_subject_manifest()

    if auto_forward_mode:
        scraped, subject_manifest = scrape_terms_forward(
            terms_to_scrape[0],
            timeout=args.timeout,
            delay_s=args.delay,
            max_subjects=max_subjects,
            subject_manifest=subject_manifest,
            stop_after_empty_terms=args.future_stop_after,
        )
        for resolved_term, rows, meta in scraped:
            out_path = SCHEDULE_DIR / f"{resolved_term}.jsonl"
            old_rows = _read_schedule_jsonl(out_path)
            if _write_rows_if_nonempty(out_path, rows):
                written_paths.append(out_path)
                changed_section_crns_by_term[resolved_term] = _changed_primary_crns(old_rows, rows)
                print(
                    f"Wrote {len(rows)} sections to {out_path}"
                    + (f" [{meta.get('subject_source')} subjects]" if meta.get("subject_source") else "")
                )
    else:
        for idx, resolved_term in enumerate(terms_to_scrape, start=1):
            if args.html:
                rows = parsed_rows
                meta = None
            else:
                print(f"[{idx}/{len(terms_to_scrape)}] Scraping term {resolved_term}...")
                rows, meta = scrape_term_schedule(
                    resolved_term,
                    timeout=args.timeout,
                    delay_s=args.delay,
                    max_subjects=max_subjects,
                    subject_manifest=subject_manifest,
                )
                if meta and meta.get("had_live_subjects"):
                    _record_subject_manifest_entry(subject_manifest, resolved_term, meta.get("live_subjects", []))
                elif meta and rows and not meta.get("subject_list_was_truncated"):
                    _record_subject_manifest_entry(subject_manifest, resolved_term, meta.get("subjects", []))
            out_path = Path(args.out) if args.out else SCHEDULE_DIR / f"{resolved_term}.jsonl"
            old_rows = _read_schedule_jsonl(out_path) if _is_schedule_output_path(out_path) else []
            if _write_rows_if_nonempty(out_path, rows):
                written_paths.append(out_path)
                if _is_schedule_output_path(out_path):
                    changed_section_crns_by_term[resolved_term] = _changed_primary_crns(old_rows, rows)
                print(f"Wrote {len(rows)} sections to {out_path}")
            else:
                print(f"Skipped writing empty schedule output for {resolved_term}")

    _save_subject_manifest(subject_manifest)

    should_rebuild_history = (
        not args.skip_instructor_history and any(_is_schedule_output_path(path) for path in written_paths)
    )
    if should_rebuild_history:
        print("Rebuilding course instructor history...")
        rebuild_instructor_history()

    should_rebuild_section_history = (
        not args.skip_section_history
        and args.section_history_mode != "skip"
        and any(_is_schedule_output_path(path) for path in written_paths)
    )
    if should_rebuild_section_history:
        written_terms = [path.stem for path in written_paths if _is_schedule_output_path(path)]
        print(
            f"Updating course section history: mode={args.section_history_mode} "
            f"terms={','.join(written_terms)}",
            flush=True,
        )
        if args.section_history_mode == "full":
            rebuild_section_history(written_terms, refresh=True)
        else:
            crn_pairs = [
                (term, crn)
                for term, crns in changed_section_crns_by_term.items()
                for crn in sorted(crns)
            ]
            print(
                f"Changed primary section CRNs detected for delta refresh: {len(crn_pairs)}",
                flush=True,
            )
            rebuild_section_history(written_terms, refresh=False, crn_pairs=crn_pairs)


if __name__ == "__main__":
    main()
