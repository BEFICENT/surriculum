import csv
import json
import re

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
        with open(json_path, 'r') as file:
            data = json.load(file)

        updated_count = 0
        for course in data:
            course_code = f"{course['Major']}{course['Code']}"
            if course_code in credits_map:
                course['Basic_Science'] = credits_map[course_code]['Basic_Science']
                course['Engineering'] = credits_map[course_code]['Engineering']
                updated_count += 1

        with open(json_path, 'w') as file:
            json.dump(data, file, indent=2)

        print(f"Updated {json_path} with BS and Eng credits for {updated_count} courses")

    except Exception as e:
        print(f"Error updating {json_path}: {e}")

def update_all_program_files(credits_map, program_files):
    """
    Update all program JSON files with Basic Science and Engineering credits.
    """
    for program_file in program_files.values():
        update_json_with_credits(program_file, credits_map)

if __name__ == "__main__":
    csv_path = "katalog_basic_eng_degerler_202401_yuklenen_07.05.2025 (1)-converted.csv"

    program_files = {
        'BSBIO': 'BIO.json',
        'BSCS': 'CS.json',
        'BAECON': 'ECON.json',
        'BSEE': 'EE.json',
        'BSMS': 'IE.json',
        'BSMAT': 'MAT.json',
        'BSME': 'ME.json',
        'BSDSA': 'DSA.json',
        'BAMAN': 'MAN.json',
        'BAPSIR': 'PSIR.json',
        'BAPSY': 'PSY.json',
        'BAVACD': 'VACD.json',
    }

    print("Extracting credits from CSV file...")
    credits_map = extract_credits_from_csv(csv_path)
    print(f"Extracted credits for {len(credits_map)} courses")

    print("Updating program files with extracted credits...")
    update_all_program_files(credits_map, program_files)

    print("Update complete!")
