import csv
import json
import re
import os
import subprocess

COURSES_DIR = 'courses'

"""
Deprecated: the university no longer provides an official Basic Science / Engineering
credits list in the same way this script expects. Prefer `scrape_coursepages.py`,
which scrapes the ECTS breakdown from each course page.
"""

def extract_credits_from_csv(csv_path):
    """
    Extract Basic Science and Engineering credits from the CSV file.
    Returns a dictionary mapping course codes to their BS and Eng credits.
    """
    credits_map = {}
    skip_header = True

    with open(csv_path, 'r', encoding='utf-8') as file:
        csv_reader = csv.reader(file)

        for row in csv_reader:
            # Skip the first few header rows
            if skip_header:
                if len(row) >= 3 and "Subject" in row[0] and "No" in row[1] and "Code" in row[2]:
                    skip_header = False
                continue

            # Skip header rows that might appear within the data
            if len(row) < 3 or row[0] == "Subject" or not row[0]:
                continue

            try:
                # Extract course code
                subject = row[0].strip()
                number = row[1].strip()
                course_code = f"{subject}{number}"

                # Check if we have enough columns for the data
                if len(row) >= 8:  # Need at least 8 columns for ECTS, Eng, BS
                    try:
                        # Skip ECTS (first numerical column)
                        # Engineering credits are in the second numerical column (index 6)
                        engineering = float(row[6].replace(',', '.')) if row[6] and row[6] != '-' else 0
                    except ValueError:
                        engineering = 0

                    try:
                        # Basic Science credits are in the third numerical column (index 7)
                        basic_science = float(row[7].replace(',', '.')) if row[7] and row[7] != '-' else 0
                    except ValueError:
                        basic_science = 0

                    credits_map[course_code] = {
                        'Basic_Science': basic_science,
                        'Engineering': engineering
                    }
            except Exception as e:
                print(f"Error processing row {row}: {e}")

    return credits_map

def update_json_with_credits(json_path, credits_map):
    """
    Update a JSON file with Basic Science and Engineering credits.
    """

    try:
        data = []
        if json_path.endswith('.jsonl'):
            with open(json_path, 'r', encoding='utf-8') as file:
                for line in file:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        rec = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if isinstance(rec, dict):
                        data.append(rec)
        else:
            with open(json_path, 'r', encoding='utf-8') as file:
                data = json.load(file)
                if not isinstance(data, list):
                    data = []

        updated_count = 0
        for course in data:
            course_code = f"{course['Major']}{course['Code']}"
            if course_code in credits_map:
                course['Basic_Science'] = credits_map[course_code]['Basic_Science']
                course['Engineering'] = credits_map[course_code]['Engineering']
                updated_count += 1

        if json_path.endswith('.jsonl'):
            with open(json_path, 'w', encoding='utf-8') as file:
                for rec in data:
                    file.write(json.dumps(rec, ensure_ascii=False) + "\n")
        else:
            with open(json_path, 'w', encoding='utf-8') as file:
                json.dump(data, file, indent=2, ensure_ascii=False)

        print(f"Updated {json_path} with BS and Eng credits for {updated_count} courses")

    except Exception as e:
        print(f"Error updating {json_path}: {e}")

def update_all_program_files(credits_map, program_files):
    """Update all program JSON files with Basic Science and Engineering credits.

    The courses directory may contain subfolders for each academic term
    (e.g. ``202401``). This function walks through each term folder as well as
    the root and reports any files that could not be updated.
    """

    term_dirs = ['.']
    term_dirs += [d for d in os.listdir(COURSES_DIR) if re.match(r'\d{6}$', d)]

    failed_terms = []

    for term in term_dirs:
        term_path = os.path.join(COURSES_DIR, term) if term != '.' else COURSES_DIR
        term_ok = True
        for program_file in program_files.values():
            primary_path = os.path.join(term_path, program_file)
            alt_path = None
            if program_file.endswith('.jsonl'):
                alt_path = os.path.join(term_path, program_file[:-1])  # .jsonl -> .json
            elif program_file.endswith('.json'):
                alt_path = os.path.join(term_path, program_file + 'l')  # .json -> .jsonl

            target = None
            if os.path.exists(primary_path):
                target = primary_path
            elif alt_path and os.path.exists(alt_path):
                target = alt_path

            if target:
                try:
                    update_json_with_credits(target, credits_map)
                except Exception as e:
                    print(f"Failed updating {target}: {e}")
                    term_ok = False
            else:
                print(f"Missing {primary_path}")
                term_ok = False
        if not term_ok:
            failed_terms.append(term)

    if failed_terms:
        print('Failed updates for terms: ' + ', '.join(failed_terms))
    else:
        print('All term updates completed successfully.')

if __name__ == "__main__":
    csv_path = "Pre-Conversion Files/katalog_basic_eng_degerler_202401_yuklenen_07.05.2025 (1)-converted.csv"

    program_files = {
        'BSBIO': 'BIO.jsonl',
        'BSCS': 'CS.jsonl',
        'BAECON': 'ECON.jsonl',
        'BSEE': 'EE.jsonl',
        'BSMS': 'IE.jsonl',
        'BSMAT': 'MAT.jsonl',
        'BSME': 'ME.jsonl',
        'BSDSA': 'DSA.jsonl',
        'BAMAN': 'MAN.jsonl',
        'BAPSIR': 'PSIR.jsonl',
        'BAPSY': 'PSY.jsonl',
        'BAVACD': 'VACD.jsonl',
    }

    print("Extracting credits from CSV file...")
    credits_map = extract_credits_from_csv(csv_path)
    print(f"Extracted credits for {len(credits_map)} courses")

    print("Updating program files with extracted credits...")
    update_all_program_files(credits_map, program_files)

    print("Update complete!")
