import argparse
import json
import os
import re
import random
import threading
import time
import concurrent.futures
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple
from urllib.parse import parse_qs, urljoin, urlparse

import requests
from bs4 import BeautifulSoup

BASE = "https://suis.sabanciuniv.edu/prod/"
LIST_URL = BASE + "SU_DEGREE.p_list_degree?P_LEVEL=UG&P_LANG=EN&P_PRG_TYPE=MINOR"

COURSES_DIR = os.path.join("courses", "minors")
REQUIREMENTS_LEGACY_PATH = os.path.join("requirements", "minors.jsonl")
REQUIREMENTS_DIR = os.path.join("requirements", "minors")
REQUIREMENTS_TERMS_MANIFEST = os.path.join(REQUIREMENTS_DIR, "terms.jsonl")

_tls = threading.local()
_net_semaphore = None
_http_timeout_s = 30.0
_http_retries = 2
_http_backoff_s = 0.5
_http_sleep_s = 0.0


@dataclass(frozen=True)
class MinorProgram:
    program: str
    name: str


def fetch_html(url: str, timeout: float = 30.0) -> str:
    # Use shared retry/throttle settings; keep signature for backward compat.
    global _http_timeout_s
    if timeout:
        _http_timeout_s = float(timeout)
    sess = getattr(_tls, "session", None)
    if sess is None:
        sess = requests.Session()
        sess.headers.update({"User-Agent": "surriculum-fetch/1.0 (+https://github.com/beficent/surriculum)"})
        _tls.session = sess

    last_err = None
    attempts = max(0, int(_http_retries)) + 1
    for attempt in range(attempts):
        try:
            if _net_semaphore is None:
                resp = sess.get(url, timeout=_http_timeout_s)
            else:
                with _net_semaphore:
                    resp = sess.get(url, timeout=_http_timeout_s)
            resp.raise_for_status()
            if _http_sleep_s and _http_sleep_s > 0:
                time.sleep(_http_sleep_s)
            return resp.text
        except Exception as e:
            last_err = e
            if attempt >= attempts - 1:
                raise
            sleep_for = float(_http_backoff_s) * (2**attempt) + random.uniform(0, 0.25)
            time.sleep(sleep_for)
    raise last_err


def parse_minor_list(html: str) -> List[MinorProgram]:
    soup = BeautifulSoup(html, "lxml")
    out: List[MinorProgram] = []
    for a in soup.select('a[href*="P_PROGRAM="]'):
        href = a.get("href") or ""
        m = re.search(r"P_PROGRAM=([^&]+)", href)
        if not m:
            continue
        program = m.group(1)
        name = a.get_text(strip=True)
        if program and name:
            out.append(MinorProgram(program=program, name=name))
    # Stable ordering for deterministic files
    out.sort(key=lambda p: p.program)
    return out


def map_anchor_to_category(name_attr: str) -> Optional[str]:
    if not name_attr:
        return None
    # Minor pages use the same anchor suffixes as majors.
    if name_attr.endswith("_REQ") or "_PHL" in name_attr or "_MEL" in name_attr:
        return "required"
    # Some minors use a generic "_ELEC" section name for electives.
    # In the summary table this typically corresponds to "Core" (or equivalent)
    # elective requirements, so we map it to "core".
    if name_attr.endswith("_ELEC"):
        return "core"
    if name_attr.endswith("_CEL") or "_COR" in name_attr or "_CE1" in name_attr or "_C1" in name_attr or "_CE2" in name_attr or "_C2" in name_attr:
        return "core"
    if name_attr.endswith("_ARE") or name_attr.endswith("_AEL"):
        return "area"
    if name_attr.endswith("_FRE") or name_attr.endswith("_FEL"):
        return "free"
    if name_attr == "UC_FENS" or name_attr == "UC_FASS":
        return "university"
    return None


