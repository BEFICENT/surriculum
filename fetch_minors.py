import argparse
import json
import os
import re
import random
import shutil
import tempfile
import threading
import time
import concurrent.futures
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple
from urllib.parse import parse_qs, urljoin, urlparse

import requests
from bs4 import BeautifulSoup

from suis_page_validation import require_matching_admit_term, validate_suis_term_code

BASE = "https://suis.sabanciuniv.edu/prod/"
LIST_URL = BASE + "SU_DEGREE.p_list_degree?P_LEVEL=UG&P_LANG=EN&P_PRG_TYPE=MINOR"

COURSES_DIR = os.path.join("courses", "minors")
REQUIREMENTS_LEGACY_PATH = os.path.join("requirements", "minors.jsonl")
REQUIREMENTS_DIR = os.path.join("requirements", "minors")
REQUIREMENTS_TERMS_MANIFEST = os.path.join(REQUIREMENTS_DIR, "terms.jsonl")
COURSEPAGE_INFO_PATH = os.path.join("courses", "all_coursepage_info.jsonl")

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


def load_coursepage_credit_lookup(path: str = COURSEPAGE_INFO_PATH) -> Dict[str, Tuple[Optional[float], Optional[float]]]:
    out: Dict[str, Tuple[Optional[float], Optional[float]]] = {}
    if not os.path.exists(path):
        return out
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = (line or "").strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except Exception:
                    continue
                course_id = str(rec.get("course_id") or "").strip().upper().replace(" ", "")
                if not course_id:
                    subj = str(rec.get("subj_code") or "").strip().upper()
                    numb = str(rec.get("crse_numb") or "").strip().upper()
                    if subj and numb:
                        course_id = f"{subj}{numb}"
                if not course_id:
                    continue
                eng = rec.get("engineering")
                bs = rec.get("basic_science")
                eng_val = float(eng) if isinstance(eng, (int, float)) else None
                bs_val = float(bs) if isinstance(bs, (int, float)) else None
                out[course_id] = (eng_val, bs_val)
    except Exception:
        return {}
    return out


def load_existing_minor_credit_lookup(path: str) -> Dict[str, Tuple[Optional[float], Optional[float]]]:
    out: Dict[str, Tuple[Optional[float], Optional[float]]] = {}
    if not os.path.exists(path):
        return out
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = (line or "").strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except Exception:
                    continue
                course_id = f"{str(rec.get('Major') or '').strip().upper()}{str(rec.get('Code') or '').strip().upper()}"
                if not course_id:
                    continue
                eng = rec.get("Engineering")
                bs = rec.get("Basic_Science")
                eng_val = float(eng) if isinstance(eng, (int, float)) else None
                bs_val = float(bs) if isinstance(bs, (int, float)) else None
                out[course_id] = (eng_val, bs_val)
    except Exception:
        return {}
    return out


def enrich_minor_course_credits(
    courses: List[Dict],
    *,
    coursepage_lookup: Dict[str, Tuple[Optional[float], Optional[float]]],
    existing_lookup: Dict[str, Tuple[Optional[float], Optional[float]]],
) -> List[Dict]:
    for rec in courses:
        course_id = f"{str(rec.get('Major') or '').strip().upper()}{str(rec.get('Code') or '').strip().upper()}"
        if not course_id:
            continue
        page_eng, page_bs = coursepage_lookup.get(course_id, (None, None))
        old_eng, old_bs = existing_lookup.get(course_id, (None, None))
        if page_eng is not None:
            rec["Engineering"] = page_eng
        elif old_eng is not None:
            rec["Engineering"] = old_eng
        if page_bs is not None:
            rec["Basic_Science"] = page_bs
        elif old_bs is not None:
            rec["Basic_Science"] = old_bs
    return courses


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
                html = f.read()
            if term:
                term = validate_suis_term_code(term)
                require_matching_admit_term(BeautifulSoup(html, "lxml"), term)
            return html

    # Online: if term is not provided, fall back to the latest term exposed.
    if not term:
        sel_url = BASE + f"SU_DEGREE.p_select_term?P_PROGRAM={program}&P_LANG=EN&P_LEVEL=UG"
        sel_html = fetch_html(sel_url, timeout=timeout)
        sel_soup = BeautifulSoup(sel_html, "lxml")
        opt = sel_soup.select_one('select[name=P_TERM] option')
        term = opt.get("value") if opt else None
        if not term:
            raise RuntimeError(f"Could not determine latest term for {program}")
    term = validate_suis_term_code(term)
    detail_url = (
        BASE
        + "SU_DEGREE.p_degree_detail?P_PROGRAM={p}&P_LANG=EN&P_LEVEL=UG&P_TERM={t}&P_SUBMIT=Select"
    ).format(p=program, t=term)
    html = fetch_html(detail_url, timeout=timeout)
    require_matching_admit_term(BeautifulSoup(html, "lxml"), term)
    return html


def _jsonl_text(records: List[Dict]) -> str:
    return "".join(json.dumps(record, ensure_ascii=False) + "\n" for record in records)


