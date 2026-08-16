(function (global) {
    'use strict';

    const PDFJS_VERSION = '6.2.108';
    const PDFJS_MODULE_PATH = 'assets/vendor/pdfjs-6.2.108/pdf.min.mjs';
    const PDFJS_WORKER_PATH = 'assets/vendor/pdfjs-6.2.108/pdf.worker.min.mjs';
    const LIMITS = Object.freeze({
        maxFileBytes: 10 * 1024 * 1024,
        maxPages: 100,
        maxTextItems: 50000,
        maxTextCharacters: 1000000
    });

    class PdfTranscriptReadError extends Error {
        constructor(code, message) {
            super(message);
            this.name = 'PdfTranscriptReadError';
            this.code = code;
        }
    }

    function appUrl(path) {
        if (typeof document === 'undefined' || !document.baseURI) {
            throw new PdfTranscriptReadError('PDF_RUNTIME_UNAVAILABLE', 'The PDF reader requires a browser page URL.');
        }
        return new URL(path, document.baseURI).href;
    }

    let libraryPromise = null;
    function loadLibrary() {
        if (libraryPromise) return libraryPromise;

        libraryPromise = import(appUrl(PDFJS_MODULE_PATH)).then((pdfjs) => {
            if (!pdfjs || pdfjs.version !== PDFJS_VERSION || !pdfjs.GlobalWorkerOptions) {
                throw new PdfTranscriptReadError(
                    'PDF_RUNTIME_MISMATCH',
                    `Expected PDF.js ${PDFJS_VERSION}, but a different or incomplete runtime was loaded.`
                );
            }
            pdfjs.GlobalWorkerOptions.workerSrc = appUrl(PDFJS_WORKER_PATH);
            return pdfjs;
        }).catch((error) => {
            libraryPromise = null;
            throw error;
        });
        return libraryPromise;
    }

    function limitError(code, message) {
        return new PdfTranscriptReadError(code, message);
    }

    async function extractText(file) {
        if (!file || typeof file.arrayBuffer !== 'function') {
            throw new PdfTranscriptReadError('PDF_INVALID_FILE', 'No readable PDF file was provided.');
        }

        const reportedSize = Number(file.size);
        if (Number.isFinite(reportedSize) && reportedSize > LIMITS.maxFileBytes) {
            throw limitError('PDF_FILE_TOO_LARGE', 'The PDF is larger than the 10 MB import limit.');
        }

        const arrayBuffer = await file.arrayBuffer();
        if (arrayBuffer.byteLength > LIMITS.maxFileBytes) {
            throw limitError('PDF_FILE_TOO_LARGE', 'The PDF is larger than the 10 MB import limit.');
        }

        const pdfjs = await loadLibrary();
        let loadingTask = null;
        let primaryError = null;
        try {
            // This importer only extracts text. Disabling WASM avoids loading
            // optional decoders that are unnecessary for transcript PDFs.
            loadingTask = pdfjs.getDocument({
                data: new Uint8Array(arrayBuffer),
                useWasm: false
            });
            const pdf = await loadingTask.promise;
            if (!Number.isInteger(pdf.numPages) || pdf.numPages < 1) {
                throw new PdfTranscriptReadError('PDF_INVALID_FILE', 'The PDF contains no readable pages.');
            }
            if (pdf.numPages > LIMITS.maxPages) {
                throw limitError('PDF_TOO_MANY_PAGES', `The PDF has more than ${LIMITS.maxPages} pages.`);
            }

            const chunks = [];
            let totalTextItems = 0;
            let totalTextCharacters = 0;

            for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                let page = null;
                try {
                    page = await pdf.getPage(pageNum);
                    const content = await page.getTextContent();
                    const items = Array.isArray(content && content.items) ? content.items : [];
                    totalTextItems += items.length;
                    if (totalTextItems > LIMITS.maxTextItems) {
                        throw limitError(
                            'PDF_TOO_COMPLEX',
                            `The PDF contains more than ${LIMITS.maxTextItems.toLocaleString()} text fragments.`
                        );
                    }

                    const strings = items.map((item) => String(item && item.str || ''));
                    const pageTextCharacters = strings.reduce((sum, value) => sum + value.length, 0);
                    totalTextCharacters += pageTextCharacters;
                    if (totalTextCharacters > LIMITS.maxTextCharacters) {
                        throw limitError(
                            'PDF_TOO_COMPLEX',
                            `The PDF contains more than ${LIMITS.maxTextCharacters.toLocaleString()} text characters.`
                        );
                    }

                    const averageLength = pageTextCharacters / Math.max(1, strings.length);
                    // Some PDFs yield character-level items. Spaces preserve
                    // tokens in that case; otherwise line breaks retain rows.
                    chunks.push((averageLength <= 1.2 ? strings.join(' ') : strings.join('\n')) + '\n');
                } finally {
                    if (page && typeof page.cleanup === 'function') {
                        try { page.cleanup(); } catch (_) {}
                    }
                }
            }

            const text = chunks.join('');
            if (totalTextItems === 0 || !text.trim()) {
                throw new PdfTranscriptReadError(
                    'PDF_NO_TEXT',
                    'The PDF has no extractable text layer.'
                );
            }

            return Object.freeze({
                text,
                pageCount: pdf.numPages,
                textItemCount: totalTextItems,
                textCharacterCount: totalTextCharacters,
                pdfjsVersion: pdfjs.version
            });
        } catch (error) {
            primaryError = error;
            throw error;
        } finally {
            if (loadingTask && typeof loadingTask.destroy === 'function') {
                try {
                    await loadingTask.destroy();
                } catch (cleanupError) {
                    // Preserve the useful extraction error when cleanup also
                    // fails; otherwise surface the cleanup failure to callers.
                    if (!primaryError) throw cleanupError;
                    try { console.warn('PDF.js cleanup failed:', cleanupError); } catch (_) {}
                }
            }
        }
    }

    global.pdfTranscriptReader = Object.freeze({
        version: PDFJS_VERSION,
        limits: LIMITS,
        paths: Object.freeze({
            module: PDFJS_MODULE_PATH,
            worker: PDFJS_WORKER_PATH
        }),
        loadLibrary,
        extractText,
        PdfTranscriptReadError
    });
})(window);
