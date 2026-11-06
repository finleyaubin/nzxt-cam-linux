# nzxt-cam-linux

LCD, RGB and cooling controller for the **NZXT Kraken Elite** (V2 and 2023) on Linux.
A native alternative to NZXT CAM (Windows only), built with Tauri 2 and Rust. No cloud account, no telemetry.

![LCD editor](docs/screenshots/lcd-editor.png)

## Features

### LCD display
- **Scene editor**: lay out the screen freely. Add rings, split rings, gauges, bars, history graphs, text and images, drag and resize them on a live preview, and arrange them with layers, alignment tools, copy/paste, undo/redo and "apply as I edit".
- **Text variables**: `{cpu}`, `{gpu}`, `{liquid}`, `{pump}`, `{sensorN}`, `{time}` and `{date}` update live. Add `:1` for decimals, e.g. `{cpu:1}`.
- **Templates and themes**: start from a built-in look (NZXT CAM style, 3 rings, single gauges, 2 bars, big number), recolour everything with a theme, and save your own layouts.
- **Backgrounds**: a solid colour, a photo or a GIF (dimmable, dithered for the panel), or search GIPHY from inside the app with your own API key.
- **Logos and images**: PNG, JPEG, WebP or SVG widgets, or pick the logos found on your system (distro, desktop, GPU/CPU vendor). Put your own in `~/.config/nzxtcam-archlinux-rust/logos`.
- **Rotation** in 0 / 90 / 180 / 270 degrees to match how the cooler is mounted.
- Gauges can show min/max labels and put the value in a pill cut into the ring, with alert colours past a threshold.

### Sensors
- CPU and GPU temperature (hwmon, `nvidia-smi` for NVIDIA), liquid temperature and pump speed read from the cooler.
- Bind extra sensors to the LCD: any hwmon reading (temperature, load, clocks, power, fans), NVIDIA GPU stats, RAM use.
- **Home Assistant**: enter your server URL and a long-lived access token, then pick any numeric entity (room temperature, power draw, ...) as an LCD sensor.

### Cooling and lighting
- Pump speed curve with Silent / Balanced / Performance / Turbo presets or a manual curve.
- Case and GPU fan control through hwmon (it87, nct6775/76/79, amdgpu).
- RGB ring and fan channel lighting: fixed, breathing, pulse, spectrum, rainbow flow, rainbow pulse, super rainbow and marquee, with speed and sync across channels.