def _load_minor_requirement_records(path: str) -> Dict[str, Dict]:
    """Load a term snapshot without silently discarding records in subset mode."""
    records: Dict[str, Dict] = {}
    if not os.path.exists(path):
        return records
    with open(path, "r", encoding="utf-8") as req_in:
        for line_number, line in enumerate(req_in, start=1):
            line = (line or "").strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except Exception as exc:
                raise ValueError(f"invalid JSON on line {line_number} of {path}") from exc
            if not isinstance(record, dict) or not str(record.get("minor") or "").strip():
                raise ValueError(f"invalid minor requirement record on line {line_number} of {path}")
            program = str(record["minor"]).strip()
            if program in records:
                raise ValueError(f"duplicate minor {program} in {path}")
            records[program] = record
    return records


def _load_minor_terms_manifest(path: str) -> set[str]:
    terms: set[str] = set()
    if not os.path.exists(path):
        return terms
    with open(path, "r", encoding="utf-8") as manifest_in:
        for line_number, line in enumerate(manifest_in, start=1):
            line = (line or "").strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except Exception as exc:
                raise ValueError(f"invalid JSON on line {line_number} of {path}") from exc
            term = record.get("term") if isinstance(record, dict) else None
            if not term or not re.fullmatch(r"\d{6}", str(term)):
                raise ValueError(f"invalid minor term record on line {line_number} of {path}")
            terms.add(str(term))
    return terms


