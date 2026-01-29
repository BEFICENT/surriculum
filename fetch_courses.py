import re
import json
import requests
from urllib.parse import urljoin
from bs4 import BeautifulSoup
import subprocess
import os
import datetime
import argparse
import concurrent.futures
import random
import threading
import time

from term_utils import generate_terms

COURSES_DIR = 'courses'

BASE = 'https://suis.sabanciuniv.edu/prod/'
LIST_URL = BASE + 'SU_DEGREE.p_list_degree?P_LEVEL=UG&P_LANG=EN&P_PRG_TYPE='

PROGRAM_FILES = {
    'BSBIO': 'BIO.jsonl',
    'BSCS': 'CS.jsonl',
    'BAECON': 'ECON.jsonl',
    'BSEE': 'EE.jsonl',
    'BSMS': 'IE.jsonl',
    'BSMAT': 'MAT.jsonl',
    'BSME': 'ME.jsonl',
    'BSDSA': 'DSA.jsonl',  # Adding Data Science and Analytics program
    'BAMAN': 'MAN.jsonl',  # Management program
    'BAPSIR': 'PSIR.jsonl',  # Political Science and International Relations
    'BAPSY': 'PSY.jsonl',  # Psychology program
    'BAVACD': 'VACD.jsonl',  # Visual Arts and Visual Communication Design
}

# Predefined faculty courses - these are specific courses, not based on course attributes
FACULTY_COURSES = {
    'FENS': [
        'CS201', 'CS204', 'DSA210', 'EE200', 'EE202', 'ENS201', 'ENS202', 'ENS203',
        'ENS204', 'ENS205', 'ENS206', 'ENS207', 'ENS208', 'ENS209', 'ENS210', 'ENS211',
        'ENS214', 'ENS216', 'MAT204', 'MATH201', 'MATH202', 'MATH203', 'MATH204',
        'NS201', 'NS207', 'NS213', 'NS214', 'NS216', 'NS218', 'PHYS211'
    ],
    'FASS': [
        'ANTH255', 'ANTH326', 'CULT368', 'GEN341', 'LIT212', 'LIT359', 'PHIL202',
        'PHIL321', 'VA315', 'ECON201', 'ECON202', 'ECON204', 'HART292', 'HART311',
        'HIST205', 'HIST349', 'PSY201', 'PSY310', 'PSY340', 'IR201', 'IR301',
        'IR391', 'IR394', 'POLS250', 'POLS301', 'SOC201', 'SOC301', 'HART213',
        'HART293', 'VA201', 'VA203', 'VA312'
    ],
    'SBS': [
        'ACC201', 'FIN301', 'MGMT402', 'MKTG301', 'OPIM302', 'ORG301', 'ORG302'
    ]
}

def get_faculty_for_course(major, code):
    """Get the faculty (FENS/FASS/SBS) for a course if it's a faculty course, otherwise return None"""
    course_code = f"{major}{code}"
    for faculty, courses in FACULTY_COURSES.items():
        if course_code in courses:
            return faculty
    return None

def is_faculty_course(major, code):
    """Check if a course is a faculty course based on predefined lists"""
    return get_faculty_for_course(major, code) is not None


_tls = threading.local()
_net_semaphore = None
_http_timeout_s = 30.0
_http_retries = 2
_http_backoff_s = 0.5
_http_sleep_s = 0.0


def _get_session():
    sess = getattr(_tls, "session", None)
    if sess is None:
        sess = requests.Session()
        sess.headers.update(
            {
                "User-Agent": "surriculum-fetch/1.0 (+https://github.com/beficent/surriculum)",
            }
        )
        _tls.session = sess
    return sess


def fetch_html(url):
    """Fetch URL with retries, optional throttling, and per-thread sessions."""
    sess = _get_session()
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


def get_program_codes():
    html = fetch_html(LIST_URL)
    soup = BeautifulSoup(html, 'lxml')
    codes = {}
    for a in soup.select('a[href*="P_PROGRAM="]'):
        m = re.search(r'P_PROGRAM=([^&]+)', a['href'])
        if m:
            codes[m.group(1)] = a.get_text(strip=True)
    return codes


