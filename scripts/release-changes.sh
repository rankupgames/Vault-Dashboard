#!/usr/bin/env bash
# Scheduled and manual releases share the same successful no-change exit.
set -euo pipefail

LAST_TAG=$(gh release list --limit 1 --json tagName -q '.[0].tagName')
if [[ -z "$LAST_TAG" ]]; then
  echo 'skip=false' >> "$GITHUB_OUTPUT"
  echo '::notice::No previous release found. Release is needed.'
  exit 0
fi

# Resolve git errors before counting authors. An API or git failure must not become a skip.
AUTHORS=$(git log "${LAST_TAG}..HEAD" --format='%ae')
REAL_COMMITS=$(printf '%s\n' "$AUTHORS" | awk -v bot='github-actions[bot]@users.noreply.github.com' \
  'NF && $0 != bot { count++ } END { print count+0 }')
if [[ "$REAL_COMMITS" -eq 0 ]]; then
  echo 'skip=true' >> "$GITHUB_OUTPUT"
  echo "::notice::No non-bot changes since $LAST_TAG. Skipping release."
else
  echo 'skip=false' >> "$GITHUB_OUTPUT"
  echo "::notice::Found $REAL_COMMITS non-bot commit(s) since $LAST_TAG."
fi
