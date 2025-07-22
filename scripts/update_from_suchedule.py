import json
from pathlib import Path
import argparse

COURSE_DETAIL_URL = "https://suis.sabanciuniv.edu/prod/bwckctlg.p_disp_course_detail"
"""Merge course data from the suchedule scraper into existing JSON lists."""

import requests
from bs4 import BeautifulSoup
import re

def fetch_course_detail(code: str, term: int, *, lookup: bool = False):
    """Return detail dictionary for a course.

    If ``lookup`` is False (default) network requests are skipped and
    placeholder values are returned.  This keeps updates fast when
    only course codes are needed.
    """
    if not lookup:
        return {
            'ECTS': '0',
            'SU_credit': '0',
            'Faculty': ''
        }

    subj, num = code.split()
    params = {'cat_term_in': term, 'subj_code_in': subj, 'crse_numb_in': num}
    r = requests.get(COURSE_DETAIL_URL, params=params)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, 'html.parser')
    text = ' '.join(soup.stripped_strings)
    ects = re.search(r'(\d+)\s*ECTS', text)
    su_credit = re.search(r'(\d+)\.000\s*Credit hours', text)
    faculty = re.search(r'Course Offered by ([A-Z]+)', text)
    return {
        'ECTS': ects.group(1) if ects else '0',
        'SU_credit': su_credit.group(1) if su_credit else '0',
        'Faculty': faculty.group(1) if faculty else '',
    }

def load_json(path: Path):
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)

def save_json(path: Path, data):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def main():
    parser = argparse.ArgumentParser(description="Update course jsons from suchedule")
    parser.add_argument('--su', default='../suchedule/data-v59.min.json', help='Path to suchedule data')
    parser.add_argument('--term', type=int, default=20258, help='Term code for optional detail lookup')
    parser.add_argument('--lookup-detail', action='store_true', help='Fetch ECTS and faculty info from SUIS')
    parser.add_argument('json_files', nargs='+', help='Course json files to update')
    args = parser.parse_args()

    with open(args.su) as f:
        su_data = json.load(f)['courses']
    su_map = {c['code']: c['name'] for c in su_data}

    for jf in args.json_files:
        path = Path(jf)
        data = load_json(path)
        codes = {f"{c['Major']} {c['Code']}" for c in data}
        added = 0
        for code, name in su_map.items():
            if code not in codes:
                detail = fetch_course_detail(code, args.term, lookup=args.lookup_detail)
                major, num = code.split()
                data.append({
                    'Major': major,
                    'Code': num,
                    'Course_Name': name,
                    'ECTS': detail['ECTS'],
                    'Engineering': 0,
                    'Basic_Science': 0,
                    'SU_credit': detail['SU_credit'],
                    'Faculty': detail['Faculty'],
                    'EL_Type': 'free'
                })
                added += 1
        if added:
            print(f"{jf}: added {added} courses")
            save_json(path, data)
        else:
            print(f"{jf}: no changes")

if __name__ == '__main__':
    main()
