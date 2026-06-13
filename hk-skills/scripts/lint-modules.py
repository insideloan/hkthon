#!/usr/bin/env python3
"""Lint MODULES.md for drift between YAML SSOT and the human-readable tables.

Compares:
  - Files in YAML ownership (real modules) vs files mentioned in §2.1/§2.2
  - The list of "real modules" in YAML §1 vs the modules shown in §1's table

Reports any mismatches and exits non-zero if drift is found. Use this in CI
or before merging changes to MODULES.md.

This script does NOT modify the file — drift is always reconciled by a human
editing both sides (intentional, see MODULES.md §6.1).

Usage:
    python3 lint-modules.py
    python3 lint-modules.py --modules-md path/to/MODULES.md
    python3 lint-modules.py --strict   # warn even on soft mismatches
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

# parse-modules.py uses kebab-case filename; import via importlib.
import importlib.util
_spec = importlib.util.spec_from_file_location(
    "parse_modules", str(Path(__file__).resolve().parent / "parse-modules.py")
)
parse_modules = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(parse_modules)
load_modules = parse_modules.load_modules
YAMLError = parse_modules.YAMLError
START_MARKER = parse_modules.START_MARKER
END_MARKER = parse_modules.END_MARKER
SHARED_CODE = parse_modules.SHARED_CODE
TEAM_LOCK_CODE = parse_modules.TEAM_LOCK_CODE


# ---------------------------------------------------------------------------
# Extract the human-readable tables from MODULES.md
# ---------------------------------------------------------------------------

def extract_sections(modules_md: str) -> dict[str, str]:
    """Return markdown text between each `## N. <title>` heading and the next.

    Returns dict of section_number -> body.
    """
    sections: dict[str, str] = {}
    # split on "## "
    parts = re.split(r"^## (?=\S)", modules_md, flags=re.MULTILINE)
    for part in parts[1:]:
        # part starts with "<num>. <title>\n<body>"
        first_line, _, body = part.partition("\n")
        m = re.match(r"^(\d+)\.\s+", first_line)
        if m:
            sections[m.group(1)] = body
    return sections


def extract_path_cells(table_md: str) -> set[str]:
    """Return set of file paths mentioned in markdown tables (column 1, code cells)."""
    paths: set[str] = set()
    for line in table_md.splitlines():
        if not line.strip().startswith("|"):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if not cells:
            continue
        first = cells[0]
        # Skip header / separator rows
        if first.startswith("Path") or first.startswith("---") or first.startswith("==="):
            continue
        # Skip rows without backtick (typically header/separator)
        if "`" not in first:
            continue
        # Extract backticked path
        m = re.search(r"`([^`]+)`", first)
        if m:
            paths.add(m.group(1))
    return paths


def glob_match(path: str, patterns: set[str]) -> bool:
    """Check if path matches any of the patterns (treating `*` as glob).

    `*` matches any chars (including `/`) for our purposes. Brackets are
    literal (Next.js dynamic routes like `app/call/[id]/page.tsx`).
    """
    import re
    for p in patterns:
        # Convert fnmatch-style to regex: only `*` and literal.
        # Escape everything else (including `[`, `]`, `.`, etc.)
        regex = re.escape(p).replace(r"\*", ".*")
        if re.fullmatch(regex, path):
            return True
    return False


# ---------------------------------------------------------------------------
# Main lint
# ---------------------------------------------------------------------------

def lint(modules_md_path: Path, strict: bool = False) -> int:
    if not modules_md_path.exists():
        print(f"[lint] ❌ not found: {modules_md_path}", file=sys.stderr)
        return 1

    text = modules_md_path.read_text(encoding="utf-8")

    # Load SSOT
    try:
        info = load_modules(modules_md_path)
    except YAMLError as e:
        print(f"[lint] ❌ yaml SSOT parse error: {e}", file=sys.stderr)
        return 1

    real_modules = info["real_modules"]
    # All yaml patterns (real + SHARED + TEAM-LOCK). SHARED and TEAM-LOCK are
    # both expected to be represented in §2 (or §2.3 for TEAM-LOCK).
    yaml_files: set[str] = set()
    for pattern, owner in info["ownership"]:
        yaml_files.add(pattern)

    # Extract human-readable tables
    sections = extract_sections(text)
    sec_1 = sections.get("1", "")
    sec_2_1 = sections.get("2", "")  # we use the §2 markdown broadly for the matrix

    # §1 module list
    sec1_modules: set[str] = set()
    for line in sec_1.splitlines():
        if "|" not in line:
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if not cells or not cells[0].startswith("**"):
            continue
        m = re.match(r"\*\*([A-Z\-]+)\*\*", cells[0])
        if m:
            sec1_modules.add(m.group(1))

    # §2.1 + §2.2 paths
    # We use everything in §2 (since §2.1/§2.2 are subsections within §2)
    sec2_paths = extract_path_cells(sec_2_1)

    # Also try to detect §2.1 vs §2.2 by subsections (## 2.1, ## 2.2)
    # For simplicity, treat the union.
    sec_2_1_only = ""
    sec_2_2_only = ""
    if "### 2.1" in text:
        sec_2_1_only = text.split("### 2.1", 1)[1].split("### ", 1)[0]
    if "### 2.2" in text:
        sec_2_2_only = text.split("### 2.2", 1)[1].split("### ", 1)[0]
    sec2_1_paths = extract_path_cells(sec_2_1_only) if sec_2_1_only else sec2_paths
    sec2_2_paths = extract_path_cells(sec_2_2_only) if sec_2_2_only else set()

    # Compare modules
    missing_in_human = real_modules - sec1_modules
    extra_in_human = sec1_modules - real_modules

    # Compare files
    # YAML has glob patterns; the human table has literal paths.
    # A YAML pattern `frontend/src/components/call/*` matches human paths like
    # `frontend/src/components/call/CallGraph.tsx`. We do a glob-match check.
    # Conversely, a human path should match at least one YAML pattern.

    # For each YAML pattern, check if it's represented in human tables.
    # (A pattern can be implicitly present if a literal file under it is in the table.)
    # We'll report YAML patterns that have NO matching literal file in the table.

    # For each human file, check if it matches any YAML pattern.
    unmatched_human: set[str] = set()
    for p in sec2_paths:
        if not glob_match(p, yaml_files):
            unmatched_human.add(p)

    # Find YAML patterns that have NO representation in human tables at all
    orphan_yaml: set[str] = set()
    for pattern in yaml_files:
        # If a literal child of this pattern is in the human table, it's represented.
        # If the pattern is a literal (no globs) and equals a human file, it's represented.
        if pattern in sec2_paths:
            continue
        # For glob patterns, check if any human file matches it
        if "*" in pattern and any(glob_match(p, [pattern]) for p in sec2_paths):
            continue
        orphan_yaml.add(pattern)

    # Report
    print(f"[lint] {modules_md_path}")
    print(f"[lint]   yaml: {len(yaml_files)} file patterns across {len(real_modules)} modules")
    print(f"[lint]   §1:   {len(sec1_modules)} modules")
    print(f"[lint]   §2:   {len(sec2_paths)} file paths in human tables")
    print()

    failed = False

    if missing_in_human:
        print(f"[lint] ❌ {len(missing_in_human)} module(s) in yaml but missing from §1 table:")
        for m in sorted(missing_in_human):
            print(f"  - {m}")
        failed = True
        print()

    if extra_in_human:
        print(f"[lint] ❌ {len(extra_in_human)} module(s) in §1 table but not in yaml:")
        for m in sorted(extra_in_human):
            print(f"  - {m}")
        failed = True
        print()

    if unmatched_human:
        print(f"[lint] ❌ {len(unmatched_human)} file path(s) in §2 human table don't match any yaml pattern:")
        for p in sorted(unmatched_human)[:20]:
            print(f"  - {p}")
        if len(unmatched_human) > 20:
            print(f"  ... and {len(unmatched_human) - 20} more")
        failed = True
        print()

    if orphan_yaml:
        print(f"[lint] ⚠️  {len(orphan_yaml)} yaml pattern(s) have no representation in §2 human table:")
        for p in sorted(orphan_yaml)[:20]:
            print(f"  - {p}")
        if len(orphan_yaml) > 20:
            print(f"  ... and {len(orphan_yaml) - 20} more")
        # Treat as warning, not failure — yaml is the SSOT
        # But strict mode promotes to failure
        if strict:
            failed = True
        print()

    if not failed:
        print("[lint] ✅ yaml SSOT and human tables are in sync")
        return 0

    print("[lint] ❌ drift detected. Update §1/§2 human tables to match yaml (or vice versa).")
    print("[lint]    See MODULES.md §6.1 for the SSOT operating procedure.")
    return 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--modules-md", default="docs/MODULES.md")
    ap.add_argument("--strict", action="store_true",
                    help="Treat orphan yaml patterns as failures (not just warnings)")
    args = ap.parse_args()
    return lint(Path(args.modules_md), strict=args.strict)


if __name__ == "__main__":
    sys.exit(main())
