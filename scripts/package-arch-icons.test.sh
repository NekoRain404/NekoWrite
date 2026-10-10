#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURE="$(mktemp -d "$ROOT/target/package-arch-icons-test.XXXXXX")"
trap 'rm -rf "$FIXTURE"' EXIT

mkdir -p "$FIXTURE/scripts" "$FIXTURE/apps/desktop/src-tauri/icons" "$FIXTURE/release" "$FIXTURE/mock" "$FIXTURE/target"
cp "$ROOT/scripts/package-arch.sh" "$FIXTURE/scripts/package-arch.sh"
cp "$ROOT/apps/desktop/src-tauri/icons/32x32.png" "$ROOT/apps/desktop/src-tauri/icons/128x128.png" \
  "$ROOT/apps/desktop/src-tauri/icons/128x128@2x.png" "$ROOT/apps/desktop/src-tauri/icons/icon.png" \
  "$FIXTURE/apps/desktop/src-tauri/icons/"
cp "$ROOT/apps/desktop/src-tauri/THIRD-PARTY-NOTICES.txt" "$FIXTURE/apps/desktop/src-tauri/"
printf '{"version":"1.2.3"}\n' > "$FIXTURE/apps/desktop/src-tauri/tauri.conf.json"
printf 'binary\n' > "$FIXTURE/release/nekowite_1.2.3_x64"
chmod +x "$FIXTURE/release/nekowite_1.2.3_x64"

cat > "$FIXTURE/mock/makepkg" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
source PKGBUILD
srcdir="$PWD"
pkgdir="$PKGDEST/staged"
mkdir -p "$pkgdir"
package
find "$pkgdir" -type f -printf '%P\n' > "$PKGDEST/package-files"
printf 'URL=%s\n' "$url" > "$PKGDEST/package-metadata"
printf 'package\n' > "$PKGDEST/$pkgname-$pkgver-$pkgrel-x86_64.pkg.tar.zst"
MOCK
cat > "$FIXTURE/mock/pacman" <<'MOCK'
#!/usr/bin/env bash
case "$1" in
  -Qp) exit 0 ;;
  -Qip) printf 'Name : test\nVersion : 1.2.3\n' ;;
  -Qlp)
    printf '%s\n' /usr/bin/nekowite /usr/share/icons/hicolor/32x32/apps/nekowite.png /usr/share/icons/hicolor/128x128/apps/nekowite.png /usr/share/icons/hicolor/256x256/apps/nekowite.png /usr/share/icons/hicolor/512x512/apps/nekowite.png
    ;;
  *) exit 2 ;;
esac
MOCK
chmod +x "$FIXTURE/mock/makepkg" "$FIXTURE/mock/pacman"

PATH="$FIXTURE/mock:$PATH" FIXTURE="$FIXTURE" BUNDLE_MODE=lean "$FIXTURE/scripts/package-arch.sh"
test -s "$FIXTURE/release/package-files" || { printf 'FAIL: mock package file list is empty\n' >&2; exit 1; }
for size in 32x32 128x128 256x256 512x512; do
  rg -q "usr/share/icons/hicolor/$size/apps/nekowite\.png$" "$FIXTURE/release/package-files" || {
    printf 'FAIL: Arch package omits %s icon\n' "$size" >&2
    exit 1
  }
done
rg -qx 'URL=https://github.com/NekoRain404/NekoWrite' "$FIXTURE/release/package-metadata" || {
  printf 'FAIL: Arch package metadata has the wrong repository URL\n' >&2
  exit 1
}
echo 'PASS: Arch package contains 32, 128, 256 and 512 pixel application icons'
