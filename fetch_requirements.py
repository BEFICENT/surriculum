import json
import requests
from bs4 import BeautifulSoup
import os
import datetime
import re
import argparse
import subprocess

from term_utils import generate_terms

REQUIREMENTS_DIR = 'requirements'
BASE = 'https://suis.sabanciuniv.edu/prod/'
# Local directory with saved degree detail pages for testing without network
DETAIL_PAGES_DIR = 'Degree Detail Pages (for inspect)'

PROGRAM_CODES = {
    'BSBIO': 'BIO',
    'BSCS': 'CS',
    'BAECON': 'ECON',
    'BSEE': 'EE',
    'BSMS': 'IE',
    'BSMAT': 'MAT',
    'BSME': 'ME',
    'BSDSA': 'DSA',
    'BAMAN': 'MAN',
    'BAPSIR': 'PSIR',
    'BAPSY': 'PSY',
    'BAVACD': 'VACD',
}

_session = None


def _get_session():
    global _session
    if _session is None:
        _session = requests.Session()
        _session.headers.update(
            {
                "User-Agent": "surriculum-fetch/1.0 (+https://github.com/beficent/surriculum)",
            }
        )
    return _session


def fetch_requirements(program, term, offline_dir=None, timeout_s: float = 30.0):
    """Fetch requirement summary for a program and term.

    When ``offline_dir`` is provided and contains a saved HTML page for the
    program, that file is parsed instead of performing a network request.
    Returns a dict with ``ects`` and ``total`` keys if found.
    """

    html = None
    major = PROGRAM_CODES.get(program, program)
    if offline_dir:
        fname = f'SU_DEGREE.p_degree_detail_{major}.html'
        fpath = os.path.join(offline_dir, fname)
        if os.path.exists(fpath):
            with open(fpath, 'r', encoding='utf-8') as fh:
                html = fh.read()

    if html is None:
        url = (
            BASE +
            'SU_DEGREE.p_degree_detail?P_PROGRAM={p}&P_LANG=EN&P_LEVEL=UG&P_TERM={t}&P_SUBMIT=Select'
        ).format(p=program, t=term)
        resp = _get_session().get(url, timeout=float(timeout_s or 30.0))
        resp.raise_for_status()
        html = resp.text

    soup = BeautifulSoup(html, 'lxml')
    # Summary table usually has class "t_mezuniyet"; fall back to the first
    # table containing "SUMMARY OF DEGREE" text.
    table = soup.find('table', class_='t_mezuniyet')
    if not table:
        h1 = soup.find('h1', string=lambda s: s and 'SUMMARY OF DEGREE' in s)
        if h1:
            table = h1.find_parent('table')
    req = {}
    if table:
        headers = [th.get_text(strip=True).lower() for th in table.select('thead th')]
        ects_idx = next((i for i,h in enumerate(headers) if 'ects' in h), 1)
        su_idx = next((i for i,h in enumerate(headers) if 'su' in h), 2)

        for tr in table.find_all('tr'):
            tds = [td.get_text(strip=True) for td in tr.find_all('td')]
            if not tds:
                continue
            label = tds[0].lower()

            val_ects = tds[ects_idx] if ects_idx < len(tds) else ''
            val_su = tds[su_idx] if su_idx < len(tds) else ''

            def extract(v):
                m = re.search(r'\d+', v)
                return int(m.group()) if m else 0

            if re.search(r'total', label):
                req['ects'] = extract(val_ects)
                req['total'] = extract(val_su)
            elif 'engineering' in label:
                req['engineering'] = extract(val_ects)
            elif 'basic' in label and 'science' in label:
                req['science'] = extract(val_ects)
            else:
                field = None
                if 'university' in label:
                    field = 'university'
                elif 'required' in label or 'philosophy' in label or 'mathematics' in label:
                    field = 'required'
                elif 'core' in label:
                    field = 'core'
                elif 'area' in label:
                    field = 'area'
                elif 'free' in label:
                    field = 'free'

                if field:
                    req[field] = req.get(field, 0) + extract(val_su)

    # Internship course: search the entire page for a pattern like CS395
    major = PROGRAM_CODES.get(program, program)
    text = soup.get_text(separator=' ')
    pattern = re.compile(rf'{major}\s*395', re.I)
    match = pattern.search(text)
    if match:
        req['internshipCourse'] = f'{major}395'
    else:
        # explicit PSY special case if not found
        if major == 'PSY' and re.search(r'PSY\s*395', text, re.I):
            req['internshipCourse'] = 'PSY300'

    return req

