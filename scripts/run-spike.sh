#!/usr/bin/env bash
# Sudden burst of traffic (10x VUS) then back down.
set -euo pipefail
cd "$(dirname "$0")/.."
k6 run -e PROFILE=spike --summary-export=summary-spike.json "$@" main.js
