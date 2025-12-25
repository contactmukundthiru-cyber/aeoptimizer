# Changelog

All notable changes to Pulse for After Effects will be documented in this file.

## [1.0.0] - 2024-12-25

### Added
- Initial release
- **Auto Draft Ladder**
  - Toggle draft settings during interaction
  - 3 aggressiveness levels (Light, Medium, Heavy)
  - Automatic restoration of original settings
  - Support for PULSE_HEAVY layer tagging

- **Render Tokens**
  - Create tokens from precomp layers
  - Background rendering via aerender
  - Swap in/out cached renders
  - Token hashing for cache invalidation
  - Mark tokens as dirty for re-rendering

- **Profiler**
  - Heuristic-based layer analysis
  - Identifies heavy layers and precomps
  - One-click token creation from profiler results

- **One-Click Installer**
  - Standalone executables for Windows and macOS
  - Automatic GitHub release downloads
  - Auto-updater support

### Technical
- CEP panel with dark theme UI
- Node.js worker with Express API
- ExtendScript automation with JSON polyfill
- Localhost-only communication for security
