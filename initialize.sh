#!/usr/bin/env bash
# initialize.sh — hk-skills one-shot setup (replaces install.sh + setup-project.sh)
#
# Branch model:  feature -> dev -> main
#   - The project lives in THIS repo. No separate project repo is created.
#   - hk-skills source lives on the `skills` branch, checked out as a git
#     worktree at ./.hk-skills (gitignored).
#   - Each team member runs this script once. It performs LOCAL setup only —
#     it makes NO commits and pushes nothing, so running it on `dev` (or any
#     branch) can never tangle the shared history.
#
# What it does (per person):
#   1) Ensures the .hk-skills/ worktree exists on the `skills` branch
#   2) Symlinks the 7 hk-* skills into ~/.claude/skills/
#   3) Copies reference/ + templates/ into ~/.claude/ (non-destructive)
#   4) Sets local git config: hk.module, core.hooksPath, hk.checkscript, hk.modulesmd
#   5) Installs the pre-push module-boundary hook locally
#
# Leader-only (once): pass --scaffold to also create lambda/frontend stubs and
# commit the shared bits (.githooks, .gitignore entry) to the current branch.
#
# Usage:
#   ./initialize.sh --module FRONTEND        # team member
#   ./initialize.sh --module CLOUD --scaffold # leader, first run
#   ./initialize.sh --verify                # check local setup is intact
#   ./initialize.sh --uninstall             # remove skill symlinks + worktree
#
set -euo pipefail

# -------- constants --------
SKILLS_DIR="${HOME}/.claude/skills"
REF_DIR="${HOME}/.claude/reference"
TPL_DIR="${HOME}/.claude/templates"

SKILL_BRANCH="${HK_SKILL_BRANCH:-skills}"
INTEGRATION_BRANCH="${HK_INTEGRATION_BRANCH:-dev}"
WORKTREE_DIR=".hk-skills"

SKILL_NAMES=(
  hk-vision
  hk-onboard
  hk-backlog
  hk-slice
  hk-implement
  hk-verify
  hk-demo
)

# -------- colors / logging --------
GREEN="\033[0;32m"; YELLOW="\033[1;33m"; RED="\033[0;31m"; CYAN="\033[0;36m"; RESET="\033[0m"
log()  { printf "${GREEN}[init]${RESET} %s\n" "$*"; }
warn() { printf "${YELLOW}[warn]${RESET} %s\n" "$*"; }
err()  { printf "${RED}[err]${RESET} %s\n" "$*" >&2; }
hint() { printf "${CYAN}[hint]${RESET} %s\n" "$*"; }

# -------- arg parsing --------
ACTION="install"
MODULE=""
SCAFFOLD=0
ARGS=("$@")
i=0
while [[ $i -lt ${#ARGS[@]} ]]; do
  arg="${ARGS[$i]}"
  case "$arg" in
    --module=*) MODULE="${arg#*=}" ;;
    --module)   i=$((i+1)); MODULE="${ARGS[$i]:-}" ;;
    --scaffold) SCAFFOLD=1 ;;
    --verify)    ACTION="verify" ;;
    --uninstall) ACTION="uninstall" ;;
    -h|--help)
      cat <<EOF
Usage: $0 --module <MODULE> [--scaffold]

Modules: CLOUD | DATA | AGENT | BACKEND | FRONTEND
         (omitted = observer; pre-push check will warn-only)

Actions:
  (default)      Local setup: worktree + skill symlinks + git config + hook
  --scaffold     Also create lambda/frontend stubs and commit shared bits
                 (leader runs this ONCE on the integration branch)
  --verify       Check local setup is intact
  --uninstall    Remove skill symlinks and the .hk-skills worktree

Examples:
  ./initialize.sh --module FRONTEND
  ./initialize.sh --module CLOUD --scaffold
EOF
      exit 0
      ;;
    *) err "unknown arg: $arg"; exit 2 ;;
  esac
  i=$((i+1))
done

validate_module() {
  case "$1" in
    CLOUD|DATA|AGENT|BACKEND|FRONTEND|"") return 0 ;;
    *) err "unknown module: $1 (must be CLOUD|DATA|AGENT|BACKEND|FRONTEND)"; exit 2 ;;
  esac
}
validate_module "$MODULE"

# -------- locate repo root --------
if ! REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"; then
  err "not inside a git repository. Run this from your project checkout."
  exit 1
fi
cd "$REPO_ROOT"

# -------- worktree management --------
# Resolve where the skill files live inside the worktree. The `skills` branch
# may keep them at the root OR nested under hk-skills/ — detect both.
skill_src_dir() {
  # Prefer hk-skills committed directly in the repo tree (current layout).
  if [[ -d "${REPO_ROOT}/hk-skills/skills" ]]; then
    echo "hk-skills"
  # Fall back to the legacy `skills`-branch worktree layout.
  elif [[ -d "${WORKTREE_DIR}/hk-skills/skills" ]]; then
    echo "${WORKTREE_DIR}/hk-skills"
  elif [[ -d "${WORKTREE_DIR}/skills" ]]; then
    echo "${WORKTREE_DIR}"
  else
    echo ""
  fi
}