def hum_required(major, university):
    """HUM graduation requirement, materialized as data so the app's rule tables
    don't hard-list it (flags 12/13). FASS/SBS programs — university credit 44 —
    require one 2xx AND one 3xx HUM (returns 2); the FENS programs (41) require
    one. Only CS's SUIS states the single-HUM rule explicitly, so the other FENS
    programs carry none (0) rather than an unverified check. The `university == 44`
    split matches the two-HUM set exactly (the extra 3 SU is that second HUM)."""
    if university == 44:
        return 2
    return 1 if major == "CS" else 0


# Hand-authored special-requirement data, materializing the constants currently in
# the app (s_curriculum.js) as scraped data. See docs/requirement-groups-design.md.
# Until the scraper learns to parse these off SUIS, they are hand-authored here.
#   groups     — the program's ORDERED special rules (first-unmet-wins). Each is a
#                named subset of a base type, OR the {"rule": "faculty"} marker that
#                splices the cross-cutting faculty ticker in at its position.
#   facultyReq — the faculty-course ticker minimums (a course carries the
#                `Faculty_Course` tag alongside its base type). All programs have it.
# Group fields: base (the base type / cascade+display); overflowTo (where credits
# beyond `min` go — scraped from "The extra courses taken from this pool are
# directly counted towards [X] requirements", metadata for now, §11); requireBase
# (measure only base-effective credit — the pools do, per that same overflow rule);
# rule + its params (see groupRules in s_curriculum.js).
_FACULTY = {"rule": "faculty"}


def _lang_cap(major):
    return {
        "id": "lang_cap", "label": "Free Electives — beginning/basic language cap",
        "base": "free", "rule": "languageCap", "max": 2, "flag": 40,
        "suis": major + " > Free Electives (language cap)",
    }


def _core_pool(program, gid, label, poolno, members, minimum, flag, pairs=None):
    g = {
        "id": gid, "label": label, "base": "core", "overflowTo": "area",
        "rule": "credits", "min": minimum, "requireBase": True, "members": members,
        "flag": flag, "suis": program + " > Core Electives " + poolno + " (" + label + ")",
    }
    if pairs:
        g["exclusivePairs"] = pairs
    return g


