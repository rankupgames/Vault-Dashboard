#!/usr/bin/env bash
# Jenkins small-web check: lint, test and build the plugin release files once.
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
[[ $# == 0 ]] || { echo 'No arguments are accepted' >&2; exit 2; }
[[ $(uname -s) == Linux && $(uname -m) == x86_64 ]] || {
  echo 'This check requires the approved Linux x86_64 worker' >&2; exit 2;
}
[[ $(node --version) == v24.21.0 && $(npm --version) == 11.19.0 ]] || {
  echo 'CI requires the existing Node 24.21.0 and npm 11.19.0 toolchain' >&2; exit 2;
}
[[ -f package-lock.json ]] || { echo 'The committed npm lockfile is required' >&2; exit 2; }
[[ $(npm config get min-release-age) == 7 ]] || {
  echo 'The native seven-day dependency age gate is required' >&2; exit 2;
}

export CI=1
export PYTHONDONTWRITEBYTECODE=1
homelab-npm-ci
python3 -m unittest discover -s tests -p 'test_*.py'
npm run lint
npm test
npm run build
