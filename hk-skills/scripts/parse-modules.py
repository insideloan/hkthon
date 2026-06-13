#!/usr/bin/env python3
"""Parse the YAML SSOT block from MODULES.md.

This script extracts the ``<!-- modules-yaml:start -->`` ... ``<!-- modules-yaml:end -->``
block from docs/MODULES.md, parses its YAML content using a **dependency-free** mini-parser
(no pyyaml needed — works even on a fresh clone), and returns the parsed structure.

Why dependency-free:
- 24h hackathon: no extra pip install step
- The YAML we accept is a small, well-defined subset (see `parse_yaml`)
- Determinism > features: 1 module owner team can audit the parser line-by-line

Output:
- A list of (pattern, owner) tuples (the OWNERSHIP table)
- The set of TEAM-LOCK file patterns (for clearer error messages)
- The set of shared file patterns (for verbose output)
- The set of valid module codes
- A mapping of code -> owner_person (for human-readable error messages)
"""
from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Iterator

START_MARKER = "<!-- @hk modules-yaml:start -->"
END_MARKER = "<!-- @hk modules-yaml:end -->"

# Owner codes with special meaning (NOT real modules)
SHARED_CODE = "SHARED"
TEAM_LOCK_CODE = "TEAM-LOCK"


# ---------------------------------------------------------------------------
# YAML subset parser
# ---------------------------------------------------------------------------
# Supports exactly what MODULES.md needs:
#   - `key: value` pairs (values are str, int, or list)
#   - list items as `- value` (one per line, simple strings)
#   - `# comments` and blank lines
#   - 2-space indentation only (matches our style)
# Does NOT support: nested mappings, multi-line scalars, flow style, anchors.
# That's intentional — when the SSOT needs more, expand the parser, don't add pyyaml.

class YAMLError(Exception):
    pass


def _strip_comment(line: str) -> str:
    """Strip trailing '# ...' comment. Keep '#' inside strings (we don't have those)."""
    idx = line.find("#")
    return line[:idx] if idx >= 0 else line


def parse_yaml(text: str) -> object:
    """Parse a restricted subset of YAML.

    Returns a Python object (dict / list / str / int) matching YAML semantics for our subset.
    """
    lines = []
    for raw in text.splitlines():
        # Strip trailing CR
        line = raw.rstrip("\r")
        # Skip blank lines
        if not line.strip():
            continue
        # Skip full-line comments
        if line.lstrip().startswith("#"):
            continue
        # Strip inline comments (but not when '#' is the only non-space)
        stripped = _strip_comment(line)
        # If everything after stripping is empty/comment, skip
        if not stripped.strip():
            continue
        lines.append(stripped)

    if not lines:
        return None

    value, _ = _parse_block(lines, 0, 0)
    return value


def _parse_block(lines: list[str], start: int, indent: int) -> tuple[object, int]:
    """Parse a block at given indent level. Returns (value, next_index)."""
    if start >= len(lines):
        return None, start

    first = lines[start]
    first_indent = len(first) - len(first.lstrip())
    if first_indent != indent:
        return None, start

    content = first.lstrip()

    if content.startswith("- "):
        # List at this indent
        return _parse_list(lines, start, indent)
    else:
        # Mapping
        return _parse_mapping(lines, start, indent)


