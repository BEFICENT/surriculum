visit website from the link:
# Surriculum

This repository contains the source code for the Surriculum website, which is a curriculum for learning about computer science and software engineering topics.

The website is built using HTML, CSS, and JavaScript, and is designed to be a comprehensive resource for learners at all levels.

## Getting Started

To get started with the Surriculum website, you can clone this repository and open the `index.html` file in your web browser. You can also view the live version of the website at:
https://beficent.github.io/surriculum/

## Credit and Contribution

This repository is a fork of the original Surriculum project, updated and maintained by BEFICENT (Bilal M. G.). The updates include:

- Added support for the Data Science and Analytics (DSA) program and additional majors (MAN, PSIR, PSY, VACD)
- Fixed graduation requirements checking functionality
- Updated course lists for all programs
- Improved basic science and engineering credit calculation
- Enhanced error handling and documentation

The original repository was forked and updated to reflect current curriculum requirements and to add support for additional programs.

## Updating the Curriculum

### How to Update Course Data

If you need to update the course data or add new programs, follow these steps:

1. **Update the Python scripts**:
   - Modify `fetch_courses.py` to fetch the latest course information from the university website
   - Run the script to generate updated JSON files: `python fetch_courses.py`
   - Verify the generated `X.json's` contains the correct course information

2. **Update program-specific JSON files**:
   - Each program (CS, BIO, EE, IE, MAT, ME, ECON, DSA, MAN, PSIR, PSY, VACD) has its own JSON file
   - Make sure to update the appropriate files when programs change their requirements
   - Ensure courses are properly categorized (university, required, core, area, free, faculty)

3. **Update Basic Science and Engineering credits**:
   - Use `update_credits.py` to update ECTS values for basic science and engineering courses
   - Verify the HTML/CSV data source has the correct credit information
   - Pay attention to the correct column indexes when parsing the data

4. **Update graduation requirements in code**:
   - If program requirements change, update the `canGraduate()` method in `s_curriculum.js`
   - Add corresponding error messages in `main.js` for any new error codes
   - Update the credit limits in the summary modal section of `main.js`

### Important Warnings and Notes

⚠️ **Critical Warnings**:

1. **Error Messages**: When adding a new program or updating requirements, always add corresponding error messages in `main.js` for all error codes used in `s_curriculum.js`. Missing error messages will result in "undefined" errors.

2. **Program Requirements**: The summary display and graduation requirements must match exactly. Verify both `canGraduate()` in `s_curriculum.js` and the limits array in `main.js`.

3. **Basic Science/Engineering Parsing**: Be careful with column indexes when parsing basic science and engineering credits. Incorrect indexes will lead to wrong credit calculations.

4. **Course Categorization**: Be cautious when updating course categorization (university, core, etc.) as it affects graduation requirements checks.

5. **Faculty Courses**: For programs that require a minimum number of faculty courses (like DSA), make sure the faculty property is correctly set for relevant courses.

6. **Testing**: Always test the tool with various course combinations to ensure the graduation check works correctly for all programs.

7. **JSON Structure**: Maintain the same JSON structure when updating course data to ensure compatibility with the existing code.

By following these guidelines, you can successfully update the Surriculum tool to reflect the latest curriculum requirements. Just like how I updated the original repository, you can ensure that the tool remains a valuable resource for students and educators alike.
