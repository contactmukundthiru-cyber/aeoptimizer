#!/usr/bin/env node

/**
 * Pulse Installer - Build Script
 *
 * Builds standalone installers for Windows and macOS using pkg.
 *
 * Usage:
 *   node build.js           # Build all platforms
 *   node build.js --win     # Windows only
 *   node build.js --mac     # macOS only
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const buildWin = args.length === 0 || args.includes('--win');
const buildMac = args.length === 0 || args.includes('--mac');

const projectRoot = path.resolve(__dirname, '..');
const installerDir = __dirname;
const distDir = path.join(installerDir, 'dist');
const bundledDir = path.join(installerDir, 'bundled');

console.log('╔══════════════════════════════════════╗');
console.log('║   Pulse Installer - Build Script     ║');
console.log('╚══════════════════════════════════════╝');
console.log('');

// Step 1: Install dependencies
console.log('[1/5] Installing dependencies...');
try {
    execSync('npm install', { cwd: installerDir, stdio: 'inherit' });
} catch (error) {
    console.error('Failed to install dependencies');
    process.exit(1);
}

// Step 2: Create bundled directory with the extension and worker
console.log('[2/5] Bundling application files...');
if (fs.existsSync(bundledDir)) {
    fs.rmSync(bundledDir, { recursive: true, force: true });
}
fs.mkdirSync(bundledDir, { recursive: true });

// Copy cep-extension
const cepSrc = path.join(projectRoot, 'cep-extension');
const cepDest = path.join(bundledDir, 'cep-extension');
copyDir(cepSrc, cepDest);
console.log('  - CEP extension bundled');

// Copy worker (without node_modules)
const workerSrc = path.join(projectRoot, 'worker');
const workerDest = path.join(bundledDir, 'worker');
copyDir(workerSrc, workerDest, ['node_modules']);
console.log('  - Worker bundled');

// Step 3: Create dist directory
console.log('[3/5] Creating distribution directory...');
if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
}

// Step 4: Build executables with pkg
console.log('[4/5] Building executables...');

const pkgPath = path.join(installerDir, 'node_modules', '.bin', 'pkg');
const entryPoint = path.join(installerDir, 'src', 'installer.js');

if (buildWin) {
    console.log('  Building Windows x64...');
    try {
        execSync(`"${pkgPath}" "${entryPoint}" --target node18-win-x64 --output "${path.join(distDir, 'PulseInstaller-Windows.exe')}"`, {
            cwd: installerDir,
            stdio: 'inherit'
        });
        console.log('  ✓ Windows build complete');
    } catch (error) {
        console.error('  ✗ Windows build failed');
    }
}

if (buildMac) {
    console.log('  Building macOS x64...');
    try {
        execSync(`"${pkgPath}" "${entryPoint}" --target node18-macos-x64 --output "${path.join(distDir, 'PulseInstaller-macOS')}"`, {
            cwd: installerDir,
            stdio: 'inherit'
        });
        console.log('  ✓ macOS x64 build complete');
    } catch (error) {
        console.error('  ✗ macOS x64 build failed');
    }

    console.log('  Building macOS ARM64...');
    try {
        execSync(`"${pkgPath}" "${entryPoint}" --target node18-macos-arm64 --output "${path.join(distDir, 'PulseInstaller-macOS-ARM64')}"`, {
            cwd: installerDir,
            stdio: 'inherit'
        });
        console.log('  ✓ macOS ARM64 build complete');
    } catch (error) {
        console.error('  ✗ macOS ARM64 build failed');
    }
}

// Step 5: Create release zip files
console.log('[5/5] Creating release packages...');

// Create a source release (for GitHub)
const releaseDir = path.join(distDir, 'release');
if (fs.existsSync(releaseDir)) {
    fs.rmSync(releaseDir, { recursive: true, force: true });
}
fs.mkdirSync(releaseDir, { recursive: true });

// Copy essential files
copyDir(path.join(projectRoot, 'cep-extension'), path.join(releaseDir, 'cep-extension'));
copyDir(path.join(projectRoot, 'worker'), path.join(releaseDir, 'worker'), ['node_modules']);
copyDir(path.join(projectRoot, 'scripts'), path.join(releaseDir, 'scripts'));
fs.copyFileSync(path.join(projectRoot, 'README.md'), path.join(releaseDir, 'README.md'));
fs.copyFileSync(path.join(projectRoot, 'LICENSE'), path.join(releaseDir, 'LICENSE'));

console.log('');
console.log('Build complete!');
console.log('');
console.log('Output files:');
fs.readdirSync(distDir).forEach(file => {
    if (file !== 'release' && file !== 'bundled') {
        const filePath = path.join(distDir, file);
        const stats = fs.statSync(filePath);
        const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
        console.log(`  ${file} (${sizeMB} MB)`);
    }
});
console.log('');

// Helper: Copy directory recursively
function copyDir(src, dest, exclude = []) {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
        if (exclude.includes(entry.name)) continue;

        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            copyDir(srcPath, destPath, exclude);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}
