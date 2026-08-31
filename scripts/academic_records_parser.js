// Academic Records compatibility bridge. Parsing and planner mutation live in
// focused classic-script modules loaded immediately before this file.
(function installAcademicRecordsCompatibility(root) {
    'use strict';

    const namespace = root.SurriculumModules || (root.SurriculumModules = {});
    const parsing = namespace.academicRecordsParsing;
    const importer = namespace.academicRecordsImporter;
    if (!parsing || !importer) {
        throw new Error(
            'scripts/academic-records/parser.js and importer.js must load before academic_records_parser.js',
        );
    }

    // Preserve the established public shape and function identities exactly.
    root.academicRecordsParser = {
        parseAcademicRecords: parsing.parseAcademicRecords,
        parseAcademicRecordsPdf: parsing.parseAcademicRecordsPdf,
        importParsedCourses: importer.importParsedCourses,
    };
})(typeof window !== 'undefined' ? window : globalThis);
