#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURE="$(mktemp -d "$ROOT/target/package-portable-test.XXXXXX")"
trap 'rm -rf "$FIXTURE"' EXIT

mkdir -p "$FIXTURE/scripts" "$FIXTURE/apps/desktop/src-tauri/target/release"
cp "$ROOT/scripts/package-portable.sh" "$FIXTURE/scripts/package-portable.sh"
printf '{"version":"1.2.3"}\n' > "$FIXTURE/apps/desktop/src-tauri/tauri.conf.json"
printf '#!/usr/bin/env bash\nexit 0\n' > "$FIXTURE/apps/desktop/src-tauri/target/release/nekowite"
chmod +x "$FIXTURE/apps/desktop/src-tauri/target/release/nekowite"

BUNDLE_MODE=lean "$FIXTURE/scripts/package-portable.sh"
ARTIFACT="$FIXTURE/release/nekowite-acp_1.2.3_x64-standalone"
test -f "$ARTIFACT" || { echo 'FAIL: ACP artifact is not a file' >&2; exit 1; }
test -x "$ARTIFACT" || { echo 'FAIL: ACP artifact is not executable' >&2; exit 1; }
test ! -d "$ARTIFACT" || { echo 'FAIL: ACP artifact is a directory' >&2; exit 1; }
test ! -e "$FIXTURE/release/opencode" || { echo 'FAIL: ACP artifact shipped OpenCode' >&2; exit 1; }
echo 'PASS: ACP portable edition is a standalone executable without OpenCode'