def get_latest_term(code):
    url = BASE + f'SU_DEGREE.p_select_term?P_PROGRAM={code}&P_LANG=EN&P_LEVEL=UG'
    html = fetch_html(url)
    soup = BeautifulSoup(html, 'lxml')
    opt = soup.select_one('select[name=P_TERM] option')
    return opt['value'] if opt else None


def map_category(title):
    t = title.lower()
    if 'university' in t and 'courses' in t:
        return 'university'
    if 'required' in t and 'courses' in t:
        return 'required'
    if 'core' in t and 'elective' in t:
        return 'core'
    if 'area' in t and 'elective' in t:
        return 'area'
    if 'free' in t and 'elective' in t:
        return 'free'
    if t == 'total':
        return 'university'  # Easy fix for university course problem, they are miss detected as total
    return 'unknown'  # Default to if no match

def parse_table(table, category):
    rows = []
    trs = table.find_all('tr')
    if not trs:
        return rows
    header = len(trs[0].find_all('th')) > 0
    for tr in trs[1 if header else 0:]:
        tds = [td.get_text(strip=True) for td in tr.find_all('td')]
        if len(tds) >= 5 and tds[1]:
            code = tds[1].replace('\xa0', ' ')
            parts = code.split()
            major = parts[0]
            number = ''.join(parts[1:]) if len(parts) > 1 else ''

            # Check if this course has an asterisk marker (faculty course indicator)
            has_asterisk = False
            if len(tds) > 0:
                first_cell_html = str(tr.find_all('td')[0])
                has_asterisk = '<center>&nbsp;*&nbsp;</center>' in first_cell_html or '<center> * </center>' in first_cell_html

            # Check if this is a faculty course and get the faculty name
            faculty_course = get_faculty_for_course(major, number)
            if faculty_course is None:
                faculty_course = "No"

            # Determine the correct EL_Type
            el_type = category
            # If the course has an asterisk and is a faculty course, and we're in a required section,
            # it should maintain its core elective status instead of being marked as required
            if has_asterisk and faculty_course != "No" and category == "required":
                el_type = "core"
            elif has_asterisk and faculty_course != "No" and category == "area":
                el_type = "area"
            elif has_asterisk and faculty_course != "No" and category == "free":
                el_type = "free"
            rows.append({
                'Major': major,
                'Code': number,
                'Course_Name': tds[2],
                'ECTS': tds[3],
                'Engineering': 0,
                'Basic_Science': 0,
                'SU_credit': tds[4],
                'Faculty': tds[5] if len(tds) > 5 else '',
                'EL_Type': el_type,
                'Faculty_Course': faculty_course,
            })
    return rows


def crawl_list(url, category):
    html = fetch_html(url)
    soup = BeautifulSoup(html, 'lxml')
    table = soup.find('table')
    return parse_table(table, category) if table else []


