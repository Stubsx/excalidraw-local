#!/usr/bin/env bash
#
# build-dmg.sh — Rebuild Excalidraw Local as a macOS .app + .dmg, then restart
# the locally-running app so the new version is live immediately.
#
# Designed to be invoked by the .husky/post-commit hook (background, async,
# non-blocking) but can also be run manually:
#
#   ./local-app/scripts/build-dmg.sh
#
# What it does:
#   1. Derives a version from the git commit count: 0.1.<commit-count>.
#   2. Writes that version into Cargo.toml + tauri.conf.json (in place,
#      restored after the build so the working tree stays clean).
#   3. Runs `cargo tauri build` (release) → produces .app + .dmg.
#   4. Copies the .dmg into ./dist-release/<version>/ (git-ignored).
#   5. Kills the old "Excalidraw Local" process and opens the freshly built app.
#
# This is the fast iteration loop. For a proper tagged release (with sha256,
# commit of the version bump, etc.) use release.sh instead.
#
# Prerequisites: Rust toolchain, Tauri CLI 2.x, Node ≥ 18, Yarn deps installed.

set -euo pipefail

# --- paths (resolve relative to this script so it runs from anywhere) -------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"            # local-app/
REPO_DIR="$(cd "$APP_DIR/.." && pwd)"              # excalidraw-source/
STAGE_DIR="$APP_DIR/dist-release"

CARGO_TOML="$APP_DIR/src-tauri/Cargo.toml"
TAURI_CONF="$APP_DIR/src-tauri/tauri.conf.json"

# PID lockfile — post-commit hook reads this + kill -0 to dedup concurrent
# builds (rapid commits would otherwise stack multi-minute Tauri builds).
LOCKFILE="$STAGE_DIR/.build.lock"

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

# --- 1. version = 0.1.<commit-count> ----------------------------------------
# Whole-repo commit count (this repo embeds Excalidraw's upstream history, so
# the number is large, but it's monotonic and unique per commit).
COMMIT_COUNT="$(git -C "$REPO_DIR" rev-list --count HEAD)"
NEW_VERSION="0.1.${COMMIT_COUNT}"

log "Excalidraw Local — auto build"
log "  version: $NEW_VERSION  (commit $(git -C "$REPO_DIR" rev-parse --short HEAD))"

# Write version into both config files in place. Both files are git-tracked, so
# after the build we restore them (see trap below) to avoid leaving a permanent
# "uncommitted version bump" in the working tree.
write_version() {
  # Cargo.toml: replace only the first (top-level) `version = "..."` line.
  sed -i '' -E '0,/^version = ".*"/s//version = "'"$NEW_VERSION"'"/' "$CARGO_TOML"
  # tauri.conf.json: replace the "version" field via node (keeps formatting).
  node -e "
    const fs = require('fs');
    const p = process.argv[1];
    const c = JSON.parse(fs.readFileSync(p, 'utf8'));
    c.version = process.argv[2];
    fs.writeFileSync(p, JSON.stringify(c, null, 2) + '\n');
  " "$TAURI_CONF" "$NEW_VERSION"
}
# Snapshot the originals so we can restore them regardless of how we exit — the
# version stamp is a build-time concern, not a commit-time one.
ORIG_CARGO="$(cat "$CARGO_TOML")"
ORIG_TAURI="$(cat "$TAURI_CONF")"

# Acquire the dedup lockfile: write our PID so the post-commit hook can
# kill -0 it and skip overlapping builds.
mkdir -p "$STAGE_DIR"
echo "$$" > "$LOCKFILE"

cleanup() {
  printf '%s' "$ORIG_CARGO" > "$CARGO_TOML"
  printf '%s' "$ORIG_TAURI" > "$TAURI_CONF"
  rm -f "$LOCKFILE"
}
trap cleanup EXIT

write_version
ok "version set"

# --- 2. build ---------------------------------------------------------------
log "building (cargo tauri build — release; first run takes a few minutes)…"
cd "$APP_DIR"
# `cargo tauri build` runs `yarn build` (beforeBuildCommand) then the Rust
# release build, emitting .app + .dmg under src-tauri/target/release/bundle/.
cargo tauri build 2>&1 | sed 's/^/    /'
ok "build finished"

# --- 3. locate artifacts ----------------------------------------------------
# Note: file names contain spaces ("Excalidraw Local"), so quote everything.
BUNDLE_DIR="$APP_DIR/src-tauri/target/release/bundle"
APP_BUNDLE="$BUNDLE_DIR/macos/Excalidraw Local.app"
DMG_SOURCE="$(find "$BUNDLE_DIR/dmg" -name '*.dmg' -type f 2>/dev/null | head -1)"

[[ -d "$APP_BUNDLE" ]] || die "no .app found at \"$APP_BUNDLE\" — build failed?"
[[ -n "$DMG_SOURCE" ]] || warn "no .dmg found (the .app is still usable)"

if [[ -n "$DMG_SOURCE" ]]; then
  DMG_SIZE=$(du -h "$DMG_SOURCE" | cut -f1)
  ok "dmg: $DMG_SOURCE ($DMG_SIZE)"
fi
ok "app: $APP_BUNDLE"

# --- 4. stage dmg into dist-release/<version>/ (git-ignored) ----------------
if [[ -n "$DMG_SOURCE" ]]; then
  STAGE_VERSION_DIR="$STAGE_DIR/$NEW_VERSION"
  mkdir -p "$STAGE_VERSION_DIR"
  STAGED_DMG="$STAGE_VERSION_DIR/Excalidraw-Local-$NEW_VERSION.dmg"
  cp "$DMG_SOURCE" "$STAGED_DMG"
  ok "staged: $STAGED_DMG"
fi

# --- 5. replace running app: kill old, open new -----------------------------
# Match by exact app name. `pkill -f` matches the full command line, so quoting
# the name with the space targets our binary specifically without touching the
# dev server or unrelated node processes.
APP_NAME="Excalidraw Local"

log "restarting local app…"
# pkill returns non-zero if nothing matched — that's fine (app wasn't running).
pkill -f "$APP_NAME" 2>/dev/null || true
# give the old process a moment to release the window / port before reopening.
sleep 1

# Open the freshly built bundle directly from the build output (no copy to
# /Applications — this is the fast iteration path).
open "$APP_BUNDLE"
ok "launched: $APP_BUNDLE"

echo
echo "${BOLD}=== Build $NEW_VERSION done ===${RESET}"
echo "  commit:  $(git -C "$REPO_DIR" rev-parse --short HEAD)"
echo "  app:     $APP_BUNDLE"
[[ -n "${STAGED_DMG:-}" ]] && echo "  dmg:     $STAGED_DMG"
