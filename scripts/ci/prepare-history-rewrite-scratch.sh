#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

timestamp="${1:-$(date -u +%Y%m%dT%H%M%SZ)}"
scratch_root=".runtime-cache/history-rewrite/${timestamp}"
mirror_dir="${scratch_root}/mirror.git"
report_json="${scratch_root}/scratch-summary.json"
report_md="${scratch_root}/scratch-summary.md"

mkdir -p "$scratch_root"
rm -rf "$mirror_dir"
git clone --mirror . "$mirror_dir" >/dev/null

refs_file="${scratch_root}/refs.txt"
git --git-dir="$mirror_dir" for-each-ref --format='%(refname)' | sort >"$refs_file"

python3 - <<'PY' "$scratch_root" "$report_json" "$report_md"
import json
import sys
from pathlib import Path

scratch_root = Path(sys.argv[1])
report_json = Path(sys.argv[2])
report_md = Path(sys.argv[3])
refs = [line.strip() for line in (scratch_root / "refs.txt").read_text(encoding="utf-8").splitlines() if line.strip()]

heads = [ref for ref in refs if ref.startswith("refs/heads/")]
tags = [ref for ref in refs if ref.startswith("refs/tags/")]
remotes = [ref for ref in refs if ref.startswith("refs/remotes/")]
pull_like = [ref for ref in refs if ref.startswith("refs/pull/")]

payload = {
    "generatedAt": __import__("datetime").datetime.utcnow().isoformat() + "Z",
    "scratchRoot": scratch_root.as_posix(),
    "mirrorDir": (scratch_root / "mirror.git").as_posix(),
    "counts": {
        "heads": len(heads),
        "tags": len(tags),
        "remotes": len(remotes),
        "pullLike": len(pull_like),
        "total": len(refs),
    },
    "sampleRefs": {
        "heads": heads[:20],
        "tags": tags[:20],
        "remotes": remotes[:20],
        "pullLike": pull_like[:20],
    },
}

report_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
lines = [
    "# History Rewrite Scratch Mirror",
    "",
    f"- scratch_root: `{payload['scratchRoot']}`",
    f"- mirror_dir: `{payload['mirrorDir']}`",
    f"- total_refs: {payload['counts']['total']}",
    f"- heads: {payload['counts']['heads']}",
    f"- tags: {payload['counts']['tags']}",
    f"- remotes: {payload['counts']['remotes']}",
    f"- pull_like: {payload['counts']['pullLike']}",
    "",
    "## Pull-like refs",
    "",
]
if pull_like:
    lines.extend(f"- `{ref}`" for ref in pull_like[:20])
else:
    lines.append("- none")
lines.append("")
report_md.write_text("\n".join(lines) + "\n", encoding="utf-8")
PY

echo "[history-rewrite-scratch] ok scratch_root=${scratch_root} report_json=${report_json} report_md=${report_md}"
