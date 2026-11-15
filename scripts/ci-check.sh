#!/usr/bin/env bash
# Check and build the plugin release files once, locally or through Jenkins.
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
[[ $# == 0 ]] || { echo 'No arguments are accepted' >&2; exit 2; }
[[ -f package-lock.json ]] || { echo 'The committed npm lockfile is required' >&2; exit 2; }
[[ $(npm config get min-release-age) == 7 ]] || {
  echo 'The native seven-day dependency age gate is required' >&2; exit 2;
}

export CI=1
export PYTHONDONTWRITEBYTECODE=1
npm ci
python3 -m unittest discover -s tests -p 'test_*.py'
npm run lint
npm test
npm run build
