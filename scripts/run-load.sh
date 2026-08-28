#!/usr/bin/env bash
# Steady realistic load. Override with -e VUS=20 -e DURATION=5m etc.
set -euo pipefail
cd "$(dirname "$0")/.."
k6 run -e PROFILE=load --summary-export=summary-load.json "$@" main.js
