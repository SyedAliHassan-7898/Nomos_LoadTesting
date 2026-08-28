#!/usr/bin/env bash
# Ramps well past normal load to find the breaking point.
set -euo pipefail
cd "$(dirname "$0")/.."
k6 run -e PROFILE=stress --summary-export=summary-stress.json "$@" main.js
