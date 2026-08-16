# Requirement Groups — Design

**Status:** proposal (for review, no code yet)
**Decisions so far:** first-class special requirements with **base-type
inheritance**; **doc first**, then prototype **VACD** end-to-end, then generalize,
then teach the scraper. Faculty-course requirements are a **cross-cutting ticker**,
not a group (see §2).

---

## 1. Problem

A program's "special" requirements are currently **conflated with the base course
type** and **hard-authored in the app**:

- VACD's *Core Electives I / II* pools are just `core`-typed courses plus a hidden
  credit-pool constraint checked at graduation (`VACD_CORE_POOL_*` +
  `poolCreditSum`, flags 30/31).
- ECON's *Mathematics Requirement* and PSY's *Philosophy Requirement* are folded
  into the `required` credit count; the specific course lists (`ECON_MATH_REQ`,
  `PSY_PHILOSOPHY`) and the "one of" rule live only in the app.
- The *Faculty Courses* requirement, EE's *400-level* and *special-topics* rules,
  MAN's *area-spread* rules, DSA's *core-by-faculty* counts — all are named
  constants + `PROGRAM_RULES` entries in `scripts/s_curriculum.js`.

They are therefore **not scraped, not first-class, and not shown as themselves**.
Step 4 made the rule *logic* data-shaped (one evaluator over `PROGRAM_RULES`
descriptors); the HUM follow-up moved that rule to scraped data (`humRequired`).
This proposal finishes the arc: move the special requirements themselves out of the
base types and out of the app, into scraped, first-class data — supported
throughout (allocation, graduation, display, summary, scheduler).

---

## 2. Two mechanisms: groups vs tickers

Not every special requirement is the same shape. There are **two** distinct
mechanisms, and only the first is a "group":

- **Requirement group** — a named **subset of a base type**. Core Electives I is a
  subset of `core`; the Mathematics Requirement is a subset of `required`. A course
  is *core, and specifically a member of the Core-I pool*. First-class and
  base-inheriting, and — crucially — the **enumerable pools (Core I / II, the
  math/philosophy one-of lists) are cleanly parsable** off SUIS. Groups are the
  focus of this design.

- **Cross-cutting ticker** — a **count over an orthogonal attribute** a course
  carries *alongside* its base type. The prime example is **faculty courses**: a
  course can be `core` **and** a `FENS` faculty course *at the same time* — the
  faculty-course-ness does not carve a subset out of `core`, it is a separate tag
  (`Faculty_Course`, already scraped). So the faculty requirement stays a **simple
  counter** over that marker — **not** a group (§5). Its per-pool minimums can
  become scraped data, but the counting stays `tallyFacultyCourses` and it is
  tracked/displayed on its own, independent of the base-type cascade.

