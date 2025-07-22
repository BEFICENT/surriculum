import requests
from bs4 import BeautifulSoup
import json

BASE = 'https://suis.sabanciuniv.edu/prod/'
LIST_URL = BASE + 'SU_DEGREE.p_list_degree?P_LEVEL=UG&P_LANG=EN&P_PRG_TYPE='


def get_program_codes():
    resp = requests.get(LIST_URL)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, 'lxml')
    links = soup.select('a[href*="P_PROGRAM="]')
    codes = {}
    for a in links:
        href = a['href']
        code = href.split('P_PROGRAM=')[1].split('&')[0]
        codes[code] = a.get_text(strip=True)
    return codes


def get_latest_term(code):
    url = BASE + f'SU_DEGREE.p_select_term?P_PROGRAM={code}&P_LANG=EN&P_LEVEL=UG'
    resp = requests.get(url)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, 'lxml')
    opt = soup.select_one('select[name=P_TERM] option')
    return opt['value'] if opt else None


def parse_courses(code, term):
    url = (BASE + 'SU_DEGREE.p_degree_detail?P_PROGRAM={code}&P_LANG=EN&P_LEVEL=UG'
           f'&P_TERM={term}&P_SUBMIT=Select').format(code=code, term=term)
    resp = requests.get(url)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, 'lxml')
    results = []
    # iterate over category tables
    for cat_header in soup.select('p > a[name]'):
        category_title = cat_header.find_next(string=True).strip()
        # first table is description, next table holds the course list
        desc_table = cat_header.find_parent('p').find_next('table')
        table = desc_table.find_next('table') if desc_table else None
        if not table:
            continue
        for tr in table.select('tr')[1:]:  # skip header row
            cells = [td.get_text(strip=True) for td in tr.select('td')]
            if len(cells) >= 5 and cells[1]:
                course_code = cells[1]
                name = cells[2]
                ects = cells[3]
                su = cells[4]
                faculty = cells[5] if len(cells) > 5 else ''
                results.append({
                    'Program': code,
                    'Category': category_title,
                    'Code': course_code,
                    'Name': name,
                    'ECTS': ects,
                    'SU_credit': su,
                    'Faculty': faculty,
                })
    return results


def main():
    programs = get_program_codes()
    all_courses = []
    for code, name in programs.items():
        term = get_latest_term(code)
        if not term:
            continue
        courses = parse_courses(code, term)
        all_courses.extend(courses)
    with open('courses_latest.json', 'w') as f:
        json.dump(all_courses, f, indent=2)

if __name__ == '__main__':
    main()
