#!/usr/bin/env python3
"""Phase 5 of the requirement-groups redesign: the scraper PARSES the enumerable
Core-Elective pools (VACD/PSIR) off the SUIS degree-detail page instead of relying
solely on the hand-authored member lists. This pins that the parse REPRODUCES the
hand-authored data on the saved offline pages — i.e. wiring the scrape in is
behaviour-preserving, and a future page-format change that broke the parse would
fail here rather than silently blanking a graduation pool.

Runs against the committed 'Degree Detail Pages (for inspect)/' fixtures, so it
needs no network. Not in the node/npm gate (that gate is JS-only); run directly:

    python tests/scrape_groups_test.py

Exits non-zero on the first failed assertion.
"""

import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import fetch_requirements as fr  # noqa: E402

# program code -> the two offline pages that carry enumerated Core-Elective pools.
PROGRAMS = {"BAVACD": "VACD", "BAPSIR": "PSIR"}


def merged_groups(program):
    """Run the real (offline) scraper path for a program and return its groups —
    fetch_requirements attaches the scraped pools, special_requirements merges them
    into the hand-authored skeleton, exactly as main() does."""
    req = fr.fetch_requirements(program, "202401", offline_dir=fr.DETAIL_PAGES_DIR)
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


def main():
    for program in PROGRAMS:
        check_parity(program)
    check_fallback_on_parse_miss()
    print("OK: scrape-groups parity checks passed.")


if __name__ == "__main__":
    main()