def _find_course_table_after(anchor) -> Optional[BeautifulSoup]:
    # Look for the first table after the anchor that looks like a course table.
    # Some category description tables contain "(N courses)" which would
    # falsely match simple text heuristics, so we require real <th> headers.
    cur = anchor
    for _ in range(40):
        cur = cur.find_next()
        if not cur:
            break
        if getattr(cur, "name", None) != "table":
            continue
        ths = [th.get_text(" ", strip=True).lower() for th in cur.find_all("th")]
        if not ths:
            continue
        has_course = any("course" == t or t.startswith("course ") or " course" in t for t in ths)
        has_su = any("su" in t and "credit" in t for t in ths)
        has_ects = any("ects" in t for t in ths)
        if has_course and has_su and has_ects:
            return cur
    return None


def parse_course_rows(table, category: str) -> List[Dict]:
    rows: List[Dict] = []
    # These pages often omit <tbody>, so do not depend on tbody selectors.
    for tr in table.find_all("tr"):
        tds = tr.find_all("td")
        if len(tds) < 5:
            continue
        code_text = tds[1].get_text(" ", strip=True).replace("\xa0", " ")
        parts = [p for p in code_text.split() if p]
        if len(parts) < 2:
            continue
        subj = parts[0].strip().upper()
        numb = "".join(parts[1:]).strip()
        name = tds[2].get_text(" ", strip=True)
        ects = tds[3].get_text(" ", strip=True)
        su = tds[4].get_text(" ", strip=True)
        faculty = tds[5].get_text(" ", strip=True) if len(tds) > 5 else ""
        if not subj or not numb:
            continue
        rows.append(
            {
                "Major": subj,
                "Code": numb,
                "Course_Name": name,
                "ECTS": ects,
                "Engineering": 0,
                "Basic_Science": 0,
                "SU_credit": su,
                "Faculty": faculty,
                "EL_Type": category,
                "Faculty_Course": "No",
            }
        )
    return rows


def parse_course_rows_from_html(html: str, category: str) -> List[Dict]:
    soup = BeautifulSoup(html, "lxml")
    out: List[Dict] = []
    for table in soup.find_all("table"):
        parsed = parse_course_rows(table, category)
        if parsed:
            out.extend(parsed)
    return out


def _guess_linked_category(area_code: str, link_text: str) -> Optional[str]:
    cat = map_anchor_to_category(area_code or "")
    if cat:
        return cat
    low = (link_text or "").lower()
    if "required" in low:
        return "required"
    if "core" in low:
        return "core"
    if "area" in low:
        return "area"
    if "free" in low:
        return "free"
    return None


def _load_linked_course_page_html(
    href: str,
    program: str,
    category: str,
    offline_dir: Optional[str],
    timeout: float,
) -> str:
    if offline_dir:
        base = (program.split("-")[0] if program else "").strip().lower()
        area_code = ""
        try:
            area_code = (parse_qs(urlparse(href).query).get("P_AREA", [""])[0] or "").strip().lower()
        except Exception:
            area_code = ""
        area_tail = ""
        if "_" in area_code:
            area_tail = area_code.rsplit("_", 1)[-1]

        candidates = [
            f"SU_DEGREE_{base}_{category}coursepage.html",
            f"SU_DEGREE_{base}_{category}_coursepage.html",
        ]
        if area_tail:
            candidates.extend(
                [
                    f"SU_DEGREE_{base}_{area_tail}coursepage.html",
                    f"SU_DEGREE_{base}_{area_tail}_coursepage.html",
                ]
            )
        if area_code:
            candidates.extend(
                [
                    f"SU_DEGREE_{base}_{area_code}coursepage.html",
                    f"SU_DEGREE_{base}_{area_code}_coursepage.html",
                ]
            )

        for fname in candidates:
            path = os.path.join(offline_dir, fname)
            if os.path.exists(path):
                with open(path, "r", encoding="utf-8") as f:
                    return f.read()

        # Fuzzy fallback for manually saved file names.
        try:
            for fname in sorted(os.listdir(offline_dir)):
                low = fname.lower()
                if not low.endswith(".html"):
                    continue
                if base and base not in low:
                    continue
                if "coursepage" not in low and "list_courses" not in low:
                    continue
                if category in low or (area_tail and area_tail in low) or (area_code and area_code in low):
                    path = os.path.join(offline_dir, fname)
                    with open(path, "r", encoding="utf-8") as f:
                        return f.read()
        except Exception:
            pass
        raise FileNotFoundError(f"offline linked course page not found for {program} ({category})")

    full_url = href if href.lower().startswith("http") else urljoin(BASE, href)
    return fetch_html(full_url, timeout=timeout)


