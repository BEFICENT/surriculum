import json
import requests
from bs4 import BeautifulSoup
import os
import datetime
import re

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

def fetch_requirements(program, term, offline_dir=None):
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
        resp = requests.get(url)
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

def main():
    os.makedirs(REQUIREMENTS_DIR, exist_ok=True)
    # Generate term codes starting from 2019 up to Fall 2025 only.
    terms = []
    for year in range(2019, 2026):
        suffixes = ('01', '02', '03')
        if year == 2025:
            suffixes = ('01', '02')  # Only Fall and Spring 2025 should be scraped
        for suf in suffixes:
            terms.append(f"{year}{suf}")

    for term in terms:
        out = {}
        for prog, major in PROGRAM_CODES.items():
            try:
                data = fetch_requirements(prog, term, None)
                if not data:
                    raise ValueError('no data parsed')
            except Exception as e:
                print(f"Failed {major} {term}: {e}")
                data = {}
            if data:
                out[major] = data
        if out:
            with open(os.path.join(REQUIREMENTS_DIR, f'{term}.jsonl'), 'w', encoding='utf-8') as f:
                for major in sorted(out.keys()):
                    f.write(json.dumps({"major": major, **out[major]}, ensure_ascii=False) + "\n")

if __name__ == '__main__':
    main()