PROGRAM_GROUPS = {
    "EE": [
        _FACULTY,
        {"id": "ee400", "label": "400-level EE requirement", "base": "core", "rule": "levelCredits",
         "prefix": "EE4", "category": "Core", "min": 9, "flag": 23, "suis": "EE > 400-level EE requirement"},
        {"id": "special_area", "label": "Area electives — special topics", "base": "area", "rule": "specialAny",
         "members": ["CS300", "CS401", "CS412", "ME303", "PHYS302", "PHYS303"],
         "altPrefix": "EE48", "altCategory": "Area", "flag": 24, "suis": "EE > Area electives (special topics)"},
    ],
    "ME": [
        {"id": "cs_alt", "label": "2025 curriculum — CS404/CS412", "base": "required", "rule": "entryGatedOneOf",
         "minTerm": 202501, "members": ["CS404", "CS412"], "flag": 2, "suis": "ME > 2025 curriculum (CS404/CS412)"},
        _FACULTY,
    ],
    "ECON": [
        {"id": "math_req", "label": "Mathematics Requirement", "base": "required", "rule": "oneOf",
         "members": ["MATH201", "MATH202", "MATH204", "MATH212"], "flag": 25, "suis": "ECON > Mathematics Requirement"},
        _FACULTY,
        _lang_cap("ECON"),
    ],
    "MAN": [
        _FACULTY,
        {"id": "core_areas", "label": "Core Electives — 6 areas", "base": "core", "rule": "prefixSpan",
         "category": "core", "prefixes": ["ACC", "FIN", "MGMT", "MKTG", "OPIM", "ORG"], "min": 6,
         "flag": 35, "suis": "MAN > Core Electives (6 areas)"},
        {"id": "area_areas", "label": "Area Electives — 5 areas", "base": "area", "rule": "prefixSpan",
         "category": "area", "prefixes": ["ACC", "FIN", "MKTG", "OPIM", "ORG"], "min": 5,
         "flag": 36, "suis": "MAN > Area Electives (5 areas)"},
        {"id": "free_fassfens", "label": "Free Electives — 9cr FASS/FENS", "base": "free", "rule": "offeringCredits",
         "faculties": ["FASS", "FENS"], "min": 9, "flag": 37, "suis": "MAN > Free Electives (9cr FASS/FENS)"},
        _lang_cap("MAN"),
    ],
    "PSIR": [
        _FACULTY,
        _core_pool("PSIR", "core_polisci", "Political Science", "I",
                   ["LAW312", "POLS251", "POLS353", "POLS404", "POLS455", "POLS483", "POLS493", "SOC201"], 12, 33),
        _core_pool("PSIR", "core_ir", "International Relations", "II",
                   ["CONF400", "IR301", "IR342", "IR391", "IR394", "IR405", "IR489", "LAW311", "POLS492"], 12, 34),
        _lang_cap("PSIR"),
    ],
    "PSY": [
        {"id": "philosophy", "label": "Philosophy Requirement", "base": "required", "rule": "oneOf",
         "members": ["PHIL300", "PHIL301"], "flag": 26, "suis": "PSY > Philosophy Requirement"},
        _FACULTY,
        {"id": "psy_advanced", "label": "Area Electives — 2 PSY 4XX", "base": "area", "rule": "advancedCount",
         "min": 2, "flag": 39, "suis": "PSY > Area Electives (2 PSY 4XX)"},
        _lang_cap("PSY"),
    ],
    "VACD": [
        _FACULTY,
        _core_pool("VACD", "core_arthistory", "Art/Design History", "I",
                   ["HART292", "HART293", "HART380", "HART413", "HART426", "VA315", "VA420", "VA430"], 9, 30),
        _core_pool("VACD", "core_skill", "Skill Courses", "II",
                   ["VA202", "VA204", "VA234", "VA302", "VA304", "VA402", "VA404"], 12, 31,
                   pairs=[["VA302", "VA304"], ["VA402", "VA404"]]),
        _lang_cap("VACD"),
    ],
    "DSA": [
        _FACULTY,
        {"id": "core_fens", "label": "Core Electives — 3 FENS", "base": "core", "rule": "offeringCount",
         "faculty": "FENS", "min": 3, "flag": 27, "suis": "DSA > Core Electives (3 FENS)"},
        {"id": "core_fass", "label": "Core Electives — 3 FASS", "base": "core", "rule": "offeringCount",
         "faculty": "FASS", "min": 3, "flag": 28, "suis": "DSA > Core Electives (3 FASS)"},
        {"id": "core_sbs", "label": "Core Electives — 3 SBS", "base": "core", "rule": "offeringCount",
         "faculty": "SBS", "min": 3, "flag": 29, "suis": "DSA > Core Electives (3 SBS)"},
    ],
}
PROGRAM_FACULTY_REQ = {
    "CS": {"total": 5, "math": 2, "fens": 3},
    "IE": {"total": 5, "math": 2, "fens": 3},
    "MAT": {"total": 5, "math": 2, "fens": 3},
    "BIO": {"total": 5, "math": 2, "fens": 3},
    "EE": {"total": 5, "math": 2, "fens": 3},
    "ME": {"total": 5, "math": 2, "fens": 3},
    "ECON": {"total": 5, "fass": 3, "areas": 3},
    "MAN": {"total": 5, "sbs": 2},
    "PSIR": {"total": 5, "fass": 3, "areas": 3},
    "PSY": {"total": 5, "fass": 3, "areas": 3},
    "VACD": {"total": 5, "fass": 3, "areas": 3},
    "DSA": {"total": 5, "fens": 1, "fass": 1, "sbs": 1},
}