> A note on "faculty" the tag vs "faculty" the offering. Two different attributes,
> both scraped, easily confused (and the source of past bugs): `Faculty_Course` (the
> ~10% of courses in a FENS/FASS/SBS faculty-course *pool*) drives the **ticker**;
> `Faculty` (every course's *offering* faculty) drives DSA's core-by-faculty
> **groups** (§4). They are not interchangeable.

---

## 3. Group data model

Each program's requirements record gains a `groups` array — one entry per special
requirement **of the group kind**. A group is plain data:

```jsonc
{
  "id": "core_arthistory",                 // stable slug, unique per program
  "label": "Core Electives I — Art/Design History",
  "base": "core",                          // core|area|free|required|university
  "rule": "credits",                       // see §3.1
  "min": 9,                                // rule parameter(s)
  "members": ["HART292","HART293", ...],   // explicit course list, OR a `match` (§3.2)
  "exclusivePairs": [["VA302","VA304"]],   // optional, rule-specific
  "flag": 30,                              // legacy numeric flag for the message (§6.3)
  "suis": "VACD › Core Electives I"        // citation
}
```

Every group has a **real `base`** (there is no `base:null` group — that case is a
ticker). The `base` drives inheritance (§4).

### 3.1 Rule types (`rule`)

Each already has an evaluator in `s_curriculum.js` (step 4); the group supplies its
data:

| `rule`            | means                                                        | today's evaluator            |
|-------------------|--------------------------------------------------------------|------------------------------|
| `credits`         | ≥ `min` credits from `members` within `base` (opt. `exclusivePairs`) | `poolCreditSum`      |
| `oneOf`           | at least one of `members` is present                         | `hasAny`                     |
| `levelCredits`    | ≥ `min` credits from a code prefix in a static category       | `levelCreditSum`             |
| `specialAny`      | one of `members`, or a prefix+category                        | `specialCourseAny`           |
| `advancedCount`   | ≥ `min` base-effective courses matching a code test           | `psyAdvancedAreaCount`       |
| `prefixSpan`      | ≥ `min` distinct code-prefixes within the base category       | `categoryPrefixSpan`         |
| `offeringCredits` | ≥ `min` base-effective credits offered by a faculty (`Faculty`) | `freeOfferingFacultyCredits` |
| `offeringCount`   | ≥ `min` static-`base` courses offered by a faculty (`Faculty`) | `coreOfferingFacultyCount`  |
| `languageCap`     | ≤ `max` basic-language courses count toward `base`            | `languageCap`                |
| `entryGatedOneOf` | `oneOf`, but only from an entry term onward                   | `entryGatedHasAny`           |

New rule types are added the same way: one evaluator + a `rule` name. The app owns
the *evaluators*; the scraper owns the *data*.

### 3.2 Membership: `members` vs `match`

- `members`: an explicit list of course codes (pools, one-of lists) — scrape-stable,
  preferred where the pool is enumerable.
- `match`: a predicate for the open-ended ones, e.g. `{ "codePrefix": "EE4",
  "category": "Core" }` (EE 400-level) or `{ "offeringFaculty": "FENS" }` (DSA).

---

## 4. Inheritance semantics (`base`)

`base` is the *"may inherit from the normal course types"* dial. Every group has
one (tickers, which don't, are §5).

### 4.1 Inherit the cascade
A group's members are **allocated through the base type's cascade** exactly as
today: a `base:"core"` course fills `core`, overflows to `area`→`free` when core is
full, and inherits the base's overflow class/color. The group adds two things on
top, both first-class:

1. **Tracking** — the engine accumulates, per group, how much *base-effective*
   credit comes from the group's members (`exclusivePairs` de-duplicated). This is a
   **subset measure of the base credit**, so there is **no double counting**: the
   course contributes its credits to the base pool once; the group merely measures
   the composition.
2. **A graduation check** — the group's `rule`/`min` evaluated against that measure.

This is exactly VACD/PSIR today (pool courses are core-typed; the pool min is a
constraint on the composition of core) and ECON-math/PSY-phil today (required-typed;
"one of" is a presence constraint) — now modeled explicitly instead of implicitly.

### 4.2 Why not fully-independent lanes (rejected)
Giving each group its own allocation lane (a Core-I course fills *Core-I* before
generic core) would need a defined relationship between group credit and base
credit and a double-count policy, and would diverge from the SUIS model where a pool
is a **subset** of a base pool. Base-type inheritance keeps the cascade unchanged
and matches how requirements are actually written.

---

## 5. Cross-cutting tickers (faculty courses)

The faculty-course requirement is **not** a group. A course's `Faculty_Course` tag
(FENS/FASS/SBS/none) coexists with its base type, so the requirement is a plain
**count over that tag**, tracked and displayed on its own:

- The **counting** stays `tallyFacultyCourses` / `tallyFacultyAreas` (already shared
  helpers, step-4).
- The **thresholds** become a small scraped field per program, e.g.
  `"facultyReq": { "total": 5, "math": 2, "fens": 3, "areas": 0 }` — replacing the
  hard-coded `facultyCount` descriptors. (DSA: `{total:5, fens:1, fass:1, sbs:1}`;
  the FASS programs: `{total:5, fass:3, areas:3}`.)
- No base cascade, no allocation involvement; it is a pure graduation/display
  measure. The "faculty courses span ≥3 areas" rule rides along here (it is about
  the faculty-course *set*), not as a group.

Kept deliberately simple, per the design call that this is a ticker.

---

## 6. Per-program inventory

Proof of coverage: every current special rule, classified. Shared across all
programs (not listed): the generic credit thresholds + GPA (unchanged), `SPS303`
(flag 11), and HUM (already `humRequired`).

### 6.1 Groups (base-subset, scraped)

| Program | Groups (`id` : rule @ base) |
|---|---|
| **ME**   | `cs_alt` : entryGatedOneOf(CS404/CS412, ≥202501) @ required |
| **EE**   | `ee400` : levelCredits(EE4, 9) @ core · `special_area` : specialAny(CS300/CS401/CS412/ME303/PHYS302/PHYS303 or EE48·) @ area |
| **ECON** | `math_req` : oneOf(MATH201/202/204/212) @ required · `lang_cap` : languageCap(2) @ free |
| **MAN**  | `core_areas` : prefixSpan([ACC,FIN,MGMT,MKTG,OPIM,ORG], 6) @ core · `area_areas` : prefixSpan([ACC,FIN,MKTG,OPIM,ORG], 5) @ area · `free_fassfens` : offeringCredits([FASS,FENS], 9) @ free · `lang_cap` : languageCap(2) @ free |
| **PSIR** | `core_polisci` : credits(PSIR_CORE_I_POOL, 12) @ core · `core_ir` : credits(PSIR_CORE_II_POOL, 12) @ core · `lang_cap` : languageCap(2) @ free |
| **PSY**  | `philosophy` : oneOf(PHIL300/301) @ required · `psy_advanced` : advancedCount(2) @ area · `lang_cap` : languageCap(2) @ free |
| **VACD** | `core_arthistory` : credits(VACD_CORE_POOL_1, 9) @ core · `core_skill` : credits(VACD_CORE_POOL_2, 12, pairs) @ core · `lang_cap` : languageCap(2) @ free |
| **DSA**  | `core_fens` : offeringCount(FENS, 3) @ core · `core_fass` : offeringCount(FASS, 3) @ core · `core_sbs` : offeringCount(SBS, 3) @ core |

CS/IE/MAT/BIO have **no** groups (only the faculty ticker). The cleanest/most
parsable groups are the explicit-`members` pools (VACD, PSIR, ECON, PSY) — the
prototype target.

### 6.2 Tickers (faculty)

Every program has one `facultyReq` ticker (§5). Per-pool minimums:
CS/IE/MAT/BIO/ME/EE `{total:5, math:2, fens:3}` · ECON/PSIR/PSY/VACD
`{total:5, fass:3, areas:3}` · MAN `{total:5, sbs:2}` · DSA
`{total:5, fens:1, fass:1, sbs:1}`.

Ordering (first-unmet-wins) is preserved by: shared university/HUM, then the
program's ticker, then its groups in array order — matching today's flag order.

---

## 7. End-to-end flow ("full support")

### 7.1 Scraper (`fetch_requirements.py`)
Parse the group sections + faculty minimums off SUIS → emit `groups` + `facultyReq`.
Enumerable pools become `members`; open-ended ones become `match`. **Biggest
unknown** — see §9. Faculty minimums are small and largely uniform (§6.2).

### 7.2 Allocation (`recalcEffectiveTypes` / `…Double`)
Base type and cascade are unchanged (groups inherit; tickers don't touch
allocation). Add a per-group accumulator pass over the already-computed effective
types (cheap; reuses the step-4 evaluators, parametrized by the `fields` descriptor,
so it serves main + DM with no new drift).

### 7.3 Graduation
`PROGRAM_RULES` + the hardcoded constants **largely dissolve**:
`graduationRulesFor(program)` becomes shared university + HUM + the program's
`facultyReq` ticker + its `groups`. Messages: keep the numeric `flag` on each
group/ticker (so `flagMessages.js` and wording are unchanged) initially.

### 7.4 Display + summary
- Course label: unchanged by default (still the base type); the group is now
  *available* to the UI (tooltip/summary).
- Summary panel: **per-group and per-ticker progress** ("Core I — Art/Design
  History: 6/9", "Faculty Courses: 4/5") — the most visible user-facing win.

### 7.5 Scheduler
Group/ticker-aware smart-sort (surface a course that fills an unmet group) — a
follow-up.

---

## 8. Migration & sequencing

Behavior-preserving throughout; full suite green at each phase.

1. **Schema + hand-authored data (no behavior change).** Define `groups` +
   `facultyReq`; author them for **VACD only**, materializing today's constants as
   data. App still reads the constants.
2. **Engine + graduation consume VACD's groups + ticker.** Evaluate VACD from data
   instead of the constants/`PROGRAM_RULES` VACD entries. Verify against
   `vacd-alternatives` / `dm-vacd-core-pools` / graduation specs (0 diff). **This
   validates the whole model on one rich program.**
3. **Generalize to all 12 programs.** Author data from §6; delete the now-dead
   constants + `PROGRAM_RULES` special entries. `PROGRAM_RULES` shrinks to (mostly)
   nothing.
4. **Summary UI** renders per-group / per-ticker progress.
5. **Scraper** parses groups + faculty minimums off SUIS, replacing the
   hand-authored data (the big unknown; do last, once the consumer is proven).
6. **Scheduler** awareness (optional follow-up).

Steps 1–3 are the core; 4–6 are independent follow-ups. Each is its own reviewed,
green commit.

---

## 9. Open questions / risks

- **SUIS parseability (biggest risk).** Do the requirements pages list the pool
  course codes cleanly and consistently across programs and terms? The user's read:
  Core I / II are **easily parsable**. Where a pool isn't machine-readable, that
  group stays hand-authored (still a win — first-class data, not auto-scraped); the
  `members`/`match` model supports both.
- **Flags vs group ids for messages.** Keep numeric `flag` (stable messages) first;
  revisit id-based messages when the UI shows groups.
- **Double major.** Groups + ticker evaluated per pass via the `fields` descriptor
  (`effective_type` vs `effective_type_dm`), same as the step-4 evaluators — the DM
  pass inherits the same definitions (a DM program has the same special reqs).
- **Backward compatibility.** Saved *plans* are unaffected (this is program
  metadata). Old *requirements data* without `groups`/`facultyReq` → fall back to
  the current constants until re-scraped (keep constants behind a fallback during
  phases 1–3).

## 10. Non-goals

- The generic credit thresholds and GPA stay exactly as they are — groups/tickers
  are the *special* requirements only.
- The `main.js` / `scheduler.js` view-layer extraction (a separate deferred effort).
- Changing allocation *outcomes* — every phase is behavior-preserving until we
  deliberately choose otherwise.

---

## 11. Refinement — overflow as scraped data (revises §4)

Reading the live SUIS pages (PSIR, VACD — Summer 2025-26) surfaced a structure the
"subset of a base type" framing in §4 understated, and it changes the model:

### 11.1 Overflow is stated, uniform, and parseable
Every pool carries the SAME sentence naming where its extras go:

> "Min. N SU credits from the pool. **The extra courses taken from this pool are
> directly counted towards [Area / Free] requirements.**"

Observed on both programs: Core I → **Area**, Core II → **Area**, Area → **Free**.
So the overflow TARGET is a per-category property that can be **scraped** from that
consistent phrasing — not a hardcoded cascade.

### 11.2 Core I and Core II are DISTINCT categories, not a merged `core`
The summary tables list *Core Electives I* and *Core Electives II* as separate rows,
each with its own min (PSIR 12 / 12, VACD 9 / 12) and its own overflow (→ Area). The
current engine merges them into one `core` pool plus bolt-on pool checks — which
*happens* to give correct graduation results, but is not the real shape. Modeling
them faithfully: **Core I and Core II are sibling categories**, both overflowing into
Area in parallel. This supersedes §4.2's "pool is a subset of a base pool /
independent lanes rejected" — the categories ARE the lanes; each carries an explicit
`overflowTo`.

### 11.3 The model gains `overflowTo`; the cascade becomes a graph
- Each category/group carries **`overflowTo: "<category>" | null`** (scraped):
  Core I → area, Core II → area, area → free, free → null.
- Allocation stops being a fixed `required → core → area → free` line and becomes a
  **data-driven overflow graph** — fill each category to its min, spill extras along
  its `overflowTo` edge (Core I and Core II both feed Area).
- **`required` overflow is program-specific, NOT universally → core.** (The user's
  note.) Required extras may go elsewhere or nowhere; the alternative-pair "extra"
  (e.g. VACD "VA301 or VA303") is its own case. So `required`'s overflow is scraped/
  authored, not assumed.
- The `requireCore` / `requireBase` question from §4 then **dissolves**: "≥12 from
  the pool" is measured against what actually landed in Core I under its own
  overflow rule — the `overflowTo` graph defines it precisely, no per-program guess.

### 11.4 Scope impact
This reaches into the **allocation engine** (the cascade), not only graduation.
Phase 2 (VACD graduation) remains valid as behavior-preserving. But faithfully
modeling categories + overflow is a larger change than layering groups onto the
existing cascade, and it partly reopens the deferred single-`allocate()` question
(the cascade is exactly `allocateCascade`). Decision needed on how far to take it —
see the open scope question.
