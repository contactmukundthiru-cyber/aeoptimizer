#!/bin/bash

# Pulse for After Effects - Development Installation Script (macOS/Linux)
# This script sets up the development environment for Pulse

set -e

echo "========================================"
echo "Pulse for After Effects - Dev Setup"
echo "========================================"
echo ""

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"
CEP_DIR="$PROJECT_DIR/cep-extension"

echo "Project directory: $PROJECT_DIR"
echo ""

# Detect OS
OS="$(uname -s)"
case "$OS" in
    Darwin*)
        PLATFORM="macos"
        CEP_EXTENSIONS_DIR="$HOME/Library/Application Support/Adobe/CEP/extensions"
        ;;
    Linux*)
        PLATFORM="linux"
        CEP_EXTENSIONS_DIR="$HOME/.config/Adobe/CEP/extensions"
        ;;
    *)
        echo "Unsupported platform: $OS"
        exit 1
        ;;
esac

echo "Platform: $PLATFORM"
echo ""

# Step 1: Enable debug mode for CEP
echo "Step 1: Enabling CEP debug mode..."
if [ "$PLATFORM" = "macos" ]; then
    # Try multiple CSXS versions
    for version in 11 10 9 8; do
        defaults write com.adobe.CSXS.$version PlayerDebugMode 1 2>/dev/null || true
    done
    echo "  Debug mode enabled for CSXS versions 8-11"
else
    echo "  Note: On Linux, manually enable PlayerDebugMode if needed"
fi
echo ""

# Step 2: Create CEP extensions directory if needed
echo "Step 2: Setting up CEP extensions directory..."
mkdir -p "$CEP_EXTENSIONS_DIR"
echo "  CEP directory: $CEP_EXTENSIONS_DIR"
echo ""

# Step 3: Create symlink to extension
echo "Step 3: Creating symlink to extension..."
EXTENSION_LINK="$CEP_EXTENSIONS_DIR/com.pulse.aeoptimizer"

if [ -L "$EXTENSION_LINK" ]; then
    echo "  Removing existing symlink..."
    rm "$EXTENSION_LINK"
elif [ -d "$EXTENSION_LINK" ]; then
    echo "  Warning: Directory exists at $EXTENSION_LINK"
    echo "  Please remove it manually and re-run this script"
    exit 1
fi

ln -s "$CEP_DIR" "$EXTENSION_LINK"
echo "  Symlink created: $EXTENSION_LINK -> $CEP_DIR"
echo ""

# Step 4: Install worker dependencies
echo "Step 4: Installing worker dependencies..."
cd "$PROJECT_DIR/worker"
npm install
echo "  Dependencies installed"
echo ""

# Step 5: Create icons directory
echo "Step 5: Creating icons directory..."
mkdir -p "$CEP_DIR/icons"
# Create a simple placeholder icon if none exists
if [ ! -f "$CEP_DIR/icons/icon.png" ]; then
    echo "  Note: Add your icon.png to $CEP_DIR/icons/"
fi
echo ""

echo "========================================"
echo "Installation Complete!"
echo "========================================"
echo ""
echo "Next steps:"
echo "  1. Start the worker:  cd worker && npm start"
echo "  2. Restart After Effects"
echo "  3. Open Window > Extensions > Pulse"
echo ""
echo "If the extension doesn't appear:"
echo "  - Ensure After Effects is CC 2019 or later"
echo "  - Check that debug mode is enabled"
echo "  - Look for errors in the debug console"
echo ""
