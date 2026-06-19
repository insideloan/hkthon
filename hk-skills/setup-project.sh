#!/usr/bin/env bash
# hk-skills project bootstrap
# Creates the actual hackathon project from this skills repo.
# Installs: project dir, git init, branches, pre-push hook, owner config.
#
# Usage:
#   ./setup-project.sh
#   ./setup-project.sh --module FRONTEND
#   ./setup-project.sh --name my-team
#
set -euo pipefail

PROJECT_NAME="hackathon-2026"
MODULE=""
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
TEMPLATE_DIR="${SCRIPT_DIR}/project-template"

# Colors
GREEN="\033[0;32m"
YELLOW="\033[1;33m"
RED="\033[0;31m"
CYAN="\033[0;36m"
RESET="\033[0m"
log()  { printf "${GREEN}[setup]${RESET} %s\n" "$*"; }
warn() { printf "${YELLOW}[warn]${RESET} %s\n" "$*"; }
err()  { printf "${RED}[err]${RESET} %s\n" "$*" >&2; }
hint() { printf "${CYAN}[hint]${RESET} %s\n" "$*"; }

# -------- arg parsing --------
for arg in "$@"; do
  case "$arg" in
    --module=*) MODULE="${arg#*=}" ;;
    --module)   shift; MODULE="${1:-}"; shift || true ;;
    --name=*)   PROJECT_NAME="${arg#*=}" ;;
    --name)     shift; PROJECT_NAME="${1:-}"; shift || true ;;
    -h|--help)
      cat <<EOF
Usage: $0 [--module <MODULE>] [--name <name>]

Modules: CLOUD | DATA | AGENT | BACKEND | FRONTEND
         (omitted = owner/observer, all hooks active)

Examples:
  $0 --module FRONTEND
  $0 --module AGENT
  $0 --name my-team
EOF
      exit 0
      ;;
    *) err "unknown arg: $arg"; exit 2 ;;
  esac
done

# -------- validate module --------
validate_module() {
  case "$1" in
    CLOUD|DATA|AGENT|BACKEND|FRONTEND|"") return 0 ;;
    *) err "unknown module: $1. must be one of CLOUD|DATA|AGENT|BACKEND|FRONTEND"; exit 2 ;;
  esac
}
validate_module "$MODULE"

# -------- confirm --------
echo
log "This will create the hackathon project:"
echo "  - Directory:  ~/workspace/${PROJECT_NAME}/"
echo "  - Module:     ${MODULE:-<not set, you can pick at first push>}"
echo "  - Git init:   yes"
echo "  - Hooks:      pre-push module boundary check"
echo
read -r -p "Continue? [y/N] " ans
[[ "$ans" =~ ^[Yy]$ ]] || { log "aborted."; exit 0; }

# -------- create project dir --------
PROJECT_DIR="${HOME}/workspace/${PROJECT_NAME}"
if [[ -e "$PROJECT_DIR" ]]; then
  err "Directory already exists: $PROJECT_DIR"
  err "Move it aside or use --name to pick a new one."
  exit 1
fi

log "Creating project at $PROJECT_DIR"
mkdir -p "$PROJECT_DIR"
cd "$PROJECT_DIR"

# -------- scaffold project tree from template --------
log "Scaffolding project tree"
mkdir -p backend/app/{models,api,ws,scenarios,llm/prompts,stt,tts,tests} \
         backend/scripts \
         frontend/src/{app,components/{ui,queue,call},lib,stores,types} \
         docs/slices \
         .github/ISSUE_TEMPLATE

# -------- copy reference & template from hk-skills --------
if [[ -d "${SCRIPT_DIR}/reference" ]]; then
  cp -r "${SCRIPT_DIR}/reference" ./docs/reference
fi
if [[ -d "${SCRIPT_DIR}/templates" ]]; then
  cp -r "${SCRIPT_DIR}/templates" ./docs/templates
fi

# -------- copy issue & PR templates --------
cp "${SCRIPT_DIR}/templates/issue.md"  .github/ISSUE_TEMPLATE/hk-task.md
cp "${SCRIPT_DIR}/templates/pr.md"     .github/PULL_REQUEST_TEMPLATE.md 2>/dev/null || true

# -------- copy pre-push hook --------
mkdir -p .githooks
cp "${SCRIPT_DIR}/scripts/pre-push" .githooks/pre-push
chmod +x .githooks/pre-push

