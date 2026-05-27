#!/usr/bin/env bash
set -euo pipefail

# Guard only NEW staged usages to avoid breaking existing legacy access patterns.
# Allow explicit opt-out with inline annotation: uiq-env-allow

allow_path_regex='(^|/)(tests?|__tests__|fixtures?|mocks?|dist|build|coverage|node_modules|\.runtime-cache|artifacts|\.codex)/|(^|/)alembic/|(^|/)scripts/|(^|/)configs?/env/|(^|/)env(\.|/)|(^|/)vite\.config\.ts$|(^|/)playwright\.config\.ts$'

files=()
while IFS= read -r file; do
  [[ -n "$file" ]] && files+=("$file")
done < <(git diff --cached --name-only --diff-filter=ACMR -- apps packages scripts)

if [[ "${#files[@]}" -eq 0 ]]; then
  echo "[check-no-direct-env-access] no staged source changes"
  exit 0
fi

violations=0
for file in "${files[@]}"; do
  [[ -f "$file" ]] || continue
  if [[ "$file" =~ $allow_path_regex ]]; then
    continue
  fi
  if [[ ! "$file" =~ \.(ts|tsx|js|mjs|cjs|py)$ ]]; then
    continue
  fi

  while IFS= read -r line; do
    [[ -n "$line" ]] || continue
    if [[ "$line" =~ uiq-env-allow ]]; then
      continue
    fi
    if [[ "$line" =~ process\.env\.|process\.env\[|os\.getenv\(|os\.environ\[ ]]; then
      echo "[check-no-direct-env-access] ${file}:${line}" >&2
      violations=1
    fi
  done < <(git diff --cached -U0 -- "$file" | grep -E '^\+[^+]' || true)
done

if [[ "$violations" -ne 0 ]]; then
  cat >&2 <<'EOF'
[check-no-direct-env-access] blocked: found new direct env access in staged changes.
Use centralized env modules/helpers or add inline justification comment: uiq-env-allow
EOF
  exit 1
fi

echo "[check-no-direct-env-access] ok"
