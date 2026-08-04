#!/usr/bin/env bash
#
# release.sh — Build Excalidraw Local as a macOS .dmg and stage the artifacts.
#
# Usage:
#   ./scripts/release.sh                 # bump patch version (0.1.0 → 0.1.1)
#   ./scripts/release.sh 1.0.0           # set an explicit version
#   ./scripts/release.sh --no-bump 1.0.0 # build current/explicit version without git tag
#
# What it does:
#   1. Sets the version in Cargo.toml + tauri.conf.json.
#   2. Runs `cargo tauri build` (release profile) → produces .dmg + .app.
#   3. Stages artifacts into ./dist-release/<version>/.
#   4. Generates sha256 checksums.
#   5. Prints the final artifact paths.
#
# Prerequisites: Rust toolchain, Tauri CLI 2.x, Node ≥ 18, Yarn deps installed.

set -euo pipefail

# Resolve paths relative to this script (so it can be run from anywhere).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"           # local-app/
REPO_DIR="$(cd "$APP_DIR/.." && pwd)"             # excalidraw-source/
STAGE_DIR="$APP_DIR/dist-release"

CARGO_TOML="$APP_DIR/src-tauri/Cargo.toml"
TAURI_CONF="$APP_DIR/src-tauri/tauri.conf.json"

# --- color helpers -----------------------------------------------------------
if [[ -t 1 ]]; then
  BOLD=$'\033[1m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; RESET=$'\033[0m'
else
  BOLD=""; GREEN=""; YELLOW=""; RED=""; RESET=""
fi
log()  { echo "${BOLD}▶${RESET} $*"; }
ok()   { echo "${GREEN}✓${RESET} $*"; }
warn() { echo "${YELLOW}!${RESET} $*" >&2; }
die()  { echo "${RED}✗${RESET} $*" >&2; exit 1; }

# --- arg parsing -------------------------------------------------------------
NO_BUMP=0
EXPLICIT_VERSION=""
if [[ $# -ge 1 ]]; then
  case "$1" in
    --no-bump) NO_BUMP=1; shift; [[ $# -ge 1 ]] && EXPLICIT_VERSION="$1" ;;
    -h|--help)
      sed -n '2,20p' "$0"; exit 0 ;;
    *) EXPLICIT_VERSION="$1" ;;
  esac
fi

# --- determine version -------------------------------------------------------
current_version() {
  node -e "console.log(require('$TAURI_CONF').version)"
}

bump_patch() {
  local v="$1"
  IFS='.' read -r major minor patch <<< "$v"
  patch=$((patch + 1))
  echo "${major}.${minor}.${patch}"
}

if [[ -n "$EXPLICIT_VERSION" ]]; then
  NEW_VERSION="$EXPLICIT_VERSION"
elif [[ $NO_BUMP -eq 1 ]]; then
  NEW_VERSION="$(current_version)"
else
  NEW_VERSION="$(bump_patch "$(current_version)")"
fi

# Validate semver-ish.
[[ "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] \
  || die "invalid version: $NEW_VERSION (expected x.y.z)"

CUR_VERSION="$(current_version)"
log "Excalidraw Local release"
log "  current: $CUR_VERSION"
log "  target:  $NEW_VERSION"

# --- 1. set version in both files -------------------------------------------
if [[ "$NEW_VERSION" != "$CUR_VERSION" ]]; then
  log "setting version $NEW_VERSION in Cargo.toml + tauri.conf.json"
  # Cargo.toml: replace the top-level version = "..." line only.
  sed -i '' -E '0,/^version = ".*"/s//version = "'"$NEW_VERSION"'"/' "$CARGO_TOML"
  # tauri.conf.json: replace the "version" field.
  node -e "
    const fs = require('fs');
    const p = '$TAURI_CONF';
    const c = JSON.parse(fs.readFileSync(p, 'utf8'));
    c.version = '$NEW_VERSION';
    fs.writeFileSync(p, JSON.stringify(c, null, 2) + '\n');
  "
  ok "version updated"
fi

# --- 2. build ----------------------------------------------------------------
log "building (cargo tauri build — release profile, this takes a few minutes)…"
cd "$APP_DIR"
# Build .app + .dmg for the host target (arm64 on Apple Silicon).
cargo tauri build 2>&1 | sed 's/^/    /'
ok "build finished"

# --- 3. locate artifacts -----------------------------------------------------
# Tauri outputs to src-tauri/target/release/bundle/{dmg,macos}/
BUNDLE_DIR="$APP_DIR/src-tauri/target/release/bundle"
DMG=$(find "$BUNDLE_DIR/dmg" -name '*.dmg' -type f 2>/dev/null | head -1)
APP=$(find "$BUNDLE_DIR/macos" -name '*.app' -type d 2>/dev/null | head -1)

[[ -n "$DMG" ]] || die "no .dmg found under $BUNDLE_DIR/dmg — build failed?"
[[ -n "$APP" ]] || warn "no .app found (dmg is still the primary artifact)"

DMG_SIZE=$(du -h "$DMG" | cut -f1)
ok "dmg: $DMG ($DMG_SIZE)"
[[ -n "$APP" ]] && ok "app: $APP"

# Sanity: a usable dmg should be at least a few MB.
DMG_BYTES=$(stat -f%z "$DMG" 2>/dev/null || stat -c%s "$DMG" 2>/dev/null)
[[ "$DMG_BYTES" -gt 5000000 ]] \
  || die "dmg is suspiciously small ($DMG_BYTES bytes) — build likely broken"

# --- 4. stage + checksums ----------------------------------------------------
STAGE_VERSION_DIR="$STAGE_DIR/$NEW_VERSION"
mkdir -p "$STAGE_VERSION_DIR"

STAGED_DMG="$STAGE_VERSION_DIR/Excalidraw-Local-$NEW_VERSION.dmg"
cp "$DMG" "$STAGED_DMG"
[[ -n "$APP" ]] && cp -R "$APP" "$STAGE_VERSION_DIR/"

# sha256
( cd "$STAGE_VERSION_DIR" && shasum -a 256 *.dmg > SHA256SUMS )
ok "staged to $STAGE_VERSION_DIR"

# --- 5. summary --------------------------------------------------------------
echo
echo "${BOLD}=== Release $NEW_VERSION ready ===${RESET}"
echo "  dmg:     $STAGED_DMG"
echo "  size:    $DMG_SIZE"
echo "  sha256:  $(awk '{print $1}' "$STAGE_VERSION_DIR/SHA256SUMS")"
echo "  dir:     $STAGE_VERSION_DIR"
echo
warn "Note: the .dmg is unsigned/ad-hoc. On first open, users must right-click → Open"
warn "      (or run:  xattr -dr com.apple.quarantine <dmg-or-app>)"
echo
log "to publish: commit the version bump, then tag:"
echo "    git add -A && git commit -m 'release: v$NEW_VERSION'"
echo "    git tag v$NEW_VERSION && git push origin local-app --tags"