# -------- copy module boundary + lint scripts (yaml SSOT) --------
cp "${SCRIPT_DIR}/scripts/parse-modules.py"          backend/scripts/parse-modules.py
cp "${SCRIPT_DIR}/scripts/check-module-boundary.py"  backend/scripts/check-module-boundary.py
cp "${SCRIPT_DIR}/scripts/lint-modules.py"           backend/scripts/lint-modules.py
chmod +x backend/scripts/parse-modules.py backend/scripts/check-module-boundary.py backend/scripts/lint-modules.py

# -------- copy MODULES.md to docs/ --------
[[ -f "${SCRIPT_DIR}/MODULES.md"  ]] && cp "${SCRIPT_DIR}/MODULES.md"  ./docs/MODULES.md
[[ -f "${SCRIPT_DIR}/WORKFLOW.md" ]] && cp "${SCRIPT_DIR}/WORKFLOW.md" ./docs/WORKFLOW.md
cat > OWNER.md <<EOF
# Owner Register

> 누가 어떤 모듈을 owner로 가졌는지. 모듈 boundary 자동 체크의 SSOT.
> Workflow: see docs/WORKFLOW.md, modules: see docs/MODULES.md

## Modules

| Code | Name | Owner | GitHub |
|------|------|-------|--------|
| CLOUD | Cloud · CI · PR 관리 | 일조 | @iljo |
| DATA | Data (models · seed · scenarios) | 수민 | @sumin |
| AGENT | Agent (LangGraph · LLM · STT/TTS) | 은경 | @eunkyung |
| BACKEND | Backend (API · WS · core) | 지원 | @jiwon |
| FRONTEND | Frontend (Next.js) | 주실 | @jusil |

> Update this file via PR when owner changes. This file is referenced by the pre-push hook.

## Active work

| Issue | Title | Module | Owner | Status |
|-------|-------|--------|-------|--------|
| (none yet) | | | | |

> Use \`gh issue create\` with the hk-task template to start a new task.
EOF

# -------- write .gitignore --------
cat > .gitignore <<EOF
# env
.env
.env.local
*.db
*.db-journal
*.db-wal
*.db-shm

# node
node_modules/
.next/
.pnpm-store/

# python
__pycache__/
.venv/
*.egg-info/
.pytest_cache/

# os
.DS_Store
.idea/
.vscode/

# build
dist/
build/
EOF

# -------- git init --------
log "Initializing git"
git init -b main
git config core.hooksPath .githooks

# -------- git user config (if not set) --------
if ! git config user.name >/dev/null 2>&1; then
  log "git user.name not set. Setting placeholder."
  git config user.name "hackathon-$(whoami)"
fi
if ! git config user.email >/dev/null 2>&1; then
  warn "git user.email not set."
  warn "Set with:  git config user.email 'you@example.com'"
fi

# -------- module config --------
if [[ -n "$MODULE" ]]; then
  log "Registering local module = $MODULE"
  git config hk.module "$MODULE"
  echo "  -> git config hk.module $MODULE (set in this repo only)"
else
  warn "No --module passed."
  warn "You can register later with:  git config hk.module FRONTEND"
  warn "Until then pre-push will skip the check (it'll warn)."
fi

# -------- first commit --------
log "First commit"
git add .
git commit -q -m "chore: initial scaffold from hk-skills (setup-project.sh)"
log "Created initial commit on main."

# -------- initial slice docs placeholders --------
mkdir -p docs/slices
cat > docs/slices/.gitkeep <<EOF
This directory will hold slice specs (from /hk-slice skill).
EOF

# -------- final hints --------
echo
log "✅ Project ready at $PROJECT_DIR"
echo
hint "Next steps (24h timeline):"
echo
echo "  cd $PROJECT_DIR"
echo
echo "  # 1) In Claude Code, each team member runs:"
echo "     /hk-vision"
echo "     /hk-onboard"
echo
echo "  # 2) Team together:"
echo "     /hk-backlog"
echo "     /hk-slice   (and start creating GitHub issues)"
echo
echo "  # 3) Each person starts implementing their issues"
echo
echo "  # 4) Pre-push hook will auto-check module boundaries"
echo "     See docs/WORKFLOW.md §3 for merge priority"
echo
hint "Verify pre-push hook is active:"
echo "     ls -la $PROJECT_DIR/.githooks/pre-push"
echo
hint "Lint MODULES.md (yaml SSOT vs human tables) anytime:"
echo "     cd $PROJECT_DIR"
echo "     python3 backend/scripts/lint-modules.py --modules-md docs/MODULES.md"
echo
hint "Or from the hk-skills repo (lints the source MODULES.md):"
echo "     cd $SCRIPT_DIR"
echo "     ./install.sh --verify-modules"
echo