### App
- Saveable profiles (LCD + ring), with Hyprland autostart support.
- Runs in the system tray, with a single-instance command line for scripting (see [Command line](#command-line)).
- Interface in English, French, Spanish, German and Brazilian Portuguese.

## Screenshots

| Monitoring | Cooling |
|---|---|
| ![Monitoring](docs/screenshots/monitoring.png) | ![Cooling](docs/screenshots/cooling.png) |

| Lighting | Templates |
|---|---|
| ![Lighting](docs/screenshots/lighting.png) | ![Templates](docs/screenshots/templates.png) |

| Sensor picker | Settings |
|---|---|
| ![Sensor picker](docs/screenshots/sensor-picker.png) | ![Settings](docs/screenshots/settings.png) |

## Installation

### Prerequisites

```bash
# Arch / Manjaro
sudo pacman -S --needed rust nodejs npm webkit2gtk-4.1 base-devel

# Debian / Ubuntu
sudo apt install -y cargo nodejs npm libwebkit2gtk-4.1-dev build-essential
```

### Install

```bash
git clone https://github.com/finleyaubin/nzxt-cam-linux.git
cd nzxt-cam-linux
./install.sh
```

The script compiles the binary (~1-2 min), installs the app to `~/.local/bin/`,
adds a desktop entry, and configures USB access without sudo.

Then launch from your app launcher by searching **nzxt-cam-linux**, or via:

```bash
nzxtcam-v1
```

### Prebuilt packages

Each [GitHub release](https://github.com/finleyaubin/nzxt-cam-linux/releases) ships a `.deb`, an `.rpm` and an AppImage. Install the udev rule for USB access without sudo:

```bash
sudo cp src-tauri/resources/99-nzxt-kraken.rules /etc/udev/rules.d/
sudo udevadm control --reload-rules && sudo udevadm trigger
```

### Arch (makepkg)

```bash
git clone https://github.com/finleyaubin/nzxt-cam-linux.git
cd nzxt-cam-linux/packaging/aur
makepkg -si
```

This installs the binary, desktop entry, icon and udev rule system-wide. An AUR package will follow.

### Uninstall

```bash
./uninstall.sh
```

## Configuration

Settings live in `~/.config/nzxtcam-archlinux-rust/config.json` (private to your user, mode 600). It is one JSON file holding the app settings, the current LCD layout (`displayConfig`), the rotation and the last-used image/GIF/colour. A `version` field is the schema version; older files without it are upgraded automatically. The file is written atomically, and if it cannot be parsed the app says where (file, line, column), keeps it as `config.json.bad` and starts with defaults.

Saved layouts are stored one per file in `layouts/<name>.json`, profiles in `profiles/<name>.json`, in the same folder. A layout can be loaded or exported from the command line with `--lcd-config <file.json>` and `--export-lcd-config <file.json>`; the file is a plain `displayConfig` object.

## Command line

A second `nzxtcam-v1` invocation forwards its options to the running instance, so the LCD can be scripted:

```bash
nzxtcam-v1 --lcd-image ~/Pictures/cat.png     # still image
nzxtcam-v1 --lcd-gif ~/Pictures/loop.gif      # animated GIF
nzxtcam-v1 --lcd-color '#00bcd4'              # solid colour
nzxtcam-v1 --lcd-temps                        # temperature display
nzxtcam-v1 --rotation 90                      # match the cooler mounting
nzxtcam-v1 --profile gaming                   # apply a saved profile
nzxtcam-v1 --hidden                           # start in the tray
```

Run `nzxtcam-v1 --help` for the full list.

## Supported devices

| Model | PID | Status |
|-------|-----|--------|
| NZXT Kraken Elite V2 (2024) | `0x3012` | Tested |
| NZXT Kraken Elite 280 | `0x3008` | Untested |
| NZXT Kraken Elite 360 | `0x3009` | Untested |
| NZXT Kraken Elite RGB 360 | `0x300e` | Untested |
| NZXT Kraken 2023 Elite | `0x300c` | Tested |

To request support for another model, open an issue or use the "Request support" button in Settings.

## Project structure

```
nzxt-cam-linux/
├── src/                       # React + TypeScript frontend
│   ├── App.tsx                # Root layout
│   ├── components/
│   │   ├── screens/           # Monitoring, Cooling, Lighting, LCD, Settings
│   │   └── display/           # Scene editor (canvas, inspector, templates, pickers)
│   ├── context/               # App state
│   ├── hooks/                 # Device, temperature and sensor-slot hooks
│   ├── i18n/                  # lang/*.json translations + LangContext
│   ├── lib/api.ts             # invoke() / listen() wrappers
│   └── shared/                # Shared types (DisplayConfig, presets)
├── src-tauri/                 # Rust backend
│   ├── tauri.conf.json
│   ├── resources/             # udev rules
│   └── src/
│       ├── main.rs / lib.rs   # Entry point, tray, single instance
│       ├── commands.rs        # #[tauri::command]s exposed to the frontend
│       ├── cli.rs             # Command-line options
│       ├── config.rs          # Versioned settings file
│       ├── storage.rs         # Atomic, private file writes
│       ├── layouts.rs         # Saved LCD layouts
│       ├── profile.rs         # Saved profiles
│       ├── fans.rs            # hwmon fan control
│       ├── logos.rs           # System logo discovery
│       ├── image_io.rs        # Image and GIF decode/resize
│       ├── types.rs           # Shared types (serde camelCase)
│       ├── usb/               # Kraken driver (nusb) and protocol constants
│       ├── render/            # tiny-skia scene renderer, fonts, SVG
│       └── sensors/           # cpu, gpu, hwmon/nvidia/system, Home Assistant, history
├── packaging/                 # AUR PKGBUILD and desktop entry
├── Changelogs/                # Per-version release notes
├── install.sh / uninstall.sh
└── docs/screenshots/
```

## Technical details

### USB protocol

The Kraken Elite firmware expects a very specific sequence:

1. FW query (interrupt OUT) → ACK FW version (interrupt IN)
2. Init `[0x36, 0x03]` → ACK `[0x37, 0x03]`
3. Switch to liquid mode (releases active bucket)
4. Delete bucket loop until code=1
5. Setup bucket with dimensions
6. Start transfer
7. **Bulk write header** (12 bytes MAGIC + 8 bytes bulk_info)
8. **Bulk write image data** — *separate* from step 7 (otherwise silent corruption)
9. End transfer
10. Switch to activated bucket

### Why nusb instead of rusb?

- **Zero system dependency** (rusb requires libusb installed)
- Native async (Tokio integration)
- Direct Linux backend (ioctls on `/dev/bus/usb`)
- Same udev permissions as libusb

### LCD rendering

`tiny-skia` rasterizes the scene to a 640x640 RGBA buffer: rings, gauges, bars and graphs are drawn as paths, SVG logos go through `resvg`, and text is composited with `ab_glyph`. Inter is embedded in the binary; other installed fonts can be picked in the editor. Alpha is forced to `0x00` in the final buffer (firmware requirement).

### Anti-flicker diff-skip

On every tick a *visual key* is computed from the values the scene actually draws (formatted at the configured precision), plus the config version. If it has not changed, nothing is rendered, pushed over USB or switched. Readings that are off-screen, such as pump RPM when no element shows it, never cause a redraw.

## Troubleshooting

**"No Kraken Elite found"**
→ Check that the udev rule is installed and the user is in the `plugdev` group. Test with `lsusb | grep 1e71`.

**Device not detected after app crash**
→ The USB kernel driver remained detached. Reattach it:
```bash
python3 -c "import usb.core; d=usb.core.find(idVendor=0x1e71,idProduct=0x3012); d.attach_kernel_driver(1)"
```

## Known limitations

| Limitation | Detail |
|---|---|
| **Single device** | No simultaneous multi-AIO support |
| **File drag-drop** | Replaced by a native dialog (Tauri webview blocks `file://` drag-drop) |
| **GIF preview** | The editor preview shows the first frame; GIFs animate on the cooler |
| **Untested models** | Elite 280, 360 and RGB 360 are in the device list but untested on hardware |

## License

MIT — free to use, modify and redistribute. See [LICENSE](LICENSE).

## Credits

- [liquidctl](https://github.com/liquidctl/liquidctl) — reverse engineering of the NZXT Kraken protocol
- [Tauri](https://tauri.app) — framework
- [tiny-skia](https://github.com/RazrFalcon/tiny-skia) — pure Rust 2D rasterizer
- [nusb](https://github.com/kevinmehall/nusb) — pure Rust async USB

---

Built by **Cypher** and **winepicfin** for the Linux community 🐧
