#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

violations=0

search_has_match() {
  local pattern="$1"
  local target="$2"
  if command -v rg >/dev/null 2>&1; then
    rg -q -e "$pattern" "$target"
    return
  fi
  grep -E -q "$pattern" "$target"
}

search_lines() {
  local pattern="$1"
  local target="$2"
  if command -v rg >/dev/null 2>&1; then
    rg -n -e "$pattern" "$target"
    return
  fi
  grep -E -n "$pattern" "$target"
}

yaml_targets=()
while IFS= read -r line; do
  yaml_targets+=("$line")
done < <(
  find .github/workflows .github/actions -type f \( -name '*.yml' -o -name '*.yaml' \) | sort
)

if [[ "${#yaml_targets[@]}" -eq 0 ]]; then
  echo "no yaml files found under .github/workflows or .github/actions"
  exit 1
fi

for target in "${yaml_targets[@]}"; do
  if search_has_match 'uses:[[:space:]]*pnpm/action-setup@' "$target"; then
    while IFS= read -r line; do
      line_no="${line%%:*}"
      echo "${target}:${line_no}: pnpm/action-setup is forbidden; use corepack + packageManager"
    done < <(search_lines 'uses:[[:space:]]*pnpm/action-setup@' "$target")
    violations=$((violations + 1))
  fi

  has_corepack_prepare=0
  if search_has_match 'corepack prepare ' "$target"; then
    has_corepack_prepare=1
  fi

  has_package_manager_ref=0
  if search_has_match 'packageManager' "$target"; then
    has_package_manager_ref=1
  fi

  if search_has_match 'uses:[[:space:]]*actions/setup-node@' "$target"; then
    if [[ "$has_corepack_prepare" -ne 1 || "$has_package_manager_ref" -ne 1 ]]; then
      echo "${target}: actions/setup-node usage must pair corepack prepare with packageManager pinning"
      violations=$((violations + 1))
    fi
  fi

  if [[ "$target" == ".github/actions/setup-node-pnpm/action.yml" ]]; then
    if [[ "$has_corepack_prepare" -ne 1 || "$has_package_manager_ref" -ne 1 ]]; then
      echo "${target}: setup-node-pnpm action must activate pnpm with corepack + packageManager"
      violations=$((violations + 1))
    fi
  fi
done

if [[ "$violations" -gt 0 ]]; then
  echo "workflow packageManager guard failed: ${violations} violation(s)"
  exit 1
fi

echo "workflow packageManager guard passed"
