#!/usr/bin/env bash
set -euo pipefail

# Publish portable Linux editions from a release build. The ACP artifact has a
# distinct filename so release uploaders can ship one executable by itself.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
VERSION="$(node -p "require('./apps/desktop/src-tauri/tauri.conf.json').version")"
MODE="${BUNDLE_MODE:-full}"
BIN="${BIN:-$ROOT/apps/desktop/src-tauri/target/release/nekowite}"
ENGINE="${ENGINE:-$ROOT/apps/desktop/src-tauri/target/release/opencode}"
OUT="$ROOT/release"

[ -x "$BIN" ] || { echo "FAIL: executable not found: $BIN" >&2; exit 1; }
mkdir -p "$OUT"

publish_binary() {
  local source="$1" target="$2" staged
  staged="$(mktemp "$OUT/.nekowite-publish.XXXXXX")"
  if ! cp -p "$source" "$staged"; then
    rm -f "$staged"
    return 1
  fi
  mv -f "$staged" "$target"
}

case "$MODE" in
  full)
    [ -x "$ENGINE" ] || { echo "FAIL: engine not found: $ENGINE" >&2; exit 1; }
    publish_binary "$BIN" "$OUT/nekowite_${VERSION}_x64"
    publish_binary "$ENGINE" "$OUT/opencode"
    echo "Published full edition: $OUT/nekowite_${VERSION}_x64"
    ;;
  lean)
    DEST="$OUT/nekowite-acp_${VERSION}_x64-standalone"
    publish_binary "$BIN" "$DEST"
    echo "Published ACP edition: $DEST"
    ;;
  *)
    echo "FAIL: BUNDLE_MODE must be full or lean, got: $MODE" >&2
    exit 2
    ;;
esac
