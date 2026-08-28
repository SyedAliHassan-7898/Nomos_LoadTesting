#!/usr/bin/env bash
# Long steady duration to catch memory/connection leaks or slow degradation.
# Pass a real duration, e.g.: ./scripts/run-soak.sh -e DURATION=2h
set -euo pipefail
cd "$(dirname "$0")/.."
k6 run -e PROFILE=soak -e DURATION="${DURATION:-30m}" --summary-export=summary-soak.json "$@" main.js