def _publish_text_files_atomically(files: Dict[str, str]) -> None:
    """Stage a related set of files and roll it back if any replacement fails."""
    staged: Dict[str, str] = {}
    backups: Dict[str, str] = {}
    replaced: List[str] = []
    try:
        for target in sorted(files):
            parent = os.path.dirname(target) or "."
            os.makedirs(parent, exist_ok=True)
            fd, staged_path = tempfile.mkstemp(
                prefix=f".{os.path.basename(target)}.", suffix=".tmp", dir=parent
            )
            staged[target] = staged_path
            try:
                with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as staged_out:
                    staged_out.write(files[target])
                    staged_out.flush()
                    os.fsync(staged_out.fileno())
            except Exception:
                try:
                    os.close(fd)
                except OSError:
                    pass
                raise

        # Backups live beside their targets so every move stays on one filesystem.
        for target in sorted(files):
            if not os.path.exists(target):
                continue
            parent = os.path.dirname(target) or "."
            fd, backup_path = tempfile.mkstemp(
                prefix=f".{os.path.basename(target)}.", suffix=".bak", dir=parent
            )
            os.close(fd)
            backups[target] = backup_path
            shutil.copy2(target, backup_path)

        for target in sorted(files):
            staged_path = staged[target]
            os.replace(staged_path, target)
            staged.pop(target)
            replaced.append(target)
    except Exception as exc:
        rollback_errors: List[str] = []
        for target in reversed(replaced):
            try:
                backup_path = backups.pop(target, None)
                if backup_path:
                    os.replace(backup_path, target)
                elif os.path.exists(target):
                    os.remove(target)
            except Exception as rollback_exc:
                rollback_errors.append(f"{target}: {rollback_exc}")
        if rollback_errors:
            raise RuntimeError(
                f"publication failed ({exc}); rollback also failed: {'; '.join(rollback_errors)}"
            ) from exc
        raise
    finally:
        for temporary_path in list(staged.values()) + list(backups.values()):
            try:
                os.remove(temporary_path)
            except FileNotFoundError:
                pass


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

    terms_arg = (args.terms or "").strip()
    terms: List[str] = []
    if terms_arg:
        terms = [
            validate_suis_term_code(part)
            for part in terms_arg.split(",")
            if part.strip()
        ]

    if offline_dir:
        list_path = os.path.join(offline_dir, "SU_DEGREE_minor.html")
        if not os.path.exists(list_path):
            raise SystemExit(f"offline minor list page not found: {list_path}")
        with open(list_path, "r", encoding="utf-8") as f:
            list_html = f.read()
    else:
        list_html = fetch_html(LIST_URL, timeout=timeout)

    discovered = {minor.program.upper(): minor for minor in parse_minor_list(list_html)}
    minors = [discovered[program] for program in sorted(discovered)]
    if not minors:
        print("Failed to discover any minor programs; existing minor data was preserved.")
        return 1

    programs_arg = (args.programs or "").strip()
    subset_mode = bool(programs_arg or (args.max_programs and args.max_programs > 0))
    if programs_arg:
        wanted = {p.strip().upper() for p in programs_arg.split(",") if p.strip()}
        missing = sorted(wanted - set(discovered))
        if not wanted or missing:
            missing_label = ", ".join(missing) if missing else programs_arg
            print(f"No matching minor programs found for: {missing_label}")
            return 1
        minors = [m for m in minors if m.program.upper() in wanted]
    if args.max_programs and args.max_programs > 0:
        minors = minors[: int(args.max_programs)]

    coursepage_credit_lookup = load_coursepage_credit_lookup()

    # Default term: try to read it from the first minor program's selector.
    if not terms and not offline_dir and minors:
        try:
            sel_url = BASE + f"SU_DEGREE.p_select_term?P_PROGRAM={minors[0].program}&P_LANG=EN&P_LEVEL=UG"
            sel_html = fetch_html(sel_url, timeout=timeout)
            sel_soup = BeautifulSoup(sel_html, "lxml")
            opt = sel_soup.select_one('select[name=P_TERM] option')
            if opt and opt.get("value"):
                terms = [validate_suis_term_code(opt.get("value"))]
        except Exception:
            terms = []

    # Offline mode: HTML snapshots are not term-specific, so we treat them as
    # a single dataset.
    if offline_dir and not terms:
        terms = ["offline"]

    if not terms:
        raise SystemExit("No terms provided and could not determine a default term.")

    # Only complete runs advertise a term. Subset/debug runs can refresh an
    # existing snapshot, but must not make a partial new term discoverable.
    existing_terms: set[str] = set()
    if not subset_mode:
        try:
            existing_terms = _load_minor_terms_manifest(REQUIREMENTS_TERMS_MANIFEST)
        except Exception as exc:
            print(f"Failed to read the existing minor term index: {exc}")
            return 1

    # Write per-term requirements and per-term course catalogs.
    legacy_term = None
    try:
        numeric_terms = [int(t) for t in terms if t != "offline" and re.fullmatch(r"\d{6}", t)]
        legacy_term = str(max(numeric_terms)) if numeric_terms else None
    except Exception:
        legacy_term = None

    failed_terms: List[str] = []
    for term in terms:
        is_offline = term == "offline"
        label = term if not is_offline else "offline"

        req_path = REQUIREMENTS_LEGACY_PATH if is_offline else os.path.join(REQUIREMENTS_DIR, f"{term}.jsonl")
        term_courses_dir = COURSES_DIR if is_offline else os.path.join(COURSES_DIR, term)

        write_legacy_here = bool(args.write_legacy and (legacy_term and term == legacy_term) and not is_offline)
        # Fetch and parse every selected minor before constructing any output.
        results: Dict[str, Tuple[Dict, List[Dict]]] = {}
        failures: List[Tuple[str, str]] = []

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
            futs = {executor.submit(_worker, minor): minor for minor in minors}
            for future in concurrent.futures.as_completed(futs):
                minor = futs[future]
                try:
                    program, rec, courses = future.result()
                    results[program] = (rec, courses)
                except Exception as exc:
                    failures.append((minor.program, str(exc)))
                    print(f"Failed {minor.program} ({label}): {exc}")

        if failures or len(results) != len(minors):
            failed_terms.append(label)
            print(
                f"Incomplete minor refresh for {label}: accepted {len(results)}/{len(minors)} programs; "
                "all existing requirements and catalogs for the term were preserved."
            )
            continue

        try:
            req_records = _load_minor_requirement_records(req_path) if subset_mode else {}
            for program, (record, _courses) in results.items():
                req_records[program] = record

            publication: Dict[str, str] = {
                req_path: _jsonl_text([req_records[program] for program in sorted(req_records)])
            }

            for minor in minors:
                _record, courses = results[minor.program]
                course_path = os.path.join(term_courses_dir, f"{minor.program}.jsonl")
                courses = enrich_minor_course_credits(
                    courses,
                    coursepage_lookup=coursepage_credit_lookup,
                    existing_lookup=load_existing_minor_credit_lookup(course_path),
                )
                results[minor.program] = (_record, courses)
                publication[course_path] = _jsonl_text(courses)

            if write_legacy_here:
                if subset_mode:
                    legacy_req_records = _load_minor_requirement_records(REQUIREMENTS_LEGACY_PATH)
                    for program, (record, _courses) in results.items():
                        legacy_req_records[program] = record
                else:
                    legacy_req_records = req_records
                publication[REQUIREMENTS_LEGACY_PATH] = _jsonl_text(
                    [legacy_req_records[program] for program in sorted(legacy_req_records)]
                )
                for minor in minors:
                    _record, courses = results[minor.program]
                    publication[os.path.join(COURSES_DIR, f"{minor.program}.jsonl")] = _jsonl_text(courses)

            if not is_offline and not subset_mode:
                next_terms = set(existing_terms)
                next_terms.add(term)
                publication[REQUIREMENTS_TERMS_MANIFEST] = _jsonl_text(
                    [{"term": indexed_term} for indexed_term in sorted(next_terms, key=int, reverse=True)]
                )

            _publish_text_files_atomically(publication)
        except Exception as exc:
            failed_terms.append(label)
            print(f"Failed to publish minor data for {label}: {exc}; existing files were preserved.")
            continue

        if not is_offline and not subset_mode:
            existing_terms.add(term)
        for minor in minors:
            print(f"Updated {minor.program} ({label}): {len(results[minor.program][1])} courses")

    if failed_terms:
        print(
            "Minor refresh failed for: " + ", ".join(failed_terms)
            + ". No incomplete term snapshot was published."
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
