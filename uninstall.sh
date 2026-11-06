#!/usr/bin/env bash
set -euo pipefail

APP="nzxtcam-v1"
GREEN='\033[0;32m'; NC='\033[0m'
ok() { echo -e "${GREEN}✓${NC} $1"; }

systemctl --user disable "$APP.service" 2>/dev/null || true
rm -f "$HOME/.config/systemd/user/$APP.service" "$HOME/.config/autostart/$APP.desktop"
rm -f "$HOME/.local/bin/$APP"
rm -f "$HOME/.local/share/applications/$APP.desktop"
rm -f "$HOME/.local/share/icons/hicolor/128x128/apps/$APP.png"
sudo rm -f /etc/udev/rules.d/99-nzxt-kraken.rules && sudo udevadm control --reload-rules
update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true

ok "$APP uninstalled"
echo "  Settings (~/.config/nzxtcam-archlinux-rust) and stored API keys (keyring service nzxtcam-archlinux-rust) were left in place."
