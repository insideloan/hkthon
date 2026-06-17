#!/usr/bin/env bash
# hk-skills installer
# Symlinks skills into ~/.claude/skills/ and copies reference/ + templates/ to ~/.claude/
#
# Two install modes:
#   1) GitHub one-liner (curl | bash): downloads tarball to ~/.claude/hk-skills/,
#      then runs install against that directory.
#   2) Git clone: runs install against the cloned repo (SCRIPT_DIR is the repo root).
#
# Usage:
#   ./install.sh                         # install (default)
#   ./install.sh --install               # same as above
#   ./install.sh --uninstall
#   ./install.sh --verify                # check installation is intact
#   ./install.sh --verify-modules        # check MODULES.md yaml SSOT vs human tables
#   ./install.sh --setup-project         # bootstrap hackathon project
#   ./install.sh --version v1.0.0        # pin release version (default: latest)
#   ./install.sh --source tarball        # force tarball download (skip local mode)
#
set -eo pipefail

SKILLS_DIR="${HOME}/.claude/skills"
REF_DIR="${HOME}/.claude/reference"
TPL_DIR="${HOME}/.claude/templates"
INSTALL_ROOT="${HOME}/.claude/hk-skills"

REPO_OWNER="insideloan"
REPO_NAME="hkthon"
REPO_URL="https://github.com/${REPO_OWNER}/${REPO_NAME}"

# SCRIPT_DIR must default gracefully when piped from curl (BASH_SOURCE[0] is empty)
# Use ${BASH_SOURCE[0]+set} check to avoid "unbound variable" under set -u.
SCRIPT_DIR=""
if [[ -n "${BASH_SOURCE+x}" ]] && [[ "${BASH_SOURCE[0]:-}" != "" ]] \
   && [[ "${BASH_SOURCE[0]}" != "bash" ]] && [[ "${BASH_SOURCE[0]}" != "/dev/stdin" ]]; then
  SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
fi
if [[ -z "${SCRIPT_DIR}" ]]; then
  # Piped install — default to a placeholder, will be replaced after tarball download.
  SCRIPT_DIR="${TMPDIR:-/tmp}/hk-skills-piped-$$"
fi
SKILL_NAMES=(
  hk-vision
  hk-onboard
  hk-backlog
  hk-slice
  hk-implement
  hk-verify
  hk-demo
)

GREEN="\033[0;32m"
YELLOW="\033[1;33m"
RED="\033[0;31m"
RESET="\033[0m"

log()  { printf "${GREEN}[install]${RESET} %s\n" "$*"; }
warn() { printf "${YELLOW}[warn]${RESET} %s\n" "$*"; }
err()  { printf "${RED}[err]${RESET} %s\n" "$*" >&2; }

# -------- arg parsing --------
ACTION="install"
SETUP_PROJECT_ARGS=()
VERSION="latest"
FORCE_TARBALL=0
# Use a manual loop so we can safely shift inside the iteration.
ARGS=("$@")
i=0
while [[ $i -lt ${#ARGS[@]} ]]; do
  arg="${ARGS[$i]}"
  case "$arg" in
    --install)  ACTION="install" ;;
    --uninstall) ACTION="uninstall" ;;
    --verify)    ACTION="verify" ;;
    --verify-modules) ACTION="verify-modules" ;;
    --setup-project) ACTION="setup-project" ;;
    --source)   FORCE_TARBALL=1 ;;
    --version=*) VERSION="${arg#--version=}" ;;
    --version)
      i=$((i+1))
      VERSION="${ARGS[$i]:-latest}"
      ;;
    --module|--name)
      SETUP_PROJECT_ARGS+=("$arg")
      if [[ $((i+1)) -lt ${#ARGS[@]} ]]; then
        i=$((i+1))
        SETUP_PROJECT_ARGS+=("${ARGS[$i]}")
      fi
      ;;
    --module=*|--name=*)
      SETUP_PROJECT_ARGS+=("$arg")
      ;;
    -h|--help)
      cat <<EOF
Usage: $0 [action] [options]

Actions:
  (default)              Install skills (symlink + copy reference/templates)
  --install              Same as default
  --uninstall            Remove skill symlinks
  --verify               Check installation is intact
  --verify-modules       Check docs/MODULES.md yaml SSOT vs human tables (drift)
  --setup-project        Bootstrap a new hackathon project (delegates to setup-project.sh)
                         Pass through --module QUEUE|PHONE|CALL|SUMMARY|ORCH|INFRA
                         Pass through --name <project-name>

Options:
  --version v1.0.0       Pin release version (default: latest)
  --source tarball       Force download from GitHub Releases (skip local mode)

Examples:
  # One-liner from GitHub
  curl -fsSL https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/main/hk-skills/install.sh | bash

  # Pin a specific version
  curl -fsSL ... | bash -s -- --version v1.0.0

  # From a git clone
  git clone ${REPO_URL}
  cd ${REPO_NAME}/hk-skills
  ./install.sh
EOF
      exit 0
      ;;
    *) err "unknown arg: $arg"; exit 2 ;;
  esac
  i=$((i+1))
