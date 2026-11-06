#!/usr/bin/env bash
# Fix fan control permissions for NZXT CAM v1
# Run with: sudo ./fix-fan-permissions.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ "$EUID" -ne 0 ]; then
  echo "✗ This script must be run with sudo"
  echo "  sudo ./fix-fan-permissions.sh"
  exit 1
fi

getent group plugdev >/dev/null || groupadd -r plugdev

echo "→ Installing the udev rule..."
cp "$SCRIPT_DIR/src-tauri/resources/99-nzxt-kraken.rules" /etc/udev/rules.d/
echo "✓ /etc/udev/rules.d/99-nzxt-kraken.rules"

echo "→ Reloading udev rules..."
udevadm control --reload-rules
udevadm trigger --subsystem-match=hwmon
echo "✓ udev reloaded"

echo "→ Applying permissions now (no reboot needed)..."
fixed=0
for h in /sys/class/hwmon/hwmon*; do
  name=$(cat "$h/name" 2>/dev/null || echo "")
  case "$name" in
    amdgpu|it87|nct6775|nct6776|nct6779)
      for f in "$h"/pwm[0-9] "$h"/pwm[0-9]_enable "$h"/fan[0-9]_target; do
        if [ -f "$f" ]; then
          chgrp plugdev "$f"
          chmod g+w "$f"
          fixed=$((fixed + 1))
        fi
      done
      echo "  ✓ $name ($h)"
      ;;
  esac
done

echo ""
echo "✓ $fixed PWM files are now writable by the plugdev group"
echo "  Add yourself to it if needed: sudo usermod -aG plugdev \$USER (then log out and back in)"
echo ""
echo "Check:"
ls -l /sys/class/hwmon/hwmon*/pwm1 2>/dev/null | sed 's|^|  |' || true
echo ""
echo "Restart nzxtcam-v1 to test fan control."
