import re
import json
import requests
from urllib.parse import urljoin
from bs4 import BeautifulSoup

BASE = 'https://suis.sabanciuniv.edu/prod/'
LIST_URL = BASE + 'SU_DEGREE.p_list_degree?P_LEVEL=UG&P_LANG=EN&P_PRG_TYPE='

PROGRAM_FILES = {
    'BSBIO': 'BIO.json',
    'BSCS': 'CS.json',
    'BAECON': 'ECON.json',
    'BSEE': 'EE.json',
    'BSMS': 'IE.json',
    'BSMAT': 'MAT.json',
    'BSME': 'ME.json',
}


def get_program_codes():
    resp = requests.get(LIST_URL)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, 'lxml')
    codes = {}
    for a in soup.select('a[href*="P_PROGRAM="]'):
        m = re.search(r'P_PROGRAM=([^&]+)', a['href'])
        if m:
            codes[m.group(1)] = a.get_text(strip=True)
    return codes


def get_latest_term(code):
    url = BASE + f'SU_DEGREE.p_select_term?P_PROGRAM={code}&P_LANG=EN&P_LEVEL=UG'
    resp = requests.get(url)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, 'lxml')
    opt = soup.select_one('select[name=P_TERM] option')
    return opt['value'] if opt else None


def map_category(title):
    t = title.lower()
    if 'university' in t:
        return 'university'
    if 'required' in t:
        return 'required'
    if 'core' in t and 'elective' in t:
        return 'core'
    if 'area' in t and 'elective' in t:
        return 'area'
    if 'free' in t and 'elective' in t:
        return 'free'
    if 'faculty courses' in t:
        return 'free'
    return 'free'


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
            rows.append({
                'Major': major,
                'Code': number,
                'Course_Name': tds[2],
                'ECTS': tds[3],
                'Engineering': 0,
                'Basic_Science': 0,
                'SU_credit': tds[4],
                'Faculty': tds[5] if len(tds) > 5 else '',
                'EL_Type': category,
            })
    return rows


def crawl_list(url, category):
    resp = requests.get(url)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, 'lxml')
    table = soup.find('table')
    return parse_table(table, category) if table else []


def crawl_program(code, term):
    url = (BASE + 'SU_DEGREE.p_degree_detail?P_PROGRAM={code}&P_LANG=EN&P_LEVEL=UG'
           '&P_TERM={term}&P_SUBMIT=Select').format(code=code, term=term)
    resp = requests.get(url)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, 'lxml')
    results = []
    for a in soup.select('p > a[name]'):
        category_title = a.parent.get_text(strip=True)
        el_type = map_category(category_title)
        table = a.find_parent('table').find_next('table')
        while table and not table.find('th', string='Course'):
            table = table.find_next('table')
        if table:
            results.extend(parse_table(table, el_type))
        link = a.find_parent('table').find_next('a', href=lambda h: h and 'p_list_courses' in h)
        if link:
            list_url = urljoin(BASE, link['href'])
            results.extend(crawl_list(list_url, el_type))
    return results


def main():
    programs = get_program_codes()
    for code, fname in PROGRAM_FILES.items():
        if code not in programs:
            continue
        term = get_latest_term(code)
        if not term:
            continue
        data = crawl_program(code, term)
        with open(fname, 'w') as f:
            json.dump(data, f, indent=2)
        print(f'Updated {fname} with {len(data)} records')


if __name__ == '__main__':
    main()
