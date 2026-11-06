#!/usr/bin/env bash
set -euo pipefail

# nzxtcam-v1 install script (tested on Arch Linux / Hyprland)

APP="nzxtcam-v1"
BINARY_NAME="nzxtcam-archlinux-rust"
INSTALL_BIN="$HOME/.local/bin/$APP"
ICON_DIR="$HOME/.local/share/icons/hicolor/128x128/apps"
DESKTOP_DIR="$HOME/.local/share/applications"
DESKTOP_FILE="$DESKTOP_DIR/$APP.desktop"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC} $1"; }
info() { echo -e "${YELLOW}→${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; exit 1; }

echo ""
echo "  nzxtcam-v1 — NZXT Kraken LCD Controller"
echo "  ─────────────────────────────────────────"
echo ""

info "Checking dependencies..."
for dep in cargo npm node; do
  command -v "$dep" &>/dev/null || fail "Missing dependency: $dep\n  Install with: sudo pacman -S rust nodejs npm"
done
ok "Dependencies OK"

info "Installing Node packages..."
npm ci --silent

info "Building (can take 1-2 minutes)..."
npm run tauri build -- --no-bundle

BINARY="src-tauri/target/release/$BINARY_NAME"
[ -f "$BINARY" ] || fail "Build failed — binary not found"
ok "Build finished"

info "Installing the binary..."
mkdir -p "$HOME/.local/bin"
cp "$BINARY" "$INSTALL_BIN"
chmod +x "$INSTALL_BIN"
ok "Binary → $INSTALL_BIN"

info "Installing the icon..."
mkdir -p "$ICON_DIR"
cp "src-tauri/icons/128x128.png" "$ICON_DIR/$APP.png"
ok "Icon → $ICON_DIR/$APP.png"

info "Creating the desktop entry..."
mkdir -p "$DESKTOP_DIR"
cat > "$DESKTOP_FILE" << DESKTOP
[Desktop Entry]
Name=nzxtcam-v1
GenericName=LCD Controller
Comment=Control the LCD of NZXT Kraken Elite coolers
Exec="$INSTALL_BIN"
Icon=$APP
Terminal=false
Type=Application
Categories=Utility;System;
Keywords=nzxt;nzxtcam;kraken;lcd;cooling;
StartupWMClass=$BINARY_NAME
DESKTOP
ok "Desktop entry → $DESKTOP_FILE"

# The rules grant the active seat's user (uaccess) and the plugdev group access to the Kraken
# USB/hidraw devices and to GPU/motherboard fan PWM files. Read them before installing.
info "Installing udev rules (needs sudo): src-tauri/resources/99-nzxt-kraken.rules"
if sudo getent group plugdev >/dev/null || sudo groupadd -r plugdev; then
  sudo cp src-tauri/resources/99-nzxt-kraken.rules /etc/udev/rules.d/
  sudo udevadm control --reload-rules
  sudo udevadm trigger
  ok "udev rules installed"
else
  fail "Could not create the plugdev group"
fi

if ! id -nG "$USER" | grep -qw plugdev; then
  info "Adding $USER to the plugdev group (needed for fan control)..."
  sudo usermod -aG plugdev "$USER"
  ok "plugdev → log out and back in for it to take effect"
fi

update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true
gtk-update-icon-cache -f "$HOME/.local/share/icons/hicolor" 2>/dev/null || true

echo ""
echo -e "  ${GREEN}Installation complete!${NC}"
echo "  Launch from your app launcher: nzxtcam-v1"
echo "  Or from a terminal: $APP"
echo ""