def parse_minor_courses(
    html: str,
    program: Optional[str] = None,
    offline_dir: Optional[str] = None,
    timeout: float = 30.0,
) -> List[Dict]:
    soup = BeautifulSoup(html, "lxml")
    results: List[Dict] = []
    seen = set()
    for a in soup.select("a[name]"):
        name_attr = a.get("name") or ""
        category = map_anchor_to_category(name_attr)
        if not category:
            continue
        table = _find_course_table_after(a)
        if not table:
            continue
        for rec in parse_course_rows(table, category):
            cid = f"{rec['Major']}{rec['Code']}"
            if cid in seen:
                continue
            seen.add(cid)
            results.append(rec)

    # Some minors place category lists (currently mostly area electives) on a
    # separate `SU_DEGREE.p_list_courses` page. Follow these links as well.
    linked_targets: List[Tuple[str, str]] = []
    linked_seen = set()
    for a in soup.select('a[href*="SU_DEGREE.p_list_courses"]'):
        href = (a.get("href") or "").strip()
        if not href:
            continue
        area_code = ""
        try:
            area_code = (parse_qs(urlparse(href).query).get("P_AREA", [""])[0] or "").strip()
        except Exception:
            area_code = ""
        category = _guess_linked_category(area_code, a.get_text(" ", strip=True))
        if not category:
            continue
        key = (category, href)
        if key in linked_seen:
            continue
        linked_seen.add(key)
        linked_targets.append(key)

    for category, href in linked_targets:
        try:
            linked_html = _load_linked_course_page_html(
                href=href,
                program=program or "",
                category=category,
                offline_dir=offline_dir,
                timeout=timeout,
            )
        except Exception:
            continue
        for rec in parse_course_rows_from_html(linked_html, category):
            cid = f"{rec['Major']}{rec['Code']}"
            if cid in seen:
                continue
            seen.add(cid)
            results.append(rec)
    return results


def _extract_int(text: str) -> int:
    m = re.search(r"\d+", text or "")
    return int(m.group(0)) if m else 0


def parse_minor_requirements(html: str) -> Dict:
    soup = BeautifulSoup(html, "lxml")
    out: Dict = {"categories": {}}

    # Term name (e.g., "Spring 2025-2026")
    admit = soup.find("h3", string=lambda s: s and "Admit Term" in s)
    if admit:
        m = re.search(r"Admit Term:\s*(.+)$", admit.get_text(" ", strip=True))
        if m:
            out["term"] = m.group(1).strip()

    table = soup.find("table", class_="t_mezuniyet")
    if not table:
        return out

    # Identify indices
    headers = [th.get_text(" ", strip=True).lower() for th in table.select("thead th")]
    su_idx = next((i for i, h in enumerate(headers) if "su" in h), 2)
    courses_idx = next((i for i, h in enumerate(headers) if "courses" in h), 3)

    # Some pages omit <tbody>; iterate over all rows and pick those with <td>.
    for tr in table.find_all("tr"):
        tds = [td.get_text(" ", strip=True) for td in tr.find_all("td")]
        if not tds:
            continue
        label = tds[0].lower()
        su_val = tds[su_idx] if su_idx < len(tds) else ""
        c_val = tds[courses_idx] if courses_idx < len(tds) else ""
        if "total" in label:
            out["minSU"] = _extract_int(su_val)
            out["minCourses"] = _extract_int(c_val)
            continue
        cat = None
        if "required" in label:
            cat = "required"
        elif "core" in label:
            cat = "core"
        elif "area" in label:
            cat = "area"
        elif "free" in label:
            cat = "free"
        if not cat:
            continue
        out["categories"][cat] = {
            "minSU": _extract_int(su_val),
            "minCourses": _extract_int(c_val),
            "equivalents": [],
            "allListedRequired": False,
        }

    # Parse simple "enough to take one of the course X 123 or Y 456" rules
    # under each category description row.
    for tr in soup.select("tr.t_kategori_row_desc"):
        text = tr.get_text(" ", strip=True)
        if not text:
            continue
        # Find nearest previous category header row containing an <a name="...">.
        prev = tr.find_previous("tr", class_="t_kategori_row")
        if not prev:
            continue
        anchor = prev.find("a", attrs={"name": True})
        if not anchor:
            continue
        cat = map_anchor_to_category(anchor.get("name") or "")
        if not cat or cat not in out["categories"]:
            continue

        low = text.lower()
        if "all courses below are required" in low:
            out["categories"][cat]["allListedRequired"] = True

        m = re.search(
            r"enough to take one of the course\s+([A-Z]{2,6})\s*(\d{3,})\s+or\s+([A-Z]{2,6})\s*(\d{3,})",
            text,
        )
        if m:
            c1 = (m.group(1) + m.group(2)).upper()
            c2 = (m.group(3) + m.group(4)).upper()
            out["categories"][cat]["equivalents"].append([c1, c2])

    return out