done

# -------- mode detection: tarball (curl|bash) vs clone --------
#
# If the script is being piped from curl, BASH_SOURCE[0] is /dev/stdin or empty
# and SCRIPT_DIR points to /tmp or similar. In that case, download the tarball
# to ~/.claude/hk-skills/ and re-source the install logic from there.
#
is_piped_install() {
  # Heuristic: skills/ not adjacent to this script.
  if [[ ! -d "${SCRIPT_DIR}/skills" ]]; then
    return 0
  fi
  if [[ "${FORCE_TARBALL}" == "1" ]]; then
    return 0
  fi
  return 1
}

# Resolve a downloadable tarball URL for the requested version.
# Uses the GitHub redirect that always points to latest, or the pinned tag asset.
resolve_tarball_url() {
  local ver="$1"
  if [[ "$ver" == "latest" ]]; then
    echo "${REPO_URL}/releases/latest/download/hk-skills-latest.tar.gz"
  else
    echo "${REPO_URL}/releases/download/${ver}/hk-skills-${ver}.tar.gz"
  fi
}

# Download + extract tarball to ~/.claude/hk-skills/<version>
download_and_extract() {
  local ver="$1"
  local url
  url="$(resolve_tarball_url "$ver")"
  local target="${INSTALL_ROOT}/${ver}"
  local tmpdir
  tmpdir="$(mktemp -d)"
  local tarball="${tmpdir}/hk-skills.tar.gz"

  log "Downloading ${url}"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --retry 3 -o "${tarball}" "${url}"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "${tarball}" "${url}"
  else
    err "neither curl nor wget found — cannot download tarball"
    return 1
  fi

  if [[ ! -s "${tarball}" ]]; then
    err "downloaded tarball is empty (check that release ${ver} exists at ${url})"
    return 1
  fi

  mkdir -p "${INSTALL_ROOT}"
  tar xzf "${tarball}" -C "${tmpdir}"
  rm -rf "${target}"

  # Detect layout: either the tarball wraps everything in a single top-level
  # directory (old layout), or files are at the root of the tarball (current).
  # Heuristic: if install.sh is at the root of the tarball, it's flat layout.
  local has_install_sh_at_root=0
  if [[ -f "${tmpdir}/install.sh" ]]; then
    has_install_sh_at_root=1
  fi
  if [[ "${has_install_sh_at_root}" -eq 1 ]]; then
    # Flat layout: move tmpdir contents directly to target
    mv "${tmpdir}" "${target}"
    tmpdir=""
  else
    # Wrapped layout: move the single top dir
    local extracted
    extracted="$(find "${tmpdir}" -mindepth 1 -maxdepth 1 -type d | head -n1)"
    if [[ -z "${extracted}" ]]; then
      err "could not find extracted directory in tarball"
      return 1
    fi
    mv "${extracted}" "${target}"
  fi
  rm -rf "${tmpdir}"

  log "Extracted to ${target}"
  SCRIPT_DIR="${target}"
}

# -------- preflight --------
preflight() {
  if [[ ! -d "${SCRIPT_DIR}/skills" ]]; then
    err "skills/ not found at ${SCRIPT_DIR}/skills — run from repo root or via curl one-liner."
    exit 1
  fi
  command -v claude >/dev/null 2>&1 || warn "claude CLI not on PATH (skills still install, but you need Claude Code to use them)."
}

# When piped from curl, fetch tarball first; otherwise use the local SCRIPT_DIR.
if is_piped_install; then
  log "Detected curl|bash install — fetching release tarball (version: ${VERSION})"
  download_and_extract "${VERSION}"
fi

preflight

