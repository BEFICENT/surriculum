#!/usr/bin/env python3
"""Phase 5 of the requirement-groups redesign: the scraper PARSES the enumerable
Core-Elective pools (VACD/PSIR) off the SUIS degree-detail page instead of relying
solely on the hand-authored member lists. This pins that the parse REPRODUCES the
hand-authored data on the saved offline pages — i.e. wiring the scrape in is
behaviour-preserving, and a future page-format change that broke the parse would
fail here rather than silently blanking a graduation pool.

Runs against the committed Fall 2025-2026 pages in
`tests/fixtures/suis/degree-details/major/`, so it needs no network. It runs through
``npm run test:python`` and can also be run directly:

    python tests/scrape_groups_test.py

Exits non-zero on the first failed assertion.
"""

import os
import sys

from bs4 import BeautifulSoup

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from tools.data_pipeline import fetch_requirements as fr  # noqa: E402

# program code -> the two offline pages that carry enumerated Core-Elective pools.
PROGRAMS = {"BAVACD": "VACD", "BAPSIR": "PSIR"}
TERM = "202501"
ADMIT_LABEL = "Admit Term: Fall 2025-2026"


def merged_groups(program):
    """Run the real (offline) scraper path for a program and return its groups —
    fetch_requirements attaches the scraped pools, special_requirements merges them
    into the hand-authored skeleton, exactly as main() does."""
    major = PROGRAMS[program]
    fixture = os.path.join(fr.DETAIL_PAGES_DIR, f"SU_DEGREE.p_degree_detail_{major}.html")
    with open(fixture, "r", encoding="utf-8") as fh:
        html = fh.read()
    assert ADMIT_LABEL in html, f"{major}: offline page is not the expected {TERM} admit term"

    req = fr.fetch_requirements(program, TERM, offline_dir=fr.DETAIL_PAGES_DIR)
    pools = req.pop("_pools", None)
    assert pools, f"{program}: the scrape found no Core-Elective pools"
    return fr.special_requirements(PROGRAMS[program], pools)["groups"], pools


def credit_groups(groups):
    return [g for g in groups if g.get("rule") == "credits"]


def check_parity(program):
    major = PROGRAMS[program]
    scraped_groups, pools = merged_groups(program)
    authored = fr.PROGRAM_GROUPS[major]

    # Exactly the two enumerated pools (Core Electives I and II).
    assert len(pools) == 2, f"{major}: expected 2 scraped pools, got {len(pools)}"
    assert [p["poolno"] for p in pools] == ["I", "II"], f"{major}: pool order I, II"

    # The scraped-and-merged credits groups must equal the hand-authored ones,
    # field for field (members / min / overflowTo are what the scrape supplies).
    got = credit_groups(scraped_groups)
    want = credit_groups(authored)
    assert len(got) == len(want) == 2, f"{major}: two credits groups"
    for g, w in zip(got, want):
        assert g["members"] == w["members"], (
            f"{major}/{g['id']}: scraped members differ from hand-authored\n"
            f"  scraped:  {g['members']}\n  authored: {w['members']}"
        )
        assert g["min"] == w["min"], f"{major}/{g['id']}: min {g['min']} != {w['min']}"
        assert g["overflowTo"] == w["overflowTo"], f"{major}/{g['id']}: overflowTo"
        # App-semantics carried through untouched from the skeleton.
        assert g["flag"] == w["flag"] and g["base"] == w["base"] and g["rule"] == "credits"
        assert g.get("exclusivePairs") == w.get("exclusivePairs"), f"{major}/{g['id']}: pairs kept"

    print(f"  {major}: 2 pools scraped, {len(got)} credits groups match hand-authored")


def check_fallback_on_parse_miss():
    """A program whose page has no enumerated pools (or a failed parse) keeps the
    hand-authored members — the merge must never blank a group."""
    unchanged = fr.special_requirements("VACD", None)["groups"]
    authored = fr.PROGRAM_GROUPS["VACD"]
    for g, w in zip(unchanged, authored):
        assert g.get("members") == w.get("members"), "no scrape -> hand-authored kept"
    # An empty pool list is also a miss -> fallback.
    empty = fr.special_requirements("VACD", [])["groups"]
    for g, w in zip(empty, authored):
        assert g.get("members") == w.get("members"), "empty pools -> hand-authored kept"
    print("  fallback: no/empty scrape keeps the hand-authored members")


def check_hum_requirement_wording():
    """HUM requiredness comes from each page's University Courses prose."""
    fixtures = {
        "SU_DEGREE.p_degree_detail_main.html": (1, "any"),
        "SU_DEGREE.p_degree_detail_EE.html": (1, "any"),
        "SU_DEGREE.p_degree_detail_ECON.html": (2, "one200One300"),
        "SU_DEGREE.p_degree_detail_MAN.html": (2, "one200One300"),
        "SU_DEGREE.p_degree_detail_PSIR.html": (2, "one200One300"),
        "SU_DEGREE.p_degree_detail_PSY.html": (2, "one200One300"),
        "SU_DEGREE.p_degree_detail_VACD.html": (2, "one200One300"),
    }
    for filename, expected in fixtures.items():
        path = os.path.join(fr.DETAIL_PAGES_DIR, filename)
        with open(path, "r", encoding="utf-8") as handle:
            soup = BeautifulSoup(handle.read(), "lxml")
        parsed = fr.parse_hum_requirement(soup)
        actual = (parsed["humRequired"], parsed["humRule"])
        assert actual == expected, f"{filename}: HUM rule {actual}, expected {expected}"

    def page(description, unrelated=""):
        return BeautifulSoup(
            f"""
            <table>
              <tr class="t_kategori_row"><td><a name="UC_FENS">University Courses</a></td></tr>
              <tr class="t_kategori_row_desc"><td>
                <p>From the University Courses listed below:</p>
                <p>{description}</p>
              </td></tr>
            </table>
            <p>{unrelated}</p>
            """,
            "lxml",
        )

    normalized_one = page("ONE of the HUM\n coded courses listed below IS required.")
    assert fr.parse_hum_requirement(normalized_one) == {
        "humRequired": 1,
        "humRule": "any",
    }
    historical_two = page("Only two of the HUM coded courses listed below are required.")
    assert fr.parse_hum_requirement(historical_two) == {
        "humRequired": 2,
        "humRule": "any",
    }

    rejected = {
        "ambiguous": page("Several HUM courses are listed."),
        "two-without-levels": page("At least 2 of the listed HUM courses must be taken."),
        "unrelated-level-text": page(
            "At least 2 of the listed HUM courses must be taken.",
            "An unrelated rule mentions 2xx and 3xx courses.",
        ),
        "contradictory": page(
            "One of the HUM coded courses listed below is required. "
            "At least 2 of the listed HUM courses must be taken; first the 2xx, then the 3xx."
        ),
    }
    for label, soup in rejected.items():
        try:
            fr.parse_hum_requirement(soup)
        except ValueError as exc:
            assert "University Courses HUM" in str(exc), f"{label}: {exc}"
        else:
            raise AssertionError(f"{label} HUM wording was silently accepted")
    print("  HUM wording: one-any, two-any, and tiered rules parsed; ambiguity rejected")


def main():
    for program in PROGRAMS:
        check_parity(program)
    check_fallback_on_parse_miss()
    check_hum_requirement_wording()
    print("OK: scrape-groups parity checks passed.")


if __name__ == "__main__":
    main()
