import json
import re
import requests
from bs4 import BeautifulSoup
from pathlib import Path


TERM_DEFAULT = 20258  # example: 2025 fall term
COURSE_DETAIL_URL = "https://suis.sabanciuniv.edu/prod/bwckctlg.p_disp_course_detail"
COURSE_CODES_URL = "https://suis.sabanciuniv.edu/prod/bwckgens.p_proc_term_date"
COURSE_DATA_URL = "https://suis.sabanciuniv.edu/prod/bwckschd.p_get_crse_unsec"


def get_course_codes(term: int):
    payload = {'p_calling_proc': 'bwckschd.p_disp_dyn_sched', 'p_term': term}
    r = requests.post(COURSE_CODES_URL, data=payload)
    r.raise_for_status()
    soup = BeautifulSoup(r.content, 'html.parser')
    codes = [opt.get('value') for opt in soup.find_all('option') if opt.get('value')]
    codes = [code for code in codes if code.isupper() and code.isalpha()]
    codes.insert(0, 'dummy')
    return codes


def get_courses(term: int):
    codes = get_course_codes(term)
    payload = {
        'term_in': term,
        'sel_subj': codes,
        'sel_day': 'dummy',
        'sel_schd': 'dummy',
        'sel_insm': 'dummy',
        'sel_camp': 'dummy',
        'sel_levl': 'dummy',
        'sel_sess': 'dummy',
        'sel_instr': 'dummy',
        'sel_ptrm': 'dummy',
        'sel_attr': 'dummy',
        'sel_crse': '',
        'sel_title': '',
        'sel_from_cred': '',
        'sel_to_cred': '',
        'begin_hh': '0',
        'begin_mi': '0',
        'begin_ap': 'a',
        'end_hh': '0',
        'end_mi': '0',
        'end_ap': 'a',
    }
    r = requests.post(COURSE_DATA_URL, data=payload)
    r.raise_for_status()
    soup = BeautifulSoup(r.content, 'html.parser')
    labels = soup.find_all('th', class_='ddlabel')
    courses = []
    for label in labels:
        title = label.find('a').text
        if '-' in title:
            name_part, code_part = title.split('-', 1)
            code = code_part.strip().split()[0]
            name = name_part.strip()
            courses.append({'code': code, 'name': name})
    return courses


def fetch_course_detail(term: int, code: str):
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


def load_dataset(path: Path):
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def save_dataset(path: Path, data):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def main():
    import argparse
    parser = argparse.ArgumentParser(description='Update course list using SU schedule.')
    parser.add_argument('--term', type=int, default=TERM_DEFAULT, help='Academic term code')
    parser.add_argument('--input', default='CS.json', help='Existing course file (any major file)')
    parser.add_argument('--output', default='updated_courses.json', help='Output JSON with new courses')
    args = parser.parse_args()

    data = load_dataset(Path(args.input))
    existing_codes = {f"{c['Major']} {c['Code']}" for c in data}
    courses = get_courses(args.term)
    added = 0
    for course in courses:
        code = course['code']
        if code not in existing_codes:
            detail = fetch_course_detail(args.term, code)
            new_entry = {
                'Major': code.split()[0],
                'Code': code.split()[1],
                'Course_Name': course['name'],
                'ECTS': detail['ECTS'],
                'Engineering': 0,
                'Basic_Science': 0,
                'SU_credit': detail['SU_credit'],
                'Faculty': detail['Faculty'],
                'EL_Type': 'free'
            }
            data.append(new_entry)
            added += 1
    if added:
        print(f"Added {added} new courses")
        save_dataset(Path(args.output), data)
    else:
        print("No new courses found")


if __name__ == '__main__':
    main()
