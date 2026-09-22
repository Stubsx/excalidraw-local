#!/bin/sh
# Local preview uses the same versioning and packaging path as signed releases.
set -eu
exec node "$(dirname "$0")/release.mjs" --preview "$@"