def special_requirements(major):
    """Groups + faculty ticker to merge into a program's requirements record
    (phase-1: VACD only; empty for programs not yet migrated)."""
    out = {}
    if major in PROGRAM_GROUPS:
        out["groups"] = PROGRAM_GROUPS[major]
    if major in PROGRAM_FACULTY_REQ:
        out["facultyReq"] = PROGRAM_FACULTY_REQ[major]
    return out


def main():
    parser = argparse.ArgumentParser(description="Fetch and regenerate graduation requirement summaries.")
    parser.add_argument("--timeout", type=float, default=30.0, help="HTTP timeout in seconds.")
    parser.add_argument("--terms", default="", help="Comma-separated explicit term codes (e.g. 202401,202402).")
    parser.add_argument("--max-terms", type=int, default=0, help="Limit number of terms processed (debug).")
    parser.add_argument("--skip-minors", action="store_true", help="Skip fetching minor catalogs/requirements.")
    args = parser.parse_args()

    os.makedirs(REQUIREMENTS_DIR, exist_ok=True)

    if args.terms.strip():
        terms = [t.strip() for t in args.terms.split(",") if t.strip()]
    else:
        # Generate terms dynamically (same date rules as the web app) so we do
        # not have to bump a hard-coded year cap each year.
        terms = generate_terms(start_year=2019)

    if args.max_terms and args.max_terms > 0:
        terms = terms[: int(args.max_terms)]

    for term in terms:
        out = {}
        for prog, major in PROGRAM_CODES.items():
            try:
                data = fetch_requirements(prog, term, None, timeout_s=args.timeout)
                if not data:
                    raise ValueError('no data parsed')
            except Exception as e:
                print(f"Failed {major} {term}: {e}")
                data = {}
            if data:
                data['humRequired'] = hum_required(major, data.get('university'))
                data.update(special_requirements(major))
                out[major] = data
        if out:
            with open(os.path.join(REQUIREMENTS_DIR, f'{term}.jsonl'), 'w', encoding='utf-8') as f:
                for major in sorted(out.keys()):
                    f.write(json.dumps({"major": major, **out[major]}, ensure_ascii=False) + "\n")

    if not args.skip_minors:
        # Keep minors in sync with the same term set as major requirements.
        # This reuses fetch_minors.py, which writes:
        # - requirements/minors/<TERM>.jsonl
        # - courses/minors/<TERM>/*.jsonl
        try:
            print("\nRunning fetch_minors.py to update minor catalogs/requirements...\n")
            subprocess.run(
                [
                    "python",
                    "fetch_minors.py",
                    "--terms",
                    ",".join(terms),
                    "--timeout",
                    str(float(args.timeout)),
                    "--workers",
                    "3",
                    "--max-inflight",
                    "3",
                    "--retries",
                    "2",
                    "--backoff",
                    "0.5",
                    "--sleep",
                    "0.05" if len(terms) > 1 else "0.0",
                    "--write-legacy",
                ],
                check=True,
            )
        except Exception as e:
            print(f"Warning: failed to fetch minors: {e}")

if __name__ == '__main__':
    main()
