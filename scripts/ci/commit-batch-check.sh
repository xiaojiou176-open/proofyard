#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  bash scripts/ci/commit-batch-check.sh pre
  bash scripts/ci/commit-batch-check.sh post
EOF
}

print_pre_suggestions() {
  cat <<'EOF'
Suggestion:
- Keep this batch focused on one topic.
- Stage only files that belong to this topic.
- If scope grows, split into another commit batch.
EOF
}

run_pre() {
  echo "[pre] git status --short --branch"
  git status --short --branch
  echo

  local has_issue=0

  if git diff --name-only --diff-filter=U | grep -q '.'; then
    echo "[pre] ERROR: unresolved merge conflicts detected."
    git diff --name-only --diff-filter=U
    has_issue=1
  fi

  local unstaged_files=()
  while IFS= read -r file; do
    if [[ -n "$file" ]]; then
      unstaged_files+=("$file")
    fi
  done < <(git diff --name-only)
  local scan_files=()
  local file
  for file in "${unstaged_files[@]}"; do
    if [[ -f "$file" ]]; then
      scan_files+=("$file")
    fi
  done

  if ((${#scan_files[@]} > 0)); then
    local marker_output
    marker_output="$(mktemp)"
    if rg -n -H '^(<<<<<<<|=======|>>>>>>>)' -- "${scan_files[@]}" >"${marker_output}" 2>/dev/null; then
      echo "[pre] ERROR: unstaged conflict markers found in working tree files:"
      cat "${marker_output}"
      has_issue=1
    fi
    rm -f "${marker_output}"
  fi

  echo
  print_pre_suggestions

  if ((has_issue > 0)); then
    exit 1
  fi

  echo "[pre] OK: no unresolved/unstaged conflict markers detected."
}

run_post() {
  if ! git rev-parse --verify HEAD >/dev/null 2>&1; then
    echo "[post] ERROR: no commit found in current repository."
    exit 1
  fi

  echo "[post] latest commit summary"
  git log -1 --date=iso --pretty='format:%h %s%nAuthor: %an <%ae>%nDate: %ad'
  echo
  echo
  echo "[post] changed files in HEAD"
  git show --name-only --pretty='format:' HEAD | sed '/^$/d'
}

main() {
  local mode="${1:-}"
  case "${mode}" in
    pre) run_pre ;;
    post) run_post ;;
    *)
      usage
      exit 1
      ;;
  esac
}

main "${1:-}"
