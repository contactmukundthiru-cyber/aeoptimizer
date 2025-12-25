# Pulse for After Effects

A CEP panel + Node.js worker that improves After Effects interactivity through:
- **Auto Draft Ladder**: Toggle draft settings during interaction, restore after idle
- **Render Tokens**: Precomp tokenization - render selected precomps via aerender into cache folder and swap them as footage layers, with ability to swap back

## One-Click Install (Recommended)

Download the installer for your platform from the [Releases page](../../releases):

| Platform | Download |
|----------|----------|
| Windows | `PulseInstaller-Windows.exe` |
| macOS (Intel) | `PulseInstaller-macOS` |
| macOS (Apple Silicon) | `PulseInstaller-macOS-ARM` |

Simply run the installer - it will:
1. Download the latest version automatically
2. Install the CEP extension
3. Set up the worker
4. Create a desktop shortcut to start the worker

## Quick Start (Developers)

If you prefer manual installation:

```bash
# 1. Clone or download this repository
cd aeoptimizer

# 2. Run the installer script
node scripts/install-beta.js

# 3. Start the worker (keep this terminal open)
cd worker && npm start

# 4. Restart After Effects and open Window > Extensions > Pulse
```

## Requirements

- Adobe After Effects CC 2019 or later
- Node.js 18 LTS or later (installer will check)
- aerender (included with After Effects)

## Manual Installation

### 1. Enable Unsigned Extensions (Development Mode)

**Windows:**
```
reg add HKCU\Software\Adobe\CSXS.11 /v PlayerDebugMode /t REG_SZ /d 1 /f
```
(Replace `CSXS.11` with your version: CC 2019=9, 2020=10, 2021+=11)

**macOS:**
```bash
defaults write com.adobe.CSXS.11 PlayerDebugMode 1
```

### 2. Install the CEP Extension

**Option A: Symlink (Recommended for Development)**

Windows:
```cmd
mklink /D "%APPDATA%\Adobe\CEP\extensions\com.pulse.aeoptimizer" "C:\path\to\aeoptimizer\cep-extension"
```

macOS:
```bash
ln -s /path/to/aeoptimizer/cep-extension ~/Library/Application\ Support/Adobe/CEP/extensions/com.pulse.aeoptimizer
```

**Option B: Copy**

Copy the `cep-extension` folder to:
- Windows: `%APPDATA%\Adobe\CEP\extensions\com.pulse.aeoptimizer`
- macOS: `~/Library/Application Support/Adobe/CEP/extensions/com.pulse.aeoptimizer`

### 3. Install and Run the Worker

```bash
cd worker
npm install
npm start
```

The worker will start on `http://localhost:3847` by default.

### 4. Configure aerender Path

The worker auto-detects aerender location. If auto-detection fails, set it manually:

**Windows (typical path):**
```
POST http://localhost:3847/config
{
  "aerenderPath": "C:\\Program Files\\Adobe\\Adobe After Effects 2024\\Support Files\\aerender.exe"
}
```

**macOS (typical path):**
```
POST http://localhost:3847/config
{
  "aerenderPath": "/Applications/Adobe After Effects 2024/aerender"
}
```

### 5. Launch After Effects

1. Open After Effects
2. Go to `Window > Extensions > Pulse`
3. The panel will connect to the worker automatically

## Usage Workflow

### Auto Draft Ladder

1. In the Pulse panel, click **Enable Draft Mode**
2. Choose aggressiveness level (1-3):
   - Level 1: Disable motion blur, frame blending
   - Level 2: + Set resolution to Half
   - Level 3: + Disable effects on layers tagged "PULSE_HEAVY"
3. Work on your composition - settings are applied during interaction
4. Click **Disable Draft Mode** to restore original settings

### Render Tokens (Precomp Caching)

1. Select a precomp layer in your timeline
2. Click **Create Token** in the Pulse panel
3. Click **Render** next to the token
4. Once rendered, click **Swap In** to replace the precomp with cached frames
5. Click **Swap Back** to restore the original precomp

### Profiler

The Profiler tab shows the top 10 "heaviest" layers/precomps based on heuristics:
- Effect count
- Expression complexity
- 3D layers
- Motion blur enabled

Click **Token** next to any item to create a render token for it.

## Configuration

### Worker Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `port` | 3847 | HTTP server port |
| `cacheDir` | `~/Pulse_Cache` | Render cache directory |
| `format` | `png` | Output format (png, exr, tiff) |
| `concurrency` | 1 | Max concurrent renders |

### Cache Directory Structure

```
<cacheDir>/
├── Pulse_Renders/
│   └── <tokenId>/
│       ├── frames_00001.png
│       ├── frames_00002.png
│       └── ...
└── pulse.log
```

## Troubleshooting

### Panel Not Appearing

1. Ensure PlayerDebugMode is enabled (restart AE after setting)
2. Verify the extension is in the correct CEP extensions folder
3. Check the manifest.xml version matches your AE version

### Worker Connection Failed

1. Ensure the worker is running (`npm start` in worker folder)
2. Check if port 3847 is available
3. Look for errors in the worker console

### Render Fails

1. Verify aerender path is correct
2. Check that the project is saved before rendering
3. Ensure the cache directory is writable
4. Check `pulse.log` in the cache directory for errors

### Token Hash Mismatch

If a precomp changes, the token hash becomes stale. Click **Mark Dirty** to force re-render.

## API Reference

### Worker Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Check worker status |
| POST | `/config` | Update configuration |
| GET | `/tokens` | List all tokens |
| POST | `/token/create` | Create new token |
| POST | `/token/render` | Queue token render |
| POST | `/token/swapin` | Swap in rendered footage |
| POST | `/token/swapback` | Restore original precomp |
| POST | `/token/dirty` | Mark token as dirty |

## License

MIT License - See LICENSE file for details.

## Support

For issues and feature requests, please open an issue on the repository.