def crawl_program(code, term):
    url = (BASE + 'SU_DEGREE.p_degree_detail?P_PROGRAM={code}&P_LANG=EN&P_LEVEL=UG'
           '&P_TERM={term}&P_SUBMIT=Select').format(code=code, term=term)
    html = fetch_html(url)
    soup = BeautifulSoup(html, 'lxml')
    results = []
    seen_courses = set()  # Track seen courses to avoid duplicates

    # First, try to extract category information from the name attribute
    for a in soup.select('a[name]'):
        name_attr = a.get('name', '')
        # Skip non-category anchors with improved pattern matching
        if not (name_attr.endswith('_CEL') or name_attr.endswith('_REQ') or
                name_attr.endswith('_AEL') or name_attr.endswith('_FEL') or name_attr.endswith('_ARE') or name_attr.endswith('_FRE') or
                name_attr == 'UC_FENS' or name_attr == 'UC_FASS' or
                name_attr.startswith('main') or
                # Add more specific patterns for different program types
                '_COR' in name_attr or '_C1' in name_attr or '_C2' in name_attr or '_CE1' in name_attr or '_CE2' in name_attr or
                '_PHL' in name_attr or '_MEL' in name_attr):  # Sometimes 'main' is used for categories
            continue

        # Get the category title from the parent element's text or the next bold text
        category_title = ""
        if a.parent and a.parent.find('b'):
            category_title = a.parent.find('b').get_text(strip=True)
        elif a.find_next('b'):
            category_title = a.find_next('b').get_text(strip=True)

        # Determine the category type based on the name attribute or title
        el_type = None
        if name_attr.endswith('_CEL') or '_COR' in name_attr or '_CE1' in name_attr or '_C1' in name_attr or name_attr.endswith('_CE2') or name_attr.endswith('_C2'):
            el_type = 'core'
        elif name_attr.endswith('_REQ') or name_attr.endswith('_MEL') or name_attr.endswith('_PHL'):
            el_type = 'required'
        elif name_attr.endswith('_AEL') or name_attr.endswith('_ARE'):
            el_type = 'area'
        elif name_attr.endswith('_FEL') or name_attr.endswith('_FRE'):
            el_type = 'free'
        elif name_attr == 'UC_FENS' or name_attr == 'UC_FASS':
            el_type = 'university'
        else:
            # If we can't determine from the name attribute, use the title text
            el_type = map_category(category_title)

        # Improved table finding logic - try multiple approaches
        table = None

        # Method 1: Look for tables in the next few siblings after the anchor
        current_element = a
        for _ in range(10):  # Look through next 10 elements
            current_element = current_element.find_next()
            if not current_element:
                break

            if current_element.name == 'table':
                # Check if this table has course-like structure
                if current_element.find('th', string=lambda s: s and ('Course' in s or 'Name' in s or 'ECTS' in s or 'SU Credits' in s)):
                    table = current_element
                    break
                # Also check for tables with course data even without headers
                rows = current_element.find_all('tr')
                if len(rows) > 1:  # Must have more than just header
                    first_data_row = None
                    for row in rows[1:]:  # Skip potential header
                        tds = row.find_all('td')
                        if len(tds) >= 5 and tds[1] and tds[1].get_text(strip=True):
                            # Check if the second column looks like a course code
                            course_text = tds[1].get_text(strip=True).replace('\xa0', ' ')
                            if re.match(r'^[A-Z]+\s*\d+', course_text):
                                table = current_element
                                break
                    if table:
                        break

        # Method 2: If no table found yet, try looking in parent table structure and finding next sibling tables
        if not table:
            parent_table = a.find_parent('table')
            if parent_table:
                # Look for the next table after the parent table
                next_element = parent_table.find_next_sibling()
                while next_element:
                    if next_element.name == 'tr':
                        # Check if this tr contains a table
                        nested_table = next_element.find('table')
                        if nested_table and nested_table.find('th', string=lambda s: s and ('Course' in s or 'Name' in s)):
                            table = nested_table
                            break
                    elif next_element.name == 'table':
                        if next_element.find('th', string=lambda s: s and ('Course' in s or 'Name' in s)):
                            table = next_element
                            break
                    next_element = next_element.find_next_sibling()

        # Method 3: Alternative approach - look for tables within a reasonable distance
        if not table:
            # Find all tables after this anchor within a reasonable scope
            all_tables = []
            current = a
            for _ in range(20):  # Look through next 20 elements
                current = current.find_next('table')
                if not current:
                    break
                all_tables.append(current)

            # Find the first table that looks like a course table
            for candidate_table in all_tables:
                if candidate_table.find('th', string=lambda s: s and ('Course' in s or 'Name' in s or 'ECTS' in s)):
                    table = candidate_table
                    break

        # If we found a table, parse it
        if table:
            new_rows = parse_table(table, el_type)
            for row in new_rows:
                course_id = f"{row['Major']}{row['Code']}"
                if course_id not in seen_courses:
                    results.append(row)
                    seen_courses.add(course_id)

        # Check for a link to additional courses in this category (existing logic)
        links = []
        if a.find_parent('table'):
            links = a.find_parent('table').find_all('a', href=lambda h: h and 'p_list_courses' in h)

        # If no links found, try a broader search in nearby elements
        if not links and a.parent:
            # Look in following siblings and their children
            for sibling in a.parent.find_next_siblings():
                links.extend(sibling.find_all('a', href=lambda h: h and 'p_list_courses' in h))

            # Also search in the next few elements after the anchor
            current_element = a
            for _ in range(15):  # Look through next 15 elements for Click links
                current_element = current_element.find_next()
                if not current_element:
                    break
                if current_element.name == 'a' and current_element.get('href') and 'p_list_courses' in current_element.get('href'):
                    links.append(current_element)

        for link in links:
            # Extract category from the link URL to double-check
            area_match = re.search(r'P_AREA=([^&]+)', link['href'])
            if area_match:
                area_code = area_match.group(1)
                # Override el_type if we have a more specific area code from the URL
                if '_CEL' in area_code or '_COR' in area_code or '_CE1' in area_code or '_C1' in area_code or '_CE2' in area_code or '_C2' in area_code:
                    el_type = 'core'
                elif '_REQ' in area_code or '_MEL' in area_code or '_PHL' in area_code:
                    el_type = 'required'
                elif '_AEL' in area_code or '_ARE' in area_code:
                    el_type = 'area'
                elif '_FEL' in area_code or '_FRE' in area_code:
                    el_type = 'free'
                elif 'UC_' in area_code:
                    el_type = 'university'
                else:
                    el_type = 'unknown'
            list_url = urljoin(BASE, link['href'])
            new_rows = crawl_list(list_url, el_type)
            for row in new_rows:
                course_id = f"{row['Major']}{row['Code']}"
                if course_id not in seen_courses:
                    results.append(row)
                    seen_courses.add(course_id)

    # Add a fallback method to catch links that might have been missed
    # Look for all "Click" links throughout the page
    for click_link in soup.find_all('a', href=lambda h: h and 'p_list_courses' in h):
        area_match = re.search(r'P_AREA=([^&]+)', click_link['href'])
        if area_match:
            area_code = area_match.group(1)
            # Determine category from area code
            if '_CEL' in area_code or '_COR' in area_code or '_CE1' in area_code or '_CE2' in area_code or '_C1' in area_code or '_C2' in area_code:
                el_type = 'core'
            elif '_REQ' in area_code:
                el_type = 'required'
            elif '_AEL' in area_code or '_ARE' in area_code:
                el_type = 'area'
            elif '_FEL' in area_code or '_FRE' in area_code:
                el_type = 'free'
            elif 'UC_' in area_code:
                el_type = 'university'
            elif '_PHL' in area_code or '_MEL' in area_code:
                el_type = 'required'
            else:
                # Default to if unknown
                el_type = 'unknown'

            list_url = urljoin(BASE, click_link['href'])
            new_rows = crawl_list(list_url, el_type)
            for row in new_rows:
                course_id = f"{row['Major']}{row['Code']}"
                if course_id not in seen_courses:
                    results.append(row)
                    seen_courses.add(course_id)

    return results