# True when hk-skills lives directly in the repo tree (no worktree needed).
skills_in_tree() { [[ -d "${REPO_ROOT}/hk-skills/skills" ]]; }

ensure_worktree() {
  # If hk-skills is committed in the repo tree, no worktree is needed.
  if skills_in_tree; then
    log "hk-skills/ present in repo tree — skipping ${WORKTREE_DIR}/ worktree"
    return
  fi

  if git -C "$REPO_ROOT" worktree list --porcelain | grep -q "worktree .*/${WORKTREE_DIR}$"; then
    log "worktree ${WORKTREE_DIR}/ already present — updating"
    ( cd "$WORKTREE_DIR" && git fetch --quiet origin "$SKILL_BRANCH" 2>/dev/null || true
      git checkout --quiet "$SKILL_BRANCH" 2>/dev/null || true
      git pull --quiet --ff-only origin "$SKILL_BRANCH" 2>/dev/null || true )
    return
  fi

  if [[ -e "$WORKTREE_DIR" ]]; then
    err "${WORKTREE_DIR}/ exists but is not a registered worktree. Move it aside."
    exit 1
  fi

  log "Creating worktree ${WORKTREE_DIR}/ on branch '${SKILL_BRANCH}'"
  git fetch --quiet origin "$SKILL_BRANCH" 2>/dev/null || true
  if git show-ref --verify --quiet "refs/heads/${SKILL_BRANCH}"; then
    git worktree add --quiet "$WORKTREE_DIR" "$SKILL_BRANCH"
  elif git show-ref --verify --quiet "refs/remotes/origin/${SKILL_BRANCH}"; then
    git worktree add --quiet -b "$SKILL_BRANCH" "$WORKTREE_DIR" "origin/${SKILL_BRANCH}"
  else
    err "branch '${SKILL_BRANCH}' not found locally or on origin."
    err "Make sure the skills branch exists and you've fetched it."
    exit 1
  fi
}

# Keep the worktree out of the project's tracked tree, no commit required.
ensure_local_ignore() {
  local exclude=".git/info/exclude"
  if [[ -f "$exclude" ]] && ! grep -qxF "${WORKTREE_DIR}/" "$exclude"; then
    printf "%s/\n" "$WORKTREE_DIR" >> "$exclude"
    log "added ${WORKTREE_DIR}/ to .git/info/exclude (local)"
  fi
}

# -------- skill symlinks + reference/templates --------
link_skills() {
  local src; src="$(skill_src_dir)"
  if [[ -z "$src" ]]; then
    err "could not find skills/ inside ${WORKTREE_DIR}/ — worktree layout unexpected"
    exit 1
  fi

  mkdir -p "$SKILLS_DIR"
  for s in "${SKILL_NAMES[@]}"; do
    local target="${REPO_ROOT}/${src}/skills/${s}"
    if [[ ! -d "$target" ]]; then
      err "missing ${src}/skills/${s} — skills branch is incomplete"
      exit 1
    fi
    [[ -e "${SKILLS_DIR}/${s}" || -L "${SKILLS_DIR}/${s}" ]] && rm -rf "${SKILLS_DIR}/${s}"
    ln -s "$target" "${SKILLS_DIR}/${s}"
    log "linked skill ${s}"
  done

  if [[ -d "${src}/reference" ]]; then
    mkdir -p "$REF_DIR"
    cp -rn "${src}/reference/." "${REF_DIR}/" 2>/dev/null || true
    log "copied reference/ -> ${REF_DIR}"
  fi
  if [[ -d "${src}/templates" ]]; then
    mkdir -p "$TPL_DIR"
    cp -rn "${src}/templates/." "${TPL_DIR}/" 2>/dev/null || true
    log "copied templates/ -> ${TPL_DIR}"
  fi
}

# -------- git config + hook --------
configure_git() {
  local src; src="$(skill_src_dir)"

  # pre-push hook: ensure .githooks/pre-push exists on disk, point hooksPath at it.
  mkdir -p .githooks
  if [[ -f "${src}/scripts/pre-push" ]]; then
    cp "${src}/scripts/pre-push" .githooks/pre-push
    chmod +x .githooks/pre-push
  fi
  git config core.hooksPath .githooks
  log "core.hooksPath = .githooks"

  # Record absolute paths so the hook finds the check script + SSOT reliably.
  git config hk.checkscript "${REPO_ROOT}/${src}/scripts/check-module-boundary.py"
  git config hk.modulesmd   "${REPO_ROOT}/${src}/MODULES.md"
  git config hk.integration "$INTEGRATION_BRANCH"

  if [[ -n "$MODULE" ]]; then
    git config hk.module "$MODULE"
    log "hk.module = $MODULE (this clone only)"
  else
    warn "no --module given. pre-push will warn-only until you set:"
    warn "   git config hk.module <CLOUD|DATA|AGENT|BACKEND|FRONTEND>"
  fi
}