def _parse_list(lines: list[str], start: int, indent: int) -> tuple[list, int]:
    items: list = []
    i = start
    while i < len(lines):
        line = lines[i]
        line_indent = len(line) - len(line.lstrip())
        if line_indent != indent:
            break
        content = line.lstrip()
        if not content.startswith("- "):
            break
        value = content[2:].strip()
        if not value:
            # list item with nested block on subsequent lines (block scalar)
            nested, i = _parse_block(lines, i + 1, indent + 2)
            items.append(nested)
            continue

        # If the value is a "key: ..." mapping start, treat as nested mapping.
        # Collect this line and any subsequent lines that are indented further
        # than the list-item's "- " (i.e. > indent+2 of original).
        if ":" in value and not value.startswith(('"', "'")):
            # Collect the mapping lines.
            map_lines: list[str] = []
            # First key: replace "- " with appropriate indent (2 spaces from list indent)
            # We normalize: represent first key as a normal mapping line at indent+2.
            # Since "- " consumed 2 chars of the prefix, the rest is at indent+2.
            # Strip trailing inline comment for safety.
            first_map_line = " " * (indent + 2) + value
            map_lines.append(first_map_line)
            i += 1
            # Now consume subsequent lines whose indent is > indent+2
            # (these are nested keys under the first key, or list items under "files:")
            nested_indent = indent + 2  # the indent at which the FIRST key lives
            while i < len(lines):
                next_line = lines[i]
                next_indent = len(next_line) - len(next_line.lstrip())
                if next_indent <= indent:
                    # same or less indent than list item — list ended
                    break
                if next_indent < nested_indent:
                    # less indent than the first key — strange, but stop
                    break
                map_lines.append(next_line)
                i += 1
            nested, _ = _parse_mapping(map_lines, 0, nested_indent)
            items.append(nested)
            continue

        # Plain scalar value
        items.append(_coerce(value))
        i += 1
    return items, i


def _parse_mapping(lines: list[str], start: int, indent: int) -> tuple[dict, int]:
    result: dict = {}
    i = start
    while i < len(lines):
        line = lines[i]
        line_indent = len(line) - len(line.lstrip())
        if line_indent != indent:
            break
        content = line.lstrip()
        if content.startswith("- "):
            # not a key — end of mapping
            break
        if ":" not in content:
            raise YAMLError(f"expected 'key:' at line {i + 1}: {line!r}")
        key, _, value = content.partition(":")
        key = key.strip()
        value = value.strip()
        if not value:
            # nested block
            nested, i = _parse_block(lines, i + 1, indent + 2)
            result[key] = nested
        else:
            result[key] = _coerce(value)
            i += 1
    return result, i


def _coerce(s: str) -> object:
    """Coerce a scalar string to int/bool/str."""
    if s == "true":
        return True
    if s == "false":
        return False
    if s in ("null", "~"):
        return None
    if s.startswith('"') and s.endswith('"'):
        return s[1:-1]
    if s.startswith("'") and s.endswith("'"):
        return s[1:-1]
    try:
        return int(s)
    except ValueError:
        return s


# ---------------------------------------------------------------------------
# MODULES.md extraction
# ---------------------------------------------------------------------------

def extract_yaml_block(modules_md: str) -> str:
    """Find the SSOT YAML block between markers in MODULES.md.

    Markers must be at the **start of a line** (preceded by a newline or
    beginning of file) so that descriptive prose mentioning the markers in
    inline code spans (`` `<!-- @hk modules-yaml:start -->` ``) is ignored.

    The match is greedy toward the END marker — the first END marker after
    a valid START marker is used. (Multiple SSOT blocks are not allowed; if
    you need that, write a different file.)

    Raises YAMLError if markers are missing or malformed.
    """
    # Match markers that are at the start of a line (preceded by \n or BOF).
    # We don't include the \n in the captured group.
    start_pat = re.compile(r"(?:^|\n)(<!-- @hk modules-yaml:start -->)")
    end_pat = re.compile(r"(?:^|\n)(<!-- @hk modules-yaml:end -->)")

    start_match = start_pat.search(modules_md)
    if not start_match:
        raise YAMLError(f"line-anchored {START_MARKER} not found in MODULES.md")
    after_start = start_match.end()  # position right after the marker
    end_match = end_pat.search(modules_md, after_start)
    if not end_match:
        raise YAMLError(f"line-anchored {END_MARKER} not found after {START_MARKER}")

    chunk = modules_md[after_start : end_match.start()]

    # Find the ```yaml ... ``` block inside
    fence_open = re.search(r"```yaml\s*\n", chunk)
    if not fence_open:
        raise YAMLError("```yaml fence not found inside markers")
    after_open = fence_open.end()
    fence_close = chunk.find("```", after_open)
    if fence_close < 0:
        raise YAMLError("closing ``` fence not found")
    return chunk[after_open:fence_close]


