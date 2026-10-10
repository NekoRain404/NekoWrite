#!/usr/bin/env bash
set -euo pipefail

# Build either Linux distribution from the verified portable executable.
# `full` carries OpenCode; `lean` is the ACP-only edition and discovers the
# user's own agents from PATH.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
VERSION="$(node -p "require('./apps/desktop/src-tauri/tauri.conf.json').version")"
# Arch pkgver rejects SemVer pre-release hyphens; keep the application version
# intact and normalize only the package metadata version.
PKGVER="${VERSION//-/.}"
BIN="${BIN:-$ROOT/release/nekowite_${VERSION}_x64}"
ENGINE="${ENGINE:-$ROOT/release/opencode}"
OUT="$ROOT/release"
MODE="${BUNDLE_MODE:-full}"

case "$MODE" in
  full)
    PACKAGE_NAME="nekowite-full"
    PACKAGE_DESCRIPTION="NekoWite with the built-in OpenCode ACP engine"
    CONFLICTS="'nekowite'"
    PROVIDES="'nekowite'"
    ENGINE_SOURCE="'opencode' "
    ENGINE_SUM="'SKIP' "
    ENGINE_INSTALL='  install -Dm755 "$srcdir/opencode" "$pkgdir/usr/bin/opencode"'
    ;;
  lean)
    PACKAGE_NAME="nekowite"
    PACKAGE_DESCRIPTION="NekoWite ACP edition for user-installed agents"
    CONFLICTS="'nekowite-full'"
    PROVIDES="'nekowite'"
    ENGINE_SOURCE=""
    ENGINE_SUM=""
    ENGINE_INSTALL=""
    ;;
  *)
    echo "FAIL: BUNDLE_MODE must be full or lean, got: $MODE" >&2
    exit 2
    ;;
esac

[ -x "$BIN" ] || { echo "FAIL: executable not found: $BIN" >&2; exit 1; }
if [ "$MODE" = full ]; then
  [ -x "$ENGINE" ] || { echo "FAIL: engine not found: $ENGINE" >&2; exit 1; }
fi
command -v makepkg >/dev/null || { echo "FAIL: makepkg is required on Arch Linux" >&2; exit 1; }
command -v pacman >/dev/null || { echo "FAIL: pacman is required to verify the package" >&2; exit 1; }

WORK="$(mktemp -d "$ROOT/target/package-arch.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/src" "$WORK/pkgdest"
cp -p "$BIN" "$WORK/src/nekowite"
if [ "$MODE" = full ]; then
  cp -p "$ENGINE" "$WORK/src/opencode"
fi
cp -p "$ROOT/apps/desktop/src-tauri/icons/32x32.png" "$WORK/src/nekowite-32x32.png"
cp -p "$ROOT/apps/desktop/src-tauri/icons/128x128.png" "$WORK/src/nekowite-128x128.png"
cp -p "$ROOT/apps/desktop/src-tauri/icons/128x128@2x.png" "$WORK/src/nekowite-256x256.png"
cp -p "$ROOT/apps/desktop/src-tauri/icons/icon.png" "$WORK/src/nekowite-512x512.png"
cp -p "$ROOT/apps/desktop/src-tauri/THIRD-PARTY-NOTICES.txt" "$WORK/src/THIRD-PARTY-NOTICES.txt"

cat > "$WORK/src/nekowite.desktop" <<'EOF'
[Desktop Entry]
Categories=Utility;TextEditor;
Comment=A local-first knowledge base for Markdown and MDX
Exec=nekowite %F
Icon=nekowite
Name=NekoWite
Terminal=false
Type=Application
MimeType=text/markdown;
StartupWMClass=nekowite
EOF

cat > "$WORK/PKGBUILD" <<EOF
pkgname=$PACKAGE_NAME
pkgver=$PKGVER
pkgrel=1
pkgdesc='$PACKAGE_DESCRIPTION'
arch=('x86_64')
url='https://github.com/NekoRain404/NekoWrite'
license=('MIT')
depends=('gtk3' 'webkit2gtk-4.1')
conflicts=($CONFLICTS)
provides=($PROVIDES)
source=('nekowite' $ENGINE_SOURCE'nekowite.desktop' 'nekowite-32x32.png' 'nekowite-128x128.png' 'nekowite-256x256.png' 'nekowite-512x512.png' 'THIRD-PARTY-NOTICES.txt')
sha256sums=('SKIP' $ENGINE_SUM'SKIP' 'SKIP' 'SKIP' 'SKIP' 'SKIP' 'SKIP')
options=('!strip' '!debug')

package() {
  install -Dm755 "\$srcdir/nekowite" "\$pkgdir/usr/bin/nekowite"
$ENGINE_INSTALL
  install -Dm644 "\$srcdir/nekowite.desktop" "\$pkgdir/usr/share/applications/nekowite.desktop"
  install -Dm644 "\$srcdir/nekowite-32x32.png" "\$pkgdir/usr/share/icons/hicolor/32x32/apps/nekowite.png"
  install -Dm644 "\$srcdir/nekowite-128x128.png" "\$pkgdir/usr/share/icons/hicolor/128x128/apps/nekowite.png"
  install -Dm644 "\$srcdir/nekowite-256x256.png" "\$pkgdir/usr/share/icons/hicolor/256x256/apps/nekowite.png"
  install -Dm644 "\$srcdir/nekowite-512x512.png" "\$pkgdir/usr/share/icons/hicolor/512x512/apps/nekowite.png"
  install -Dm644 "\$srcdir/THIRD-PARTY-NOTICES.txt" "\$pkgdir/usr/share/licenses/nekowite/THIRD-PARTY-NOTICES.txt"
}
EOF

cp -p "$WORK/src/"* "$WORK/"
echo "[1/2] Building Arch package"
rm -f "$OUT/${PACKAGE_NAME}-${PKGVER}-1-x86_64.pkg.tar.zst" "$OUT/${PACKAGE_NAME}-debug-${PKGVER}-1-x86_64.pkg.tar.zst"
(cd "$WORK" && PKGDEST="$OUT" SRCDEST="$WORK/srcdest" BUILDDIR="$WORK/build" makepkg --clean --nodeps --force --noconfirm)

PACKAGE="$OUT/${PACKAGE_NAME}-${PKGVER}-1-x86_64.pkg.tar.zst"
[ -s "$PACKAGE" ] || { echo "FAIL: package was not produced: $PACKAGE" >&2; exit 1; }
echo "[2/2] Verifying package metadata"
pacman -Qp "$PACKAGE" >/dev/null
pacman -Qip "$PACKAGE" | sed -n '1,14p'
pacman -Qlp "$PACKAGE" | rg '/usr/bin/nekowite$' >/dev/null
if [ "$MODE" = full ]; then
  pacman -Qlp "$PACKAGE" | rg '/usr/bin/opencode$' >/dev/null
else
  ! pacman -Qlp "$PACKAGE" | rg '/usr/bin/opencode$' >/dev/null
fi
sha256sum "$PACKAGE"
echo "Published $PACKAGE"
