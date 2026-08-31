// DOM rendering for planner course-picker result details and advisories.
(function installPlannerCoursePickerOptionRenderer(root) {
    'use strict';

    function createOptionRenderer(options) {
        const config = options || {};
        const document = config.document;
        const filterApi = config.filterApi;
        const controls = config.controls;
        const targetTermCode = String(config.targetTermCode || '');
        if (!document || !controls) {
            throw new TypeError('Course-picker renderer dependencies are required.');
        }

        const formatNumber = (value) => {
            const number = Number(value);
            if (!Number.isFinite(number)) return '0';
            return String(Math.round(number * 100) / 100);
        };
        const capitalizeFirst = (value) => {
            const text = String(value || '');
            return text.charAt(0).toUpperCase() + text.slice(1);
        };
        const appendBadge = (parent, label, className, kind, description) => {
            const badge = document.createElement('span');
            badge.className = 'course-option-badge' + (className ? ` ${className}` : '');
            badge.textContent = String(label || '');
            if (kind) badge.dataset.badgeKind = String(kind);
            if (description) badge.title = String(description);
            parent.appendChild(badge);
        };
        const appendRequirementLine = (parent, kind, text) => {
            if (!text) return;
            const line = document.createElement('div');
            line.className = 'course-option-requisite';
            line.dataset.kind = kind;
            line.textContent = String(text);
            parent.appendChild(line);
        };

        function renderOptionContent(container, evaluation, filters) {
            const item = evaluation && evaluation.candidate ? evaluation.candidate : evaluation;
            const title = document.createElement('div');
            title.className = 'course-option-title';
            title.textContent = `${String(item.code || '')} ${String(item.name || '')}`;
            container.appendChild(title);
            if (controls.details.checked) {
                const parts = [
                    `SU: ${formatNumber(item.su != null ? item.su : item.credit)}`,
                    `ECTS: ${formatNumber(item.ects)}`,
                ];
                if (Number(item.basicScience != null ? item.basicScience : item.bs) > 0) {
                    parts.push(`BS: ${formatNumber(item.basicScience != null ? item.basicScience : item.bs)}`);
                }
                if (Number(item.engineering != null ? item.engineering : item.eng) > 0) {
                    parts.push(`Engineering: ${formatNumber(item.engineering != null ? item.engineering : item.eng)}`);
                }
                const memberships = filterApi && typeof filterApi.membershipsForProgram === 'function'
                    ? filterApi.membershipsForProgram(item, filters.program) : [];
                if (memberships.length) {
                    const labels = memberships.map((membership) => {
                        const program = membership && membership.program ? String(membership.program) : '';
                        const type = membership && membership.type ? capitalizeFirst(membership.type) : '';
                        return [program, type].filter(Boolean).join(': ');
                    }).filter(Boolean);
                    if (labels.length) parts.push(labels.join(' / '));
                }
                const details = document.createElement('div');
                details.className = 'course-option-details';
                parts.forEach((part) => {
                    const row = document.createElement('div');
                    row.textContent = String(part);
                    details.appendChild(row);
                });
                container.appendChild(details);
            }

            const badges = document.createElement('div');
            badges.className = 'course-option-badges';
            const requirements = evaluation && evaluation.requirements;
            if (filters.checkPrerequisites) {
                const state = requirements && requirements.status ? requirements.status : 'unknown';
                const supplemental = requirements && requirements.supplemental;
                if (supplemental && supplemental.hasRule) {
                    const registrationState = String(supplemental.status || 'review');
                    if (registrationState === 'met') {
                        appendBadge(badges, 'Registration guidance met', 'is-met');
                    } else if (registrationState === 'unmet') {
                        appendBadge(badges, 'Unmet registration guidance', 'is-unmet');
                    } else {
                        appendBadge(badges, 'Review registration guidance', 'is-review');
                    }
                    const legacy = requirements.legacy;
                    if (legacy && legacy.hasRequirements) {
                        if (legacy.status === 'met') {
                            appendBadge(badges, 'Course requirements met', 'is-met');
                        } else if (legacy.status === 'unmet') {
                            appendBadge(badges, 'Unmet course requirements', 'is-unmet');
                        } else {
                            appendBadge(badges, 'Course requirements unavailable', 'is-unknown');
                        }
                    }
                } else if (state === 'met') appendBadge(badges, 'Requirements met', 'is-met');
                else if (state === 'unmet') appendBadge(badges, 'Unmet requirements', 'is-unmet');
                else appendBadge(badges, 'Requirements unavailable', 'is-unknown');
            }
            const offering = evaluation && evaluation.offering ? evaluation.offering.state : 'unknown';
            if (filters.offeredOnly || offering === 'offered') {
                if (offering === 'offered') appendBadge(badges, 'Offered', 'is-met');
                else if (offering === 'unknown') appendBadge(badges, 'Offering unknown', 'is-unknown');
            }
            const history = evaluation && evaluation.offeringHistory
                ? evaluation.offeringHistory : null;
            let historyAdvisories = [];
            try {
                if (filterApi && typeof filterApi.contextualOfferingAdvisories === 'function') {
                    historyAdvisories = filterApi.contextualOfferingAdvisories(
                        history,
                        targetTermCode,
                        offering,
                    );
                }
            } catch (_) {}
            historyAdvisories.forEach((advisory) => {
                if (!advisory || !advisory.label) return;
                const kind = advisory.key === 'irregular' || advisory.key === 'no-recent'
                    ? 'history-cadence' : 'history-season';
                appendBadge(
                    badges,
                    advisory.label,
                    'is-history',
                    kind,
                    advisory.description || advisory.title
                        || 'Based on recorded course history; future availability can change.',
                );
            });
            const planned = evaluation && evaluation.plannedState
                ? String(evaluation.plannedState.state || '') : '';
            const plannedLabels = {
                earlier: 'Planned earlier',
                'same-term': 'Already in this semester',
                later: 'Planned later',
                multiple: 'Multiple planned entries',
                unknown: 'Planned term unknown',
            };
            if (plannedLabels[planned]) appendBadge(badges, plannedLabels[planned], 'is-unknown');
            if (badges.children.length) container.appendChild(badges);

            if (filters.checkPrerequisites && requirements) {
                const requisiteLines = document.createElement('div');
                requisiteLines.className = 'course-option-requisites';
                const supplemental = requirements.supplemental;
                if (supplemental && supplemental.hasRule) {
                    const guidance = filterApi
                        && typeof filterApi.supplementalGuidanceItems === 'function'
                        ? filterApi.supplementalGuidanceItems(supplemental, {
                            includeMet: false,
                            includeComponents: false,
                        })
                        : (Array.isArray(supplemental.guidance) ? supplemental.guidance : []);
                    const seenGuidance = new Set();
                    (requirements.status === 'met' ? [] : guidance).forEach((guidanceItem) => {
                        const text = String(
                            guidanceItem && guidanceItem.text ? guidanceItem.text : guidanceItem || '',
                        ).trim();
                        if (!text || seenGuidance.has(text)) return;
                        seenGuidance.add(text);
                        appendRequirementLine(
                            requisiteLines,
                            guidanceItem && guidanceItem.kind
                                ? guidanceItem.kind : 'registration-guidance',
                            text,
                        );
                    });
                    if (requirements.status === 'review' || supplemental.status === 'review') {
                        appendRequirementLine(
                            requisiteLines,
                            'registration-review',
                            'Some registration guidance could not be checked automatically; this course remains visible.',
                        );
                    }
                }
                const ordinaryRequirements = supplemental && supplemental.hasRule
                    ? requirements.legacy : requirements;
                if (ordinaryRequirements && ordinaryRequirements.status === 'unmet') {
                    const prerequisite = ordinaryRequirements.prerequisite;
                    if (prerequisite) {
                        const required = Array.isArray(prerequisite.required)
                            ? prerequisite.required : [];
                        const sameTermAllowed = new Set(
                            Array.isArray(prerequisite.concurrent) ? prerequisite.concurrent : [],
                        );
                        const earlierOnly = required.filter((code) => !sameTermAllowed.has(code));
                        const concurrent = required.filter((code) => sameTermAllowed.has(code));
                        if (earlierOnly.length) {
                            appendRequirementLine(
                                requisiteLines,
                                'prerequisite',
                                `Prerequisite: complete ${earlierOnly.join(', ')} in an earlier term.`,
                            );
                        }
                        if (concurrent.length) {
                            appendRequirementLine(
                                requisiteLines,
                                'prerequisite',
                                `Prerequisite: add ${concurrent.join(', ')} in this term or an earlier term.`,
                            );
                        }
                        const oneOf = Array.isArray(prerequisite.oneOf)
                            ? prerequisite.oneOf : [];
                        const oneOfConcurrent = Array.isArray(prerequisite.oneOfConcurrent)
                            ? prerequisite.oneOfConcurrent : [];
                        oneOf.forEach((group, groupIndex) => {
                            const choices = Array.isArray(group) ? group.filter(Boolean) : [];
                            if (!choices.length) return;
                            const flags = Array.isArray(oneOfConcurrent[groupIndex])
                                ? oneOfConcurrent[groupIndex] : [];
                            const labels = choices.map((choice, choiceIndex) => (
                                flags[choiceIndex] ? `${choice} (same term allowed)` : choice
                            ));
                            appendRequirementLine(
                                requisiteLines,
                                'prerequisite',
                                `Prerequisite: complete one of ${labels.join(' or ')}.`,
                            );
                        });
                    }
                    if (ordinaryRequirements.priorSuRequirement) {
                        const prior = ordinaryRequirements.priorSuRequirement;
                        appendRequirementLine(
                            requisiteLines,
                            'prior-credits',
                            `Prior SU: ${formatNumber(prior.actual)} of ${formatNumber(prior.minimum)} SU planned/completed.`,
                        );
                    }
                    const corequisites = Array.isArray(ordinaryRequirements.missingCorequisites)
                        ? ordinaryRequirements.missingCorequisites
                        : (Array.isArray(ordinaryRequirements.corequisites)
                            ? ordinaryRequirements.corequisites : []);
                    if (corequisites.length) {
                        appendRequirementLine(
                            requisiteLines,
                            'corequisite',
                            `Corequisite: also add ${corequisites.join(', ')} in this or an earlier term.`,
                        );
                    }
                } else if ((!supplemental || !supplemental.hasRule)
                    && (requirements.status === 'unknown' || requirements.status === 'review')) {
                    const unavailable = document.createElement('div');
                    unavailable.className = 'course-option-requisite course-option-requisite-status';
                    unavailable.textContent = 'Requirements unavailable; this course remains visible.';
                    requisiteLines.appendChild(unavailable);
                }
                if (requisiteLines.children.length) container.appendChild(requisiteLines);
            }
        }

        return Object.freeze({ renderOptionContent });
    }

    const namespace = root.SurriculumModules || (root.SurriculumModules = {});
    namespace.plannerCoursePickerOptionRenderer = Object.freeze({ createOptionRenderer });
})(typeof window !== 'undefined' ? window : globalThis);