def load_modules(modules_md_path: Path) -> dict:
    """Load and parse MODULES.md, returning the full modules structure.

    Returns:
        {
            "raw": <raw yaml text>,
            "parsed": <dict from yaml>,
            "ownership": [(pattern, owner_code), ...],
            "team_lock_patterns": [pattern, ...],
            "shared_patterns": [pattern, ...],
            "valid_modules": {code, ...},
            "module_owners": {code: owner_person, ...},
            "real_modules": {code, ...},  # excluding SHARED and TEAM-LOCK
        }
    """
    text = modules_md_path.read_text(encoding="utf-8")
    yaml_text = extract_yaml_block(text)
    parsed = parse_yaml(yaml_text)
    if not isinstance(parsed, dict):
        raise YAMLError("top-level yaml must be a mapping")
    if "modules" not in parsed:
        raise YAMLError("yaml must have 'modules:' key")
    modules = parsed["modules"]
    if not isinstance(modules, list):
        raise YAMLError("'modules' must be a list")

    ownership: list[tuple[str, str]] = []
    team_lock: list[str] = []
    shared: list[str] = []
    valid: set[str] = set()
    module_owners: dict[str, str] = {}
    real: set[str] = set()

    for entry in modules:
        if not isinstance(entry, dict):
            raise YAMLError("each module entry must be a mapping")
        code = entry.get("code")
        name = entry.get("name", "")
        owner_person = entry.get("owner_person", "")
        files = entry.get("files", [])
        if not isinstance(code, str) or not code:
            raise YAMLError("module missing 'code'")
        if not isinstance(files, list):
            raise YAMLError(f"module {code}: 'files' must be a list")

        valid.add(code)
        module_owners[code] = owner_person if isinstance(owner_person, str) else ""

        if code == SHARED_CODE:
            for f in files:
                if not isinstance(f, str):
                    raise YAMLError(f"SHARED: file path must be string, got {f!r}")
                ownership.append((f, "*"))
                shared.append(f)
        elif code == TEAM_LOCK_CODE:
            for f in files:
                if not isinstance(f, str):
                    raise YAMLError(f"TEAM-LOCK: file path must be string, got {f!r}")
                ownership.append((f, "TEAM-LOCK"))
                team_lock.append(f)
        else:
            real.add(code)
            for f in files:
                if not isinstance(f, str):
                    raise YAMLError(f"{code}: file path must be string, got {f!r}")
                ownership.append((f, code))

    return {
        "raw": yaml_text,
        "parsed": parsed,
        "ownership": ownership,
        "team_lock_patterns": team_lock,
        "shared_patterns": shared,
        "valid_modules": valid,
        "module_owners": module_owners,
        "real_modules": real,
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> int:
    import argparse
    ap = argparse.ArgumentParser(description="Parse MODULES.md yaml SSOT and print summary")
    ap.add_argument("--modules-md", default="docs/MODULES.md", help="path to MODULES.md")
    ap.add_argument("--check", action="store_true", help="exit non-zero on parse error")
    ap.add_argument("--quiet", action="store_true", help="suppress summary output on success")
    args = ap.parse_args()

    p = Path(args.modules_md)
    if not p.exists():
        print(f"[parse-modules] not found: {p}", file=sys.stderr)
        return 2

    try:
        info = load_modules(p)
    except YAMLError as e:
        print(f"[parse-modules] ❌ {e}", file=sys.stderr)
        return 1

    if args.quiet:
        return 0

    print(f"[parse-modules] ✅ {p}")
    print(f"  ownership entries: {len(info['ownership'])}")
    print(f"  real modules:      {sorted(info['real_modules'])}")
    print(f"  shared patterns:   {len(info['shared_patterns'])}")
    print(f"  team-lock patterns: {len(info['team_lock_patterns'])}")
    print(f"  module owners:")
    for code in sorted(info["real_modules"]):
        print(f"    {code:12s}  → {info['module_owners'][code]}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
