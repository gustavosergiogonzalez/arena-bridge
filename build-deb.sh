#!/usr/bin/env bash
# 🛠️ Compila dist/arena-bridge_<VER>_all.deb desde este repo
# Uso: ./build-deb.sh   (requiere dpkg-deb)
set -euo pipefail
cd "$(dirname "$0")"

VER="$(sed -n 's/^Version: //p' packaging/DEBIAN/control)"
STAGE="build/pkg"
mkdir -p "$STAGE/DEBIAN" "$STAGE/opt/arena-bridge" "$STAGE/usr/bin" \
         "$STAGE/usr/share/applications" "$STAGE/usr/share/icons/hicolor/512x512/apps" dist
rm -rf "$STAGE"; mkdir -p "$STAGE/DEBIAN" "$STAGE/opt/arena-bridge" "$STAGE/usr/bin" \
         "$STAGE/usr/share/applications" "$STAGE/usr/share/icons/hicolor/512x512/apps"

# Payload
cp server.js package.json vscode-register.js .env.example LICENSE README.md "$STAGE/opt/arena-bridge/"
cp backends.json.example "$STAGE/opt/arena-bridge/backends.json"   # plantilla base para --setup-backends
cp bin/arena-bridge "$STAGE/usr/bin/arena-bridge"
cp packaging/arena-bridge.desktop "$STAGE/usr/share/applications/"
cp icon.png "$STAGE/usr/share/icons/hicolor/512x512/apps/arena-bridge.png"
cp packaging/DEBIAN/control packaging/DEBIAN/postinst packaging/DEBIAN/prerm "$STAGE/DEBIAN/"

chmod 755 "$STAGE/usr/bin/arena-bridge" "$STAGE/DEBIAN/postinst" "$STAGE/DEBIAN/prerm"
chmod 644 "$STAGE/DEBIAN/control" "$STAGE/opt/arena-bridge"/* "$STAGE/usr/share/applications/arena-bridge.desktop" "$STAGE/usr/share/icons/hicolor/512x512/apps/arena-bridge.png"

dpkg-deb --root-owner-group --build "$STAGE" "dist/arena-bridge_${VER}_all.deb"
echo "✅ dist/arena-bridge_${VER}_all.deb  ($(du -h "dist/arena-bridge_${VER}_all.deb" | cut -f1))"
