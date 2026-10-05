#!/usr/bin/env bash
# Runs one eval: optional setup, a headless Claude run, then the eval's check.
# Usage: evals/check.sh evals/<name>.json
# Exit 0 = pass. The working tree is reset afterwards so evals stay independent.
set -uo pipefail

# Setup may overwrite .env and the reset discards uncommitted work, so this
# only ever runs on a throwaway CI checkout.
if [ "${CI:-}" != "true" ]; then
  echo "evals/check.sh runs only in CI (CI=true): it overwrites .env and resets the tree." >&2
  exit 1
fi

eval_file="$1"
name=$(jq -r '.name' "$eval_file")
setup=$(jq -r '.setup // empty' "$eval_file")
export RESULT
RESULT=$(mktemp)

if [ -n "$setup" ]; then
  bash -c "$setup"
fi

claude -p "$(jq -r '.prompt' "$eval_file")" \
  --allowedTools "$(jq -r '.allowedTools' "$eval_file")" \
  --output-format json \
  | jq -r '.result // ""' > "$RESULT"

if bash -c "$(jq -r '.check' "$eval_file")"; then
  status=0
  echo "PASS $name"
else
  status=1
  echo "FAIL $name"
  echo "--- answer ---"
  head -c 2000 "$RESULT"
  echo
fi

git checkout -q -- .
git clean -fdq
rm -f "$RESULT"
exit "$status"