def load_minor_detail_html(program: str, term: Optional[str], offline_dir: Optional[str], timeout: float) -> str:
    if offline_dir:
        base = program.split("-")[0].lower()
        fname = f"SU_DEGREE.p_degree_detail_{base}.html"
        path = os.path.join(offline_dir, fname)
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                return f.read()

    # Online: if term is not provided, fall back to the latest term exposed.
    if not term:
        sel_url = BASE + f"SU_DEGREE.p_select_term?P_PROGRAM={program}&P_LANG=EN&P_LEVEL=UG"
        sel_html = fetch_html(sel_url, timeout=timeout)
        sel_soup = BeautifulSoup(sel_html, "lxml")
        opt = sel_soup.select_one('select[name=P_TERM] option')
        term = opt.get("value") if opt else None
        if not term:
            raise RuntimeError(f"Could not determine latest term for {program}")
    detail_url = (
        BASE
        + "SU_DEGREE.p_degree_detail?P_PROGRAM={p}&P_LANG=EN&P_LEVEL=UG&P_TERM={t}&P_SUBMIT=Select"
    ).format(p=program, t=term)
    return fetch_html(detail_url, timeout=timeout)


def main():
    parser = argparse.ArgumentParser(description="Fetch and regenerate minor catalogs and requirements.")
    parser.add_argument("--offline-dir", default="", help="Directory with saved minor HTML pages (for offline runs).")
    parser.add_argument("--terms", default="", help="Comma-separated explicit term codes (e.g. 202502,202501). Defaults to latest term.")
    parser.add_argument("--programs", default="", help="Comma-separated minor program codes to fetch (e.g. PHYS-MINOR,MATH-MINOR).")
    parser.add_argument("--workers", type=int, default=6, help="Parallel workers for fetching minors (per term).")
    parser.add_argument("--max-inflight", type=int, default=6, help="Maximum simultaneous HTTP requests (helps avoid throttling).")
    parser.add_argument("--retries", type=int, default=2, help="Retry count for HTTP errors.")
    parser.add_argument("--backoff", type=float, default=0.5, help="Base backoff seconds for retries (exponential).")
    parser.add_argument("--sleep", type=float, default=0.0, help="Optional sleep after each successful request.")
    parser.add_argument("--max-programs", type=int, default=0, help="Limit number of minors processed (debug).")
    parser.add_argument("--write-legacy", action="store_true", help="Also write legacy snapshot files under courses/minors/ and requirements/minors.jsonl.")
    parser.add_argument("--timeout", type=float, default=30.0, help="HTTP timeout in seconds.")
    args = parser.parse_args()

    global _net_semaphore, _http_timeout_s, _http_retries, _http_backoff_s, _http_sleep_s
    offline_dir = args.offline_dir.strip() or None
    timeout = float(args.timeout)
    _http_timeout_s = timeout
    _http_retries = int(args.retries)
    _http_backoff_s = float(args.backoff)
    _http_sleep_s = float(args.sleep)
    _net_semaphore = threading.Semaphore(max(1, int(args.max_inflight)))
    workers = max(1, int(args.workers))

    os.makedirs(COURSES_DIR, exist_ok=True)
    os.makedirs(REQUIREMENTS_DIR, exist_ok=True)
    os.makedirs(os.path.dirname(REQUIREMENTS_LEGACY_PATH), exist_ok=True)

    if offline_dir:
        list_path = os.path.join(offline_dir, "SU_DEGREE_minor.html")
        if not os.path.exists(list_path):
            raise SystemExit(f"offline minor list page not found: {list_path}")
        with open(list_path, "r", encoding="utf-8") as f:
            list_html = f.read()
    else:
        list_html = fetch_html(LIST_URL, timeout=timeout)

    minors = parse_minor_list(list_html)
    if args.max_programs and args.max_programs > 0:
        minors = minors[: int(args.max_programs)]

    programs_arg = (args.programs or "").strip()
    subset_mode = False
    if programs_arg:
        wanted = {p.strip().upper() for p in programs_arg.split(",") if p.strip()}
        minors = [m for m in minors if m.program.upper() in wanted]
        subset_mode = True
        if not minors:
            raise SystemExit(f"No matching minor programs found for --programs: {programs_arg}")

    terms_arg = (args.terms or "").strip()
    terms: List[str] = []
    if terms_arg:
        for part in terms_arg.split(","):
            p = part.strip()
            if p:
                terms.append(p)
    terms = [t for t in terms if re.fullmatch(r"\d{6}", t)]

    # Default term: try to read it from the first minor program's selector.
    if not terms and not offline_dir and minors:
        try:
            sel_url = BASE + f"SU_DEGREE.p_select_term?P_PROGRAM={minors[0].program}&P_LANG=EN&P_LEVEL=UG"
            sel_html = fetch_html(sel_url, timeout=timeout)
            sel_soup = BeautifulSoup(sel_html, "lxml")
            opt = sel_soup.select_one('select[name=P_TERM] option')
            if opt and opt.get("value"):
                terms = [opt.get("value")]
        except Exception:
            terms = []

    # Offline mode: HTML snapshots are not term-specific, so we treat them as
    # a single dataset.
    if offline_dir and not terms:
        terms = ["offline"]

    if not terms:
        raise SystemExit("No terms provided and could not determine a default term.")

    # Maintain a stable manifest of available minor term codes for the UI.
    # We merge with any existing manifest so partial runs don't shrink it.
    existing_terms: set[str] = set()
    try:
        if os.path.exists(REQUIREMENTS_TERMS_MANIFEST):
            with open(REQUIREMENTS_TERMS_MANIFEST, "r", encoding="utf-8") as mf_in:
                for line in mf_in:
                    line = (line or "").strip()
                    if not line:
                        continue
                    try:
                        rec = json.loads(line)
                        t = rec.get("term") if isinstance(rec, dict) else None
                        if t and re.fullmatch(r"\d{6}", str(t)):
                            existing_terms.add(str(t))
                    except Exception:
                        continue
    except Exception:
        existing_terms = set()

    # Write per-term requirements and per-term course catalogs.
    legacy_term = None
    try:
        numeric_terms = [int(t) for t in terms if t != "offline" and re.fullmatch(r"\d{6}", t)]
        legacy_term = str(max(numeric_terms)) if numeric_terms else None
    except Exception:
        legacy_term = None

    successful_terms: set[str] = set()
    for term in terms:
        is_offline = term == "offline"

        req_path = REQUIREMENTS_LEGACY_PATH if is_offline else os.path.join(REQUIREMENTS_DIR, f"{term}.jsonl")
        term_courses_dir = COURSES_DIR if is_offline else os.path.join(COURSES_DIR, term)

        os.makedirs(term_courses_dir, exist_ok=True)

        write_legacy_here = bool(args.write_legacy and (legacy_term and term == legacy_term) and not is_offline)
        legacy_req_out = None
        try:
            # Fetch/parse all minors for this term in parallel, then write in a
            # stable order so git diffs remain readable.
            results: Dict[str, Tuple[Dict, List[Dict]]] = {}

            def _worker(prog: MinorProgram):
                detail_html = load_minor_detail_html(prog.program, None if is_offline else term, offline_dir, timeout)
                req = parse_minor_requirements(detail_html)
                rec = {
                    "minor": prog.program,
                    "name": prog.name,
                    "termCode": None if is_offline else term,
                    **req,
                }
                courses = parse_minor_courses(
                    detail_html,
                    program=prog.program,
                    offline_dir=offline_dir,
                    timeout=timeout,
                )
                # Pages without a real course list are usually blocked/invalid.
                # Treat as failure so we don't overwrite existing data with empty files.
                if not courses and not is_offline:
                    raise ValueError("no courses parsed")
                return prog.program, rec, courses

            with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
                futs = {executor.submit(_worker, m): m for m in minors}
                for fut in concurrent.futures.as_completed(futs):
                    prog = futs[fut]
                    try:
                        program, rec, courses = fut.result()
                        results[program] = (rec, courses)
                    except Exception as e:
                        label = term if not is_offline else "offline"
                        print(f"Failed {prog.program} ({label}): {e}")

            if not results:
                label = term if not is_offline else "offline"
                print(f"Warning: no minor programs scraped for term {label}; leaving existing files unchanged.")
            else:
                if write_legacy_here:
                    try:
                        legacy_req_out = open(REQUIREMENTS_LEGACY_PATH, "w", encoding="utf-8")
                    except Exception:
                        legacy_req_out = None

                # Build the requirements records to write. If --programs was
                # used, merge into the existing term file (if present) so we
                # don't accidentally drop other minors from the requirements
                # JSONL.
                req_records: Dict[str, Dict] = {}
                if subset_mode and os.path.exists(req_path):
                    try:
                        with open(req_path, "r", encoding="utf-8") as rf:
                            for line in rf:
                                line = (line or "").strip()
                                if not line:
                                    continue
                                try:
                                    rec0 = json.loads(line)
                                except Exception:
                                    continue
                                code0 = rec0.get("minor") if isinstance(rec0, dict) else None
                                if code0:
                                    req_records[str(code0)] = rec0
                    except Exception:
                        req_records = {}

                # Apply updates from this run
                for program, (rec, _courses) in results.items():
                    req_records[program] = rec

                # Write requirements file deterministically
                with open(req_path, "w", encoding="utf-8") as req_out:
                    for program in sorted(req_records.keys()):
                        req_out.write(json.dumps(req_records[program], ensure_ascii=False) + "\n")

                # Optional legacy snapshot for the newest term processed.
                if legacy_req_out:
                    try:
                        for program in sorted(req_records.keys()):
                            legacy_req_out.write(json.dumps(req_records[program], ensure_ascii=False) + "\n")
                    except Exception:
                        pass

                # Write course catalogs for the programs we processed.
                for m in minors:
                    if m.program not in results:
                        continue
                    _rec, courses = results[m.program]
                    course_path = os.path.join(term_courses_dir, f"{m.program}.jsonl")
                    with open(course_path, "w", encoding="utf-8") as c_out:
                        for c in courses:
                            c_out.write(json.dumps(c, ensure_ascii=False) + "\n")

                    if legacy_req_out:
                        legacy_course_path = os.path.join(COURSES_DIR, f"{m.program}.jsonl")
                        with open(legacy_course_path, "w", encoding="utf-8") as lc_out:
                            for c in courses:
                                lc_out.write(json.dumps(c, ensure_ascii=False) + "\n")

                    label = term if not is_offline else "offline"
                    print(f"Updated {m.program} ({label}): {len(courses)} courses")

            if not is_offline and results:
                successful_terms.add(term)
        finally:
            try:
                if legacy_req_out:
                    legacy_req_out.close()
            except Exception:
                pass

    # Update term manifest after the scrape based on successful terms.
    try:
        merged = set(existing_terms)
        merged.update(successful_terms)
        merged = {t for t in merged if re.fullmatch(r"\d{6}", str(t))}
        with open(REQUIREMENTS_TERMS_MANIFEST, "w", encoding="utf-8") as mf_out:
            for t in sorted(merged, key=lambda x: int(x), reverse=True):
                mf_out.write(json.dumps({"term": t}, ensure_ascii=False) + "\n")
    except Exception:
        pass


if __name__ == "__main__":
    main()
