import argparse
import json
import os
import re
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import requests
from bs4 import BeautifulSoup

BASE = "https://suis.sabanciuniv.edu/prod/"
LIST_URL = BASE + "SU_DEGREE.p_list_degree?P_LEVEL=UG&P_LANG=EN&P_PRG_TYPE=MINOR"

COURSES_DIR = os.path.join("courses", "minors")
REQUIREMENTS_PATH = os.path.join("requirements", "minors.jsonl")


@dataclass(frozen=True)
class MinorProgram:
    program: str
    name: str


def fetch_html(url: str, timeout: float = 30.0) -> str:
    resp = requests.get(url, timeout=timeout, headers={"User-Agent": "surriculum-fetch/1.0"})
    resp.raise_for_status()
    return resp.text


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
    for tr in table.select("tbody tr"):
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


def parse_minor_courses(html: str) -> List[Dict]:
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

    for tr in table.select("tbody tr"):
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


def load_minor_detail_html(program: str, offline_dir: Optional[str], timeout: float) -> str:
    if offline_dir:
        base = program.split("-")[0].lower()
        fname = f"SU_DEGREE.p_degree_detail_{base}.html"
        path = os.path.join(offline_dir, fname)
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                return f.read()

    # Online fallback (requires term selection; use the latest term exposed)
    # Minor pages include the term selector page. Use the first option.
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
    parser.add_argument("--timeout", type=float, default=30.0, help="HTTP timeout in seconds.")
    args = parser.parse_args()

    offline_dir = args.offline_dir.strip() or None
    timeout = float(args.timeout)

    os.makedirs(COURSES_DIR, exist_ok=True)
    os.makedirs(os.path.dirname(REQUIREMENTS_PATH), exist_ok=True)

    if offline_dir:
        list_path = os.path.join(offline_dir, "SU_DEGREE_minor.html")
        if not os.path.exists(list_path):
            raise SystemExit(f"offline minor list page not found: {list_path}")
        with open(list_path, "r", encoding="utf-8") as f:
            list_html = f.read()
    else:
        list_html = fetch_html(LIST_URL, timeout=timeout)

    minors = parse_minor_list(list_html)

    # Write requirements as JSONL (one record per minor).
    with open(REQUIREMENTS_PATH, "w", encoding="utf-8") as req_out:
        for m in minors:
            detail_html = load_minor_detail_html(m.program, offline_dir, timeout)
            req = parse_minor_requirements(detail_html)
            rec = {
                "minor": m.program,
                "name": m.name,
                **req,
            }
            req_out.write(json.dumps(rec, ensure_ascii=False) + "\n")

            courses = parse_minor_courses(detail_html)
            course_path = os.path.join(COURSES_DIR, f"{m.program}.jsonl")
            with open(course_path, "w", encoding="utf-8") as c_out:
                for c in courses:
                    c_out.write(json.dumps(c, ensure_ascii=False) + "\n")

            print(f"Updated {m.program}: {len(courses)} courses")


if __name__ == "__main__":
    main()
