#!/usr/bin/env bash
# Run Playwright E2E in Docker against a running stack. Usage: scripts/e2e.sh [baseUrl]
set -euo pipefail
cd "$(dirname "$0")/.."
BASE="${1:-http://localhost:3480}"
docker build -q -t openmanga-e2e:1 -f deploy/docker/e2e.Dockerfile deploy/docker >/dev/null
# Joining the stack's edge network is what makes http://nginx resolve; override for a differently named deployment.
NET=()
[[ -n "${E2E_NETWORK:-}" ]] && NET=(--network "$E2E_NETWORK")
[[ ${#NET[@]} -eq 0 && "$BASE" == http://nginx* ]] && NET=(--network openmanga_edge)
docker run --rm "${NET[@]}" -u "$(id -u):$(id -g)" -e HOME=/tmp -e E2E_BASE_URL="$BASE" ${E2E_EXTRA_ENV:-} -e E2E_OUTPUT_DIR=${E2E_OUTPUT_DIR:-/tmp/e2e-results} ${E2E_MOUNT:+-v $E2E_MOUNT} \
  -v "$PWD":/repo -w /repo openmanga-e2e:1 bunx playwright test -c tests/e2e/playwright.config.ts "${@:2}"
