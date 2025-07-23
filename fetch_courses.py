import re
import json
import requests
from urllib.parse import urljoin
from bs4 import BeautifulSoup
import subprocess

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
    'BSDSA': 'DSA.json',  # Adding Data Science and Analytics program
    'BAMAN': 'MAN.json',  # Management program
    'BAPSIR': 'PSIR.json',  # Political Science and International Relations
    'BAPSY': 'PSY.json',  # Psychology program
    'BAVACD': 'VACD.json',  # Visual Arts and Visual Communication Design
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
    if 'faculty courses' in t:
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
    seen_courses = set()  # Track seen courses to avoid duplicates

    # First, try to extract category information from the name attribute
    for a in soup.select('a[name]'):
        name_attr = a.get('name', '')
        # Skip non-category anchors with improved pattern matching
        if not (name_attr.endswith('_CEL') or name_attr.endswith('_REQ') or
                name_attr.endswith('_AEL') or name_attr.endswith('_FEL') or name_attr.endswith('_ARE') or name_attr.endswith('_FRE') or
                name_attr == 'UC_FENS' or name_attr == 'FC_FENS' or
                'BASIC_SCIE' in name_attr or 'ENG_SCIE' in name_attr or
                name_attr.startswith('main')):  # Sometimes 'main' is used for categories
            continue

        # Get the category title from the parent element's text or the next bold text
        category_title = ""
        if a.parent and a.parent.find('b'):
            category_title = a.parent.find('b').get_text(strip=True)
        elif a.find_next('b'):
            category_title = a.find_next('b').get_text(strip=True)

        # Determine the category type based on the name attribute or title
        el_type = None
        if name_attr.endswith('_CEL'):
            el_type = 'core'
        elif name_attr.endswith('_REQ'):
            el_type = 'required'
        elif name_attr.endswith('_AEL') or name_attr.endswith('_ARE'):
            el_type = 'area'
        elif name_attr.endswith('_FEL') or name_attr.endswith('_FRE'):
            el_type = 'free'
        elif name_attr == 'UC_FENS':
            el_type = 'university'
        elif name_attr == 'FC_FENS':
            el_type = 'faculty'
        elif 'BASIC_SCIE' in name_attr:
            el_type = 'basic_science'
        elif 'ENG_SCIE' in name_attr:
            el_type = 'engineering'
        else:
            # If we can't determine from the name attribute, use the title text
            el_type = map_category(category_title)

        # Find the corresponding table with course information - improved table finding
        table = None
        # First try the standard way
        parent_table = a.find_parent('table')
        if parent_table:
            table = parent_table.find_next('table')
            attempts = 0
            # Look through several next tables to find one with course headers
            while table and attempts < 3 and not table.find('th', string=lambda s: s and ('Course' in s or 'Name' in s)):
                table = table.find_next('table')
                attempts += 1

        if table:
            new_rows = parse_table(table, el_type)
            for row in new_rows:
                course_id = f"{row['Major']}{row['Code']}"
                if course_id not in seen_courses:
                    results.append(row)
                    seen_courses.add(course_id)

        # Check for a link to additional courses in this category
        links = []
        if a.find_parent('table'):
            links = a.find_parent('table').find_all('a', href=lambda h: h and 'p_list_courses' in h)

        # If no links found, try a broader search in nearby elements
        if not links and a.parent:
            # Look in following siblings and their children
            for sibling in a.parent.find_next_siblings():
                links.extend(sibling.find_all('a', href=lambda h: h and 'p_list_courses' in h))

        for link in links:
            # Extract category from the link URL to double-check
            area_match = re.search(r'P_AREA=([^&]+)', link['href'])
            if area_match:
                area_code = area_match.group(1)
                # Override el_type if we have a more specific area code from the URL
                if '_CEL' in area_code:
                    el_type = 'core'
                elif '_REQ' in area_code:
                    el_type = 'required'
                elif '_AEL' in area_code or '_ARE' in area_code:
                    el_type = 'area'
                elif '_FEL' in area_code or '_FRE' in area_code:
                    el_type = 'free'
                elif 'UC_' in area_code:
                    el_type = 'university'
                elif 'FC_' in area_code:
                    el_type = 'faculty'

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
            if '_CEL' in area_code:
                el_type = 'core'
            elif '_REQ' in area_code:
                el_type = 'required'
            elif '_AEL' in area_code or '_ARE' in area_code:
                el_type = 'area'
            elif '_FEL' in area_code or '_FRE' in area_code:
                el_type = 'free'
            elif 'UC_' in area_code:
                el_type = 'university'
            elif 'FC_' in area_code:
                el_type = 'faculty'
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

    # Optionally run update_credits.py after updating course files
    print("\nRunning update_credits.py to update credits in JSON files...\n")
    subprocess.run(['python', 'update_credits.py'], check=True)


if __name__ == '__main__':
    main()