def main():
    global _net_semaphore, _http_timeout_s, _http_retries, _http_backoff_s, _http_sleep_s

    parser = argparse.ArgumentParser(description="Fetch and regenerate course catalogs.")
    parser.add_argument("--workers", type=int, default=6, help="Parallel workers for fetching programs.")
    parser.add_argument(
        "--max-inflight",
        type=int,
        default=6,
        help="Maximum simultaneous HTTP requests (helps avoid throttling).",
    )
    parser.add_argument("--timeout", type=float, default=30.0, help="HTTP timeout in seconds.")
    parser.add_argument("--retries", type=int, default=2, help="Retry count for HTTP errors.")
    parser.add_argument("--backoff", type=float, default=0.5, help="Base backoff seconds for retries (exponential).")
    parser.add_argument("--sleep", type=float, default=0.0, help="Optional sleep after each successful request.")
    parser.add_argument("--terms", default="", help="Comma-separated explicit term codes (e.g. 202401,202402).")
    parser.add_argument("--max-terms", type=int, default=0, help="Limit number of terms processed (debug).")
    parser.add_argument("--max-programs", type=int, default=0, help="Limit number of programs per term (debug).")
    parser.add_argument("--skip-minors", action="store_true", help="Skip fetching minor catalogs/requirements.")
    parser.add_argument("--skip-coursepages", action="store_true", help="Skip running scrape_coursepages.py after fetching.")
    args = parser.parse_args()

    _http_timeout_s = float(args.timeout)
    _http_retries = int(args.retries)
    _http_backoff_s = float(args.backoff)
    _http_sleep_s = float(args.sleep)
    _net_semaphore = threading.Semaphore(max(1, int(args.max_inflight)))

    os.makedirs(COURSES_DIR, exist_ok=True)

    programs = get_program_codes()

    if args.terms.strip():
        terms = [t.strip() for t in args.terms.split(",") if t.strip()]
    else:
        # Generate terms dynamically (same date rules as the web app) so we do
        # not have to bump a hard-coded year cap each year.
        terms = generate_terms(start_year=2019)

    if args.max_terms and args.max_terms > 0:
        terms = terms[: int(args.max_terms)]

    majors_by_term = {}

    workers = max(1, int(args.workers))
    program_items = list(PROGRAM_FILES.items())
    if args.max_programs and args.max_programs > 0:
        program_items = program_items[: int(args.max_programs)]

    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
        for term in terms:
            term_dir = os.path.join(COURSES_DIR, term)
            os.makedirs(term_dir, exist_ok=True)
            majors_found = []

            futures = {}
            for code, fname in program_items:
                if code not in programs:
                    continue
                futures[executor.submit(crawl_program, code, term)] = (code, fname)

            for future in concurrent.futures.as_completed(futures):
                code, fname = futures[future]
                try:
                    data = future.result()
                    if not data:
                        raise ValueError('no data parsed')
                except Exception as e:
                    print(f"Failed {code} {term}: {e}")
                    continue
                majors_found.append(os.path.splitext(fname)[0])
                with open(os.path.join(term_dir, fname), 'w', encoding='utf-8') as f:
                    for rec in data:
                        f.write(json.dumps(rec, ensure_ascii=False) + "\n")
                print(f"Updated {fname} for term {term} with {len(data)} records")

            if majors_found:
                # Keep deterministic output regardless of thread completion order.
                majors_by_term[term] = sorted(set(majors_found))

    # Write mapping of majors per term
    with open(os.path.join(COURSES_DIR, 'terms.jsonl'), 'w', encoding='utf-8') as f:
        for term in sorted(majors_by_term.keys()):
            f.write(json.dumps({"term": term, "majors": majors_by_term[term]}, ensure_ascii=False) + "\n")

    if not args.skip_minors:
        # Fetch minor catalogs + requirements. By default we only fetch the
        # same term set as majors (either the explicit --terms list, or the
        # generated list in this script).
        try:
            minor_terms = [t for t in (terms or []) if re.fullmatch(r"\d{6}", t)]
            if minor_terms:
                # Be gentler than the majors scraper to avoid getting blocked:
                # minors scraping is an additional N requests per term.
                minor_workers = min(max(1, int(args.workers)), 3)
                minor_max_inflight = min(max(1, int(args.max_inflight)), 3)
                minor_sleep = max(float(_http_sleep_s or 0.0), 0.05 if len(minor_terms) > 1 else 0.0)
                print("\nRunning fetch_minors.py to update minor catalogs/requirements...\n")
                subprocess.run(
                    [
                        'python',
                        'fetch_minors.py',
                        '--terms', ",".join(minor_terms),
                        '--workers', str(minor_workers),
                        '--max-inflight', str(minor_max_inflight),
                        '--timeout', str(_http_timeout_s),
                        '--retries', str(_http_retries),
                        '--backoff', str(_http_backoff_s),
                        '--sleep', str(minor_sleep),
                        '--write-legacy',
                    ],
                    check=True
                )
        except Exception as e:
            print(f"Warning: failed to fetch minors: {e}")

    if not args.skip_coursepages:
        # Populate Basic_Science / Engineering credits by scraping course pages.
        # (The old CSV-based update_credits.py remains available but is deprecated.)
        print("\nRunning scrape_coursepages.py to update credits in JSON files...\n")
        subprocess.run(['python', 'scrape_coursepages.py'], check=True)


if __name__ == '__main__':
    main()