# -------- leader scaffold (once) --------
scaffold_project() {
  log "Scaffolding project tree (leader, once)"
  mkdir -p lambda/orchestrator/{agent,llm,stt,tts,models,api,resolvers,tests} \
           graphql data/scenarios data/lexicon infra \
           frontend/src/{app,components/{ui,queue,consult,crm},lib,stores,types} \
           docs/slices \
           .github/ISSUE_TEMPLATE

  local src; src="$(skill_src_dir)"

  # Issue / PR templates
  [[ -f "${src}/templates/issue.md" ]] && cp "${src}/templates/issue.md" .github/ISSUE_TEMPLATE/hk-task.md
  [[ -f "${src}/templates/pr.md" ]]    && cp "${src}/templates/pr.md"    .github/PULL_REQUEST_TEMPLATE.md

  # OWNER.md
  if [[ ! -f OWNER.md ]]; then
    cat > OWNER.md <<'EOF'
# Owner Register

> 누가 어떤 모듈의 owner인지. 모듈 boundary 자동 체크의 SSOT.
> Workflow: see .hk-skills/.../WORKFLOW.md, modules: see .hk-skills/.../MODULES.md

## Modules

| Code | Name | Owner | GitHub |
|------|------|-------|--------|
| CLOUD | AWS Infra & Delivery | 일조 | @solduma |
| DATA | Data & Scenario | 수민 | @suminjeong3170-tech |
| AGENT | Orchestrator Logic | 은경 | @jooeunkyung |
| BACKEND | API Contract & Core | 지원 | @cckr34 |
| FRONTEND | Next.js App | 주실 | @jusilkkk |

## Active work

| Issue | Title | Module | Owner | Status |
|-------|-------|--------|-------|--------|
| (none yet) | | | | |
EOF
    log "wrote OWNER.md"
  fi

  log "Scaffold complete. Review, then commit on '${INTEGRATION_BRANCH}':"
  hint "  git add lambda graphql data infra frontend docs OWNER.md .github .githooks .gitignore"
  hint "  git commit -m 'chore: scaffold hackathon project (hk initialize --scaffold)'"
}

# -------- actions --------
do_install() {
  ensure_worktree
  ensure_local_ignore
  link_skills
  configure_git
  [[ "$SCAFFOLD" -eq 1 ]] && scaffold_project

  echo
  log "✅ Local setup complete (no commits made)."
  echo
  hint "Branch model: feature -> ${INTEGRATION_BRANCH} -> main"
  echo "  git fetch origin"
  echo "  git checkout -b ${MODULE:-FRONTEND}-001-<desc> origin/${INTEGRATION_BRANCH}"
  echo "  # ...work... then:"
  echo "  git push -u origin HEAD          # pre-push checks module boundary vs origin/${INTEGRATION_BRANCH}"
  echo "  gh pr create --base ${INTEGRATION_BRANCH} --reviewer <owner>"
  echo
  hint "In Claude Code, start with:  /hk-vision  then  /hk-onboard"
}

do_verify() {
  local ok=0
  local src; src="$(skill_src_dir)"
  if [[ -z "$src" ]]; then err "FAIL hk-skills source not found (tree or ${WORKTREE_DIR}/ worktree)"; exit 1; fi
  log "OK   hk-skills source: ${src}"
  for s in "${SKILL_NAMES[@]}"; do
    if [[ -L "${SKILLS_DIR}/${s}" && -e "${SKILLS_DIR}/${s}/SKILL.md" ]]; then
      log "OK   skill ${s}"
    else
      err "FAIL skill ${s} (symlink or SKILL.md missing)"; ok=1
    fi
  done
  [[ "$(git config --get core.hooksPath || true)" == ".githooks" ]] \
    && log "OK   core.hooksPath" || { err "FAIL core.hooksPath != .githooks"; ok=1; }
  [[ -x .githooks/pre-push ]] && log "OK   pre-push hook" || { err "FAIL .githooks/pre-push"; ok=1; }
  local m; m="$(git config --get hk.module || true)"
  [[ -n "$m" ]] && log "OK   hk.module = $m" || warn "hk.module not set (warn-only mode)"
  exit $ok
}

do_uninstall() {
  for s in "${SKILL_NAMES[@]}"; do
    [[ -L "${SKILLS_DIR}/${s}" ]] && { rm "${SKILLS_DIR}/${s}"; log "removed skill ${s}"; }
  done
  if git worktree list --porcelain | grep -q "worktree .*/${WORKTREE_DIR}$"; then
    git worktree remove --force "$WORKTREE_DIR" && log "removed worktree ${WORKTREE_DIR}/"
  fi
  warn "reference/ and templates/ in ~/.claude left intact."
}

case "$ACTION" in
  install)   do_install ;;
  verify)    do_verify ;;
  uninstall) do_uninstall ;;
esac
