#!/usr/bin/env python3
"""Module boundary check for hackathon monorepo.

Loads the YAML SSOT from docs/MODULES.md (via parse-modules.py), then compares
the files changed in the current push against the pusher's registered module.
Push is allowed only if every changed file belongs to:
  - the pusher's module, OR
  - the SHARED bucket (anyone can write), OR
TEAM-LOCK files always require PR (all-team approval) and are flagged.
Files matching no pattern are flagged as "unowned" (review carefully).

Usage:
    python3 check-module-boundary.py --module QUEUE --base <sha>
    python3 check-module-boundary.py --module "" --base <sha>     # warn only
    python3 check-module-boundary.py --module ORCH --base HEAD~3
    python3 check-module-boundary.py --modules-md path/to/MODULES.md --module X --base Y

Exit: 0 = OK, 1 = boundary violated.
"""
from __future__ import annotations

import argparse
import fnmatch
import subprocess
import sys
from pathlib import Path

# parse-modules.py uses kebab-case filename; import via importlib.
sys.path.insert(0, str(Path(__file__).resolve().parent))
import importlib.util
_spec = importlib.util.spec_from_file_location(
    "parse_modules", str(Path(__file__).resolve().parent / "parse-modules.py")
)
_parse_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_parse_mod)
load_modules = _parse_mod.load_modules
YAMLError = _parse_mod.YAMLError


REPO_ROOT = None  # set in main() via `git rev-parse`


def owner_of(path: str, ownership: list[tuple[str, str]]) -> str | None:
    """Return owning module of a path, or None if not in any pattern.

    Glob semantics: `*` matches any chars (including `/`). Brackets are
    literal (Next.js dynamic routes like `app/call/[id]/page.tsx`). This
    is more permissive than fnmatch but matches our needs.

    First match wins (matches parse-modules ordering, where real modules come
    before SHARED/TEAM-LOCK — but actually, in parse-modules we just iterate
    in YAML order, so the caller should put more specific patterns first if
    they need overlap resolution).
    """
    import re
    for pattern, owner in ownership:
        regex = re.escape(pattern).replace(r"\*", ".*")
        if re.fullmatch(regex, path):
            return owner
    return None


def get_changed_files(base: str) -> list[str]:
    """Return list of files changed in the current branch relative to base."""
    if not base:
        # No base — diff against empty tree (root commit)
        cmd = ["git", "diff", "--name-only", "--diff-filter=ACMRT",
               "4b825dc642cb6eb9a060e54bf8d69288fbee4904", "HEAD"]
    else:
        cmd = ["git", "diff", "--name-only", "--diff-filter=ACMRT", base, "HEAD"]
    res = subprocess.run(cmd, cwd=REPO_ROOT, capture_output=True, text=True, check=True)
    return [f.strip() for f in res.stdout.splitlines() if f.strip()]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--module", default="", help="Your registered module (git config hk.module)")
    ap.add_argument("--base", default="", help="Base commit SHA to diff against")
    ap.add_argument("--modules-md", default="docs/MODULES.md",
                    help="Path to MODULES.md (relative to repo root)")
    ap.add_argument("--verbose", "-v", action="store_true")
    args = ap.parse_args()

    module = args.module.strip()
    base = args.base.strip()
    modules_md_path = Path(args.modules_md).resolve()

    # Resolve REPO_ROOT via git, so the script works when called from any cwd
    # (including from the pre-push hook which sets cwd to the project root).
    try:
        repo_root_str = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
    except subprocess.CalledProcessError as e:
        print(f"[check] not inside a git repo: {e}", file=sys.stderr)
        return 1
    global REPO_ROOT
    REPO_ROOT = Path(repo_root_str)

    # Load SSOT
    try:
        info = load_modules(modules_md_path)
    except YAMLError as e:
        print(f"[check] ❌ failed to load {modules_md_path}: {e}", file=sys.stderr)
        return 1
    except FileNotFoundError:
        print(f"[check] ❌ MODULES.md not found at {modules_md_path}", file=sys.stderr)
        return 1

    ownership = info["ownership"]
    team_lock_patterns = info["team_lock_patterns"]
    real_modules = info["real_modules"]
    shared_patterns = set(info["shared_patterns"])
    module_owners = info["module_owners"]

    # No module registered → warn only
    if not module:
        print("[check] WARN: no module registered (git config hk.module <MOD>)")
        print("[check] Skipping strict check. Set your module first.")
        print()
        return 0

    if module not in real_modules and module != "INFRA":
        print(f"[check] WARN: '{module}' is not a real module.", file=sys.stderr)
        print(f"[check] Valid modules: {sorted(real_modules)}", file=sys.stderr)
        return 0

    # Find changed files
    try:
        files = get_changed_files(base)
    except subprocess.CalledProcessError as e:
        print(f"[check] failed to compute diff: {e}", file=sys.stderr)
        return 1

    if not files:
        print("[check] no files changed in this push — OK")
        return 0

    print(f"[check] module: {module} ({module_owners.get(module, '?')})")
    print(f"[check] SSOT:   {args.modules_md} ({len(ownership)} patterns loaded)")
    print(f"[check] {len(files)} file(s) changed:")

    violations: list[tuple[str, str]] = []
    team_lock_files: list[str] = []
    unowned: list[str] = []

    for f in files:
        if f in team_lock_patterns or any(fnmatch.fnmatch(f, p) for p in team_lock_patterns):
            team_lock_files.append(f)
            continue
        own = owner_of(f, ownership)
        if own is None:
            unowned.append(f)
        elif own == "*" or f in shared_patterns:
            if args.verbose:
                print(f"  [shared]   {f}")
        elif own == module:
            if args.verbose:
                print(f"  [yours]    {f}")
        else:
            violations.append((f, own))

    print()
    if team_lock_files:
        print(f"[check] {len(team_lock_files)} TEAM-LOCK file(s) — these need a PR with all approvals:")
        for f in team_lock_files:
            print(f"  - {f}")
        print()
    if unowned:
        print(f"[check] {len(unowned)} file(s) not in any module's territory (review carefully):")
        for f in unowned:
            print(f"  - {f}")
        print()
    if violations:
        print(f"[check] ❌ {len(violations)} violation(s):")
        for f, own in violations:
            owner_name = module_owners.get(own, "?")
            print(f"  - {f}  (owned by {own} — {owner_name})")
        print()
        print(f"You are module '{module}', but these files belong to other modules.")
        print("See docs/MODULES.md §2 for the full matrix.")
        print()
        print("Options:")
        print("  1) Revert the offending file changes")
        print("  2) Open a PR instead:  git push -u origin <branch> && gh pr create --reviewer <owner>")
        print("  3) If this is a shared fix that genuinely needs to happen now,")
        print("     contact the module owner and reach agreement in voice/chat first.")
        return 1

    if team_lock_files or unowned:
        print("[check] ⚠️  Review TEAM-LOCK / unowned changes carefully before merging.")
        return 1  # still fail so the user re-evaluates

    print(f"[check] ✅ all {len(files)} file(s) belong to module '{module}'")
    return 0


if __name__ == "__main__":
    sys.exit(main())
