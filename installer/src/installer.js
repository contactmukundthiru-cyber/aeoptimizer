#!/usr/bin/env node

/**
 * Pulse for After Effects - Simple Installer
 * Just copies files and enables debug mode - no server needed
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const readline = require('readline');

const CONFIG = {
    extensionId: 'com.pulse.aeoptimizer',
    appName: 'Pulse for After Effects',
    version: '1.0.0'
};

// Colors
const c = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    dim: '\x1b[2m'
};

const log = (msg) => console.log(msg);
const ok = (msg) => console.log(`${c.green}✓ ${msg}${c.reset}`);
const err = (msg) => console.log(`${c.red}✗ ${msg}${c.reset}`);
const info = (msg) => console.log(`${c.cyan}→ ${msg}${c.reset}`);
const warn = (msg) => console.log(`${c.yellow}! ${msg}${c.reset}`);

function getPlatform() {
    const platform = os.platform();
    return {
        isWindows: platform === 'win32',
        isMac: platform === 'darwin'
    };
}

function getExtensionPath() {
    const { isWindows, isMac } = getPlatform();
    const home = os.homedir();

    if (isWindows) {
        return path.join(process.env.APPDATA, 'Adobe', 'CEP', 'extensions', CONFIG.extensionId);
    } else if (isMac) {
        return path.join(home, 'Library', 'Application Support', 'Adobe', 'CEP', 'extensions', CONFIG.extensionId);
    } else {
        return path.join(home, '.config', 'Adobe', 'CEP', 'extensions', CONFIG.extensionId);
    }
}

function getSourcePath() {
    // Check multiple locations for the source files
    const locations = [
        path.join(__dirname, '..', 'bundled', 'cep-extension'),
        path.join(__dirname, '..', '..', 'cep-extension'),
        path.join(process.cwd(), 'bundled', 'cep-extension'),
        path.join(process.cwd(), 'cep-extension'),
        path.join(path.dirname(process.execPath), 'bundled', 'cep-extension')
    ];

    for (const loc of locations) {
        if (fs.existsSync(loc)) {
            return loc;
        }
    }

    return null;
}

function copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });

    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            copyDir(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

function removeDir(dir) {
    if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

function enableDebugMode() {
    const { isWindows, isMac } = getPlatform();

    try {
        if (isMac) {
            for (const v of [8, 9, 10, 11, 12]) {
                try { execSync(`defaults write com.adobe.CSXS.${v} PlayerDebugMode 1`, { stdio: 'pipe' }); } catch (e) {}
            }
        } else if (isWindows) {
            for (const v of [8, 9, 10, 11, 12]) {
                try { execSync(`reg add "HKCU\\Software\\Adobe\\CSXS.${v}" /v PlayerDebugMode /t REG_SZ /d 1 /f`, { stdio: 'pipe' }); } catch (e) {}
            }
        }
        return true;
    } catch (e) {
        return false;
    }
}

function disableDebugMode() {
    const { isWindows, isMac } = getPlatform();

    try {
        if (isMac) {
            for (const v of [8, 9, 10, 11, 12]) {
                try { execSync(`defaults delete com.adobe.CSXS.${v} PlayerDebugMode`, { stdio: 'pipe' }); } catch (e) {}
            }
        } else if (isWindows) {
            for (const v of [8, 9, 10, 11, 12]) {
                try { execSync(`reg delete "HKCU\\Software\\Adobe\\CSXS.${v}" /v PlayerDebugMode /f`, { stdio: 'pipe' }); } catch (e) {}
            }
        }
    } catch (e) {}
}

function isInstalled() {
    return fs.existsSync(getExtensionPath());
}

function createRL() {
    return readline.createInterface({ input: process.stdin, output: process.stdout });
}

function ask(rl, q) {
    return new Promise(resolve => rl.question(q, resolve));
}

function showHeader() {
    console.clear();
    log(`${c.cyan}╔══════════════════════════════════════════════════╗${c.reset}`);
    log(`${c.cyan}║      Pulse for After Effects                     ║${c.reset}`);
    log(`${c.cyan}║      Installer v${CONFIG.version}                            ║${c.reset}`);
    log(`${c.cyan}╚══════════════════════════════════════════════════╝${c.reset}`);
    log('');
}

async function install() {
    const sourcePath = getSourcePath();
    const destPath = getExtensionPath();

    if (!sourcePath) {
        err('Extension files not found!');
        log(`${c.dim}Looking in: ${path.join(__dirname, '..', 'bundled', 'cep-extension')}${c.reset}`);
        return false;
    }

    info('Installing Pulse...');
    log(`${c.dim}From: ${sourcePath}${c.reset}`);
    log(`${c.dim}To: ${destPath}${c.reset}`);
    log('');

    // Enable debug mode
    info('Enabling CEP debug mode...');
    if (enableDebugMode()) {
        ok('Debug mode enabled');
    } else {
        warn('Could not enable debug mode automatically');
    }

    // Create parent directory
    const parentDir = path.dirname(destPath);
    if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
    }

    // Remove existing installation
    if (fs.existsSync(destPath)) {
        info('Removing old installation...');
        removeDir(destPath);
    }

    // Copy files
    info('Copying extension files...');
    try {
        copyDir(sourcePath, destPath);
        ok('Files copied');
    } catch (e) {
        err(`Failed to copy files: ${e.message}`);
        return false;
    }

    // Verify installation
    if (fs.existsSync(path.join(destPath, 'index.html'))) {
        ok('Installation verified');
    } else {
        err('Installation verification failed');
        return false;
    }

    log('');
    log(`${c.green}╔══════════════════════════════════════════════════╗${c.reset}`);
    log(`${c.green}║          Installation Complete!                  ║${c.reset}`);
    log(`${c.green}╚══════════════════════════════════════════════════╝${c.reset}`);
    log('');
    log(`${c.yellow}Next steps:${c.reset}`);
    log(`  1. Restart After Effects (completely close and reopen)`);
    log(`  2. Go to Window → Extensions → Pulse`);
    log('');

    return true;
}

async function uninstall(rl) {
    const destPath = getExtensionPath();

    log('');
    const confirm = await ask(rl, `${c.yellow}Are you sure you want to uninstall Pulse? (yes/no): ${c.reset}`);

    if (confirm.toLowerCase() !== 'yes' && confirm.toLowerCase() !== 'y') {
        info('Cancelled');
        return;
    }

    info('Uninstalling Pulse...');

    if (fs.existsSync(destPath)) {
        removeDir(destPath);
        ok('Extension removed');
    } else {
        warn('Extension not found');
    }

    const removeCacheQ = await ask(rl, `${c.yellow}Remove cache folder (~/Pulse_Cache)? (yes/no): ${c.reset}`);
    if (removeCacheQ.toLowerCase() === 'yes' || removeCacheQ.toLowerCase() === 'y') {
        const cacheDir = path.join(os.homedir(), 'Pulse_Cache');
        if (fs.existsSync(cacheDir)) {
            removeDir(cacheDir);
            ok('Cache removed');
        }
    }

    const disableDebugQ = await ask(rl, `${c.yellow}Disable CEP debug mode? (yes/no): ${c.reset}`);
    if (disableDebugQ.toLowerCase() === 'yes' || disableDebugQ.toLowerCase() === 'y') {
        disableDebugMode();
        ok('Debug mode disabled');
    }

    log('');
    ok('Uninstall complete');
}

async function main() {
    const rl = createRL();

    try {
        while (true) {
            showHeader();

            const installed = isInstalled();
            const { isWindows, isMac } = getPlatform();

            log(`${c.dim}Platform: ${isWindows ? 'Windows' : isMac ? 'macOS' : 'Linux'}${c.reset}`);
            log(`${c.dim}Status: ${installed ? 'Installed' : 'Not installed'}${c.reset}`);
            log('');

            if (installed) {
                log('  [1] Reinstall Pulse');
                log(`  ${c.red}[2] Uninstall Pulse${c.reset}`);
                log(`  ${c.dim}[3] Exit${c.reset}`);
            } else {
                log(`  ${c.green}[1] Install Pulse${c.reset}`);
                log(`  ${c.dim}[2] Exit${c.reset}`);
            }

            log('');
            const choice = await ask(rl, `${c.cyan}Select option: ${c.reset}`);

            if (installed) {
                switch (choice.trim()) {
                    case '1':
                        await install();
                        await ask(rl, 'Press Enter to continue...');
                        break;
                    case '2':
                        await uninstall(rl);
                        await ask(rl, 'Press Enter to continue...');
                        break;
                    case '3':
                        rl.close();
                        process.exit(0);
                    default:
                        warn('Invalid option');
                        await ask(rl, 'Press Enter to continue...');
                }
            } else {
                switch (choice.trim()) {
                    case '1':
                        await install();
                        await ask(rl, 'Press Enter to continue...');
                        break;
                    case '2':
                        rl.close();
                        process.exit(0);
                    default:
                        warn('Invalid option');
                        await ask(rl, 'Press Enter to continue...');
                }
            }
        }
    } catch (e) {
        err(e.message);
        rl.close();
        process.exit(1);
    }
}

main();
