#!/usr/bin/env bash
# Quick sanity check: 2 VUs, 1 iteration each. Run this first, always.
set -euo pipefail
cd "$(dirname "$0")/.."
k6 run -e PROFILE=smoke "$@" main.js