# -------- install --------
do_install() {
  log "Creating ${SKILLS_DIR}"
  mkdir -p "${SKILLS_DIR}"

  for s in "${SKILL_NAMES[@]}"; do
    if [[ ! -d "${SCRIPT_DIR}/skills/${s}" ]]; then
      err "missing skills/${s} — repo is incomplete"
      exit 1
    fi
    # Remove existing entry (symlink or real) before re-linking
    if [[ -e "${SKILLS_DIR}/${s}" || -L "${SKILLS_DIR}/${s}" ]]; then
      rm -rf "${SKILLS_DIR}/${s}"
    fi
    ln -s "${SCRIPT_DIR}/skills/${s}" "${SKILLS_DIR}/${s}"
    log "linked ${s}"
  done

  log "Copying reference/ to ${REF_DIR}"
  mkdir -p "${REF_DIR}"
  cp -rn "${SCRIPT_DIR}/reference/." "${REF_DIR}/" 2>/dev/null || true

  log "Copying templates/ to ${TPL_DIR}"
  mkdir -p "${TPL_DIR}"
  cp -rn "${SCRIPT_DIR}/templates/." "${TPL_DIR}/" 2>/dev/null || true

  log "Done. Open Claude Code and ask: '어떤 hk 스킬이 있어?'"
}

# -------- uninstall --------
do_uninstall() {
  log "Removing skill symlinks"
  for s in "${SKILL_NAMES[@]}"; do
    if [[ -L "${SKILLS_DIR}/${s}" ]]; then
      rm "${SKILLS_DIR}/${s}"
      log "removed ${s}"
    fi
  done
  warn "reference/ and templates/ left intact. Remove manually with: rm -rf ${REF_DIR}/ARCHITECTURE.md ${REF_DIR}/STACK.md ${REF_DIR}/CONVENTIONS.md ${REF_DIR}/PRODUCT-BRIEF.md ${REF_DIR}/API.md ${REF_DIR}/openapi.yaml ${TPL_DIR}/slice-spec.md ${TPL_DIR}/verify-checklist.md"
}

# -------- verify --------
do_verify() {
  local ok=0
  for s in "${SKILL_NAMES[@]}"; do
    if [[ -L "${SKILLS_DIR}/${s}" && -e "${SKILLS_DIR}/${s}/SKILL.md" ]]; then
      log "OK   ${s}"
    else
      err  "FAIL ${s} (not a symlink, or SKILL.md missing)"
      ok=1
    fi
  done
  for f in ARCHITECTURE.md STACK.md CONVENTIONS.md PRODUCT-BRIEF.md API.md openapi.yaml; do
    if [[ -f "${REF_DIR}/${f}" ]]; then
      log "OK   reference/${f}"
    else
      err  "FAIL reference/${f} missing at ${REF_DIR}/${f}"
      ok=1
    fi
  done
  for f in slice-spec.md verify-checklist.md; do
    if [[ -f "${TPL_DIR}/${f}" ]]; then
      log "OK   templates/${f}"
    else
      err  "FAIL templates/${f} missing at ${TPL_DIR}/${f}"
      ok=1
    fi
  done
  exit $ok
}

# -------- verify-modules (drift between yaml SSOT and human tables) --------
do_verify_modules() {
  # First, check the source MODULES.md in hk-skills repo
  local modules_md="${SCRIPT_DIR}/MODULES.md"
  if [[ ! -f "$modules_md" ]]; then
    err "MODULES.md not found at $modules_md"
    exit 1
  fi
  if ! command -v python3 >/dev/null 2>&1; then
    err "python3 not found (needed for MODULES.md lint)"
    exit 1
  fi
  log "Linting $modules_md"
  if ! python3 "${SCRIPT_DIR}/scripts/lint-modules.py" --modules-md "$modules_md"; then
    err "drift detected. See MODULES.md §6.1."
    exit 1
  fi
  log "✅ MODULES.md yaml SSOT and human tables are in sync"
  exit 0
}

case "$ACTION" in
  install)         do_install ;;
  uninstall)       do_uninstall ;;
  verify)          do_verify ;;
  verify-modules)  do_verify_modules ;;
  setup-project)
    if [[ ! -x "${SCRIPT_DIR}/setup-project.sh" ]]; then
      err "setup-project.sh not found or not executable at ${SCRIPT_DIR}/setup-project.sh"
      exit 1
    fi
    log "Delegating to setup-project.sh with args: ${SETUP_PROJECT_ARGS[*]:-<none>}"
    exec "${SCRIPT_DIR}/setup-project.sh" "${SETUP_PROJECT_ARGS[@]}"
    ;;
esac
