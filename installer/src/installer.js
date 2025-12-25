#!/usr/bin/env node

/**
 * Pulse for After Effects - Interactive Installer
 *
 * Features:
 * - Install/Update/Uninstall
 * - Auto-downloads latest version from GitHub
 * - Works offline with bundled version
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');
const { execSync, spawn } = require('child_process');
const readline = require('readline');

// Configuration
const CONFIG = {
    github: {
        owner: 'contactmukundthiru-cyber',
        repo: 'aeoptimizer',
        apiUrl: 'https://api.github.com'
    },
    extensionId: 'com.pulse.aeoptimizer',
    appName: 'Pulse for After Effects',
    version: '1.0.0'
};

// Colors for terminal
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    white: '\x1b[37m'
};

function log(msg, color = '') {
    console.log(`${color}${msg}${colors.reset}`);
}

function logSuccess(msg) { log(`✓ ${msg}`, colors.green); }
function logError(msg) { log(`✗ ${msg}`, colors.red); }
function logInfo(msg) { log(`→ ${msg}`, colors.cyan); }
function logWarn(msg) { log(`! ${msg}`, colors.yellow); }

// Platform detection
function getPlatform() {
    const platform = os.platform();
    const arch = os.arch();
    return { platform, arch, isWindows: platform === 'win32', isMac: platform === 'darwin' };
}

// Get installation paths
function getInstallPaths() {
    const { isWindows, isMac } = getPlatform();
    const home = os.homedir();

    let cepExtensions, pulseData;

    if (isWindows) {
        cepExtensions = path.join(process.env.APPDATA, 'Adobe', 'CEP', 'extensions');
        pulseData = path.join(process.env.APPDATA, 'Pulse');
    } else if (isMac) {
        cepExtensions = path.join(home, 'Library', 'Application Support', 'Adobe', 'CEP', 'extensions');
        pulseData = path.join(home, 'Library', 'Application Support', 'Pulse');
    } else {
        cepExtensions = path.join(home, '.config', 'Adobe', 'CEP', 'extensions');
        pulseData = path.join(home, '.config', 'Pulse');
    }

    return {
        cepExtensions,
        extensionPath: path.join(cepExtensions, CONFIG.extensionId),
        pulseData,
        workerPath: path.join(pulseData, 'worker'),
        updaterPath: path.join(pulseData, 'updater'),
        configPath: path.join(pulseData, 'config.json')
    };
}

// Check if Pulse is installed
function isInstalled() {
    const paths = getInstallPaths();
    return fs.existsSync(paths.extensionPath) && fs.existsSync(paths.workerPath);
}

// Get installed version
function getInstalledVersion() {
    const paths = getInstallPaths();
    try {
        if (fs.existsSync(paths.configPath)) {
            const config = JSON.parse(fs.readFileSync(paths.configPath, 'utf8'));
            return config.version || null;
        }
    } catch (e) {}
    return null;
}

// Simple HTTP/HTTPS request wrapper
function request(url, options = {}) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;
        const req = protocol.get(url, {
            headers: {
                'User-Agent': 'Pulse-Installer/1.0',
                ...options.headers
            }
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return request(res.headers.location, options).then(resolve).catch(reject);
            }

            if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }

            if (options.stream) {
                resolve(res);
                return;
            }

            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        });

        req.on('error', reject);
        req.setTimeout(30000, () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
    });
}

// Download file with progress
function downloadFile(url, destPath, onProgress) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(destPath);

        const doRequest = (downloadUrl) => {
            const protocol = downloadUrl.startsWith('https') ? https : http;

            protocol.get(downloadUrl, {
                headers: { 'User-Agent': 'Pulse-Installer/1.0' }
            }, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    return doRequest(res.headers.location);
                }

                if (res.statusCode !== 200) {
                    file.close();
                    fs.unlinkSync(destPath);
                    reject(new Error(`HTTP ${res.statusCode}`));
                    return;
                }

                const totalSize = parseInt(res.headers['content-length'], 10) || 0;
                let downloadedSize = 0;

                res.on('data', (chunk) => {
                    downloadedSize += chunk.length;
                    if (onProgress && totalSize > 0) {
                        onProgress(downloadedSize, totalSize);
                    }
                });

                res.pipe(file);

                file.on('finish', () => {
                    file.close();
                    resolve(destPath);
                });
            }).on('error', (err) => {
                file.close();
                fs.unlinkSync(destPath);
                reject(err);
            });
        };

        doRequest(url);
    });
}

// Get latest release from GitHub
async function getLatestRelease() {
    const url = `${CONFIG.github.apiUrl}/repos/${CONFIG.github.owner}/${CONFIG.github.repo}/releases/latest`;

    try {
        const data = await request(url);
        return JSON.parse(data);
    } catch (error) {
        return null;
    }
}

// Enable CEP debug mode
function enableDebugMode() {
    const { isWindows, isMac } = getPlatform();

    try {
        if (isMac) {
            for (const version of [11, 10, 9, 8]) {
                try {
                    execSync(`defaults write com.adobe.CSXS.${version} PlayerDebugMode 1`, { stdio: 'pipe' });
                } catch (e) {}
            }
        } else if (isWindows) {
            for (const version of [11, 10, 9, 8]) {
                try {
                    execSync(`reg add "HKCU\\Software\\Adobe\\CSXS.${version}" /v PlayerDebugMode /t REG_SZ /d 1 /f`, { stdio: 'pipe' });
                } catch (e) {}
            }
        }
        return true;
    } catch (error) {
        return false;
    }
}

// Disable CEP debug mode
function disableDebugMode() {
    const { isWindows, isMac } = getPlatform();

    try {
        if (isMac) {
            for (const version of [11, 10, 9, 8]) {
                try {
                    execSync(`defaults delete com.adobe.CSXS.${version} PlayerDebugMode`, { stdio: 'pipe' });
                } catch (e) {}
            }
        } else if (isWindows) {
            for (const version of [11, 10, 9, 8]) {
                try {
                    execSync(`reg delete "HKCU\\Software\\Adobe\\CSXS.${version}" /v PlayerDebugMode /f`, { stdio: 'pipe' });
                } catch (e) {}
            }
        }
        return true;
    } catch (error) {
        return false;
    }
}

// Copy directory recursively
function copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            copyDir(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

// Remove directory recursively
function removeDir(dir) {
    if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

// Extract zip file
function extractZip(zipPath, destPath) {
    const { isWindows } = getPlatform();
    fs.mkdirSync(destPath, { recursive: true });

    if (isWindows) {
        execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destPath}' -Force"`, { stdio: 'pipe' });
    } else {
        execSync(`unzip -o "${zipPath}" -d "${destPath}"`, { stdio: 'pipe' });
    }
}

// Find extracted folder
function findExtractedFolder(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.isDirectory()) {
            return path.join(dir, entry.name);
        }
    }
    return dir;
}

// Check Node.js
function checkNodeInstalled() {
    try {
        const version = execSync('node --version', { stdio: 'pipe' }).toString().trim();
        return version;
    } catch (e) {
        return null;
    }
}

// Create launch scripts
function createLaunchScripts(paths) {
    const { isWindows } = getPlatform();

    if (isWindows) {
        const batContent = `@echo off
title Pulse Worker
cd /d "${paths.workerPath}"
node server.js
pause
`;
        fs.writeFileSync(path.join(paths.pulseData, 'Start Pulse Worker.bat'), batContent);

        // Desktop shortcut
        const vbsContent = `Set oWS = WScript.CreateObject("WScript.Shell")
sLinkFile = oWS.SpecialFolders("Desktop") & "\\Pulse Worker.lnk"
Set oLink = oWS.CreateShortcut(sLinkFile)
oLink.TargetPath = "${path.join(paths.pulseData, 'Start Pulse Worker.bat').replace(/\\/g, '\\\\')}"
oLink.WorkingDirectory = "${paths.workerPath.replace(/\\/g, '\\\\')}"
oLink.Description = "Start Pulse Worker"
oLink.Save
`;
        const vbsPath = path.join(paths.pulseData, 'create-shortcut.vbs');
        fs.writeFileSync(vbsPath, vbsContent);
        try {
            execSync(`cscript //nologo "${vbsPath}"`, { stdio: 'pipe' });
            fs.unlinkSync(vbsPath);
        } catch (e) {}

    } else {
        const shContent = `#!/bin/bash
cd "${paths.workerPath}"
node server.js
`;
        const scriptPath = path.join(paths.pulseData, 'start-worker.sh');
        fs.writeFileSync(scriptPath, shContent);
        fs.chmodSync(scriptPath, '755');
    }
}

// Remove launch scripts
function removeLaunchScripts(paths) {
    const { isWindows } = getPlatform();

    if (isWindows) {
        const batPath = path.join(paths.pulseData, 'Start Pulse Worker.bat');
        if (fs.existsSync(batPath)) fs.unlinkSync(batPath);

        // Remove desktop shortcut
        const desktopPath = path.join(os.homedir(), 'Desktop', 'Pulse Worker.lnk');
        if (fs.existsSync(desktopPath)) fs.unlinkSync(desktopPath);
    } else {
        const shPath = path.join(paths.pulseData, 'start-worker.sh');
        if (fs.existsSync(shPath)) fs.unlinkSync(shPath);
    }
}

// Create config
function createConfig(paths, version) {
    const config = {
        version: version,
        installedAt: new Date().toISOString(),
        github: CONFIG.github,
        autoUpdate: true,
        checkInterval: 86400000
    };

    fs.writeFileSync(paths.configPath, JSON.stringify(config, null, 2));
}

// Progress bar
function showProgress(current, total, label = 'Progress') {
    const percent = Math.round((current / total) * 100);
    const barLength = 30;
    const filled = Math.round((percent / 100) * barLength);
    const bar = '█'.repeat(filled) + '░'.repeat(barLength - filled);

    process.stdout.write(`\r${label}: [${bar}] ${percent}%`);

    if (current >= total) {
        console.log('');
    }
}

// Get bundled path
function getBundledPath() {
    const bundledPaths = [
        path.join(__dirname, '..', 'bundled'),
        path.join(__dirname, 'bundled'),
        path.join(process.cwd(), 'bundled'),
        path.join(path.dirname(process.execPath), 'bundled')
    ];

    for (const p of bundledPaths) {
        if (fs.existsSync(p)) {
            return p;
        }
    }
    return null;
}

// Readline interface
function createRL() {
    return readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
}

// Ask question
function ask(rl, question) {
    return new Promise(resolve => {
        rl.question(question, resolve);
    });
}

// Show header
function showHeader() {
    console.clear();
    log('╔══════════════════════════════════════════════════╗', colors.cyan);
    log('║                                                  ║', colors.cyan);
    log('║      Pulse for After Effects                     ║', colors.cyan);
    log('║      Interactive Installer                       ║', colors.cyan);
    log('║                                                  ║', colors.cyan);
    log('╚══════════════════════════════════════════════════╝', colors.cyan);
    console.log('');
}

// Show menu
async function showMenu(rl) {
    const installed = isInstalled();
    const installedVersion = getInstalledVersion();
    const { isWindows, isMac } = getPlatform();

    log(`Platform: ${isWindows ? 'Windows' : isMac ? 'macOS' : 'Linux'}`, colors.dim);

    if (installed) {
        log(`Status: Installed (v${installedVersion || 'unknown'})`, colors.green);
    } else {
        log(`Status: Not installed`, colors.yellow);
    }

    console.log('');
    log('─────────────────────────────────────────────────', colors.dim);
    console.log('');

    if (installed) {
        log('  [1] Update Pulse', colors.bright);
        log('  [2] Reinstall Pulse', colors.bright);
        log('  [3] Uninstall Pulse', colors.red);
        log('  [4] Check for Updates', colors.bright);
        log('  [5] Exit', colors.dim);
    } else {
        log('  [1] Install Pulse', colors.green);
        log('  [2] Exit', colors.dim);
    }

    console.log('');
    const choice = await ask(rl, `${colors.cyan}Select option: ${colors.reset}`);

    return { choice: choice.trim(), installed };
}

// Install function
async function performInstall(isUpdate = false) {
    const paths = getInstallPaths();
    const { isWindows } = getPlatform();

    console.log('');
    log(isUpdate ? '── Updating Pulse ──' : '── Installing Pulse ──', colors.cyan);
    console.log('');

    // Check Node.js
    logInfo('Checking Node.js...');
    const nodeVersion = checkNodeInstalled();
    if (nodeVersion) {
        logSuccess(`Node.js ${nodeVersion} found`);
    } else {
        logError('Node.js not found!');
        log('Please install Node.js 18+ from: https://nodejs.org/', colors.yellow);
        return false;
    }

    // Check for latest release
    logInfo('Checking for latest version...');
    let releaseVersion = CONFIG.version;
    let downloadUrl = null;

    try {
        const release = await getLatestRelease();
        if (release) {
            releaseVersion = release.tag_name.replace(/^v/, '');
            downloadUrl = release.zipball_url;
            logSuccess(`Latest version: ${releaseVersion}`);
        } else {
            logWarn('No releases found, using bundled version');
        }
    } catch (error) {
        logWarn('Could not check for releases');
    }

    // Enable debug mode
    logInfo('Enabling CEP debug mode...');
    enableDebugMode();
    logSuccess('Debug mode enabled');

    // Create directories
    logInfo('Creating directories...');
    fs.mkdirSync(paths.cepExtensions, { recursive: true });
    fs.mkdirSync(paths.pulseData, { recursive: true });
    logSuccess('Directories created');

    // Get source
    let sourceDir;
    const bundledPath = getBundledPath();

    if (downloadUrl) {
        logInfo('Downloading latest release...');
        const tempDir = path.join(os.tmpdir(), 'pulse-install-' + Date.now());
        const zipPath = path.join(tempDir, 'pulse.zip');

        fs.mkdirSync(tempDir, { recursive: true });

        try {
            await downloadFile(downloadUrl, zipPath, (downloaded, total) => {
                showProgress(downloaded, total, 'Downloading');
            });
            logSuccess('Download complete');

            logInfo('Extracting files...');
            extractZip(zipPath, tempDir);
            sourceDir = findExtractedFolder(tempDir);
            logSuccess('Extraction complete');
        } catch (error) {
            logError(`Download failed: ${error.message}`);
            if (bundledPath) {
                logInfo('Using bundled version instead...');
                sourceDir = bundledPath;
            } else {
                logError('No bundled version available.');
                return false;
            }
        }
    } else if (bundledPath) {
        logInfo('Using bundled version...');
        sourceDir = bundledPath;
    } else {
        logError('No download available and no bundled version found.');
        return false;
    }

    // Install CEP extension
    logInfo('Installing CEP extension...');
    const cepSource = path.join(sourceDir, 'cep-extension');
    if (fs.existsSync(cepSource)) {
        removeDir(paths.extensionPath);
        copyDir(cepSource, paths.extensionPath);
        logSuccess('CEP extension installed');
    } else {
        logError('CEP extension not found');
        return false;
    }

    // Install worker
    logInfo('Installing worker...');
    const workerSource = path.join(sourceDir, 'worker');
    if (fs.existsSync(workerSource)) {
        removeDir(paths.workerPath);
        copyDir(workerSource, paths.workerPath);

        logInfo('Installing dependencies...');
        try {
            execSync('npm install --production', {
                cwd: paths.workerPath,
                stdio: 'pipe'
            });
            logSuccess('Dependencies installed');
        } catch (error) {
            logWarn('Could not install dependencies automatically');
            logInfo(`Run manually: cd "${paths.workerPath}" && npm install`);
        }
    } else {
        logError('Worker not found');
        return false;
    }

    // Create launch scripts and config
    logInfo('Creating launch scripts...');
    createLaunchScripts(paths);
    createConfig(paths, releaseVersion);
    logSuccess('Setup complete');

    // Success message
    console.log('');
    log('╔══════════════════════════════════════════════════╗', colors.green);
    log('║                                                  ║', colors.green);
    log(isUpdate ? '║          Update Complete!                        ║' : '║          Installation Complete!                  ║', colors.green);
    log('║                                                  ║', colors.green);
    log('╚══════════════════════════════════════════════════╝', colors.green);
    console.log('');

    log('Next Steps:', colors.bright);
    log('  1. Start the Pulse Worker:', colors.yellow);
    if (isWindows) {
        log(`     Double-click "Pulse Worker" on Desktop`, colors.dim);
    } else {
        log(`     Run: ${path.join(paths.pulseData, 'start-worker.sh')}`, colors.dim);
    }
    log('  2. Restart After Effects', colors.yellow);
    log('  3. Open Window > Extensions > Pulse', colors.yellow);
    console.log('');

    return true;
}

// Uninstall function
async function performUninstall(rl) {
    console.log('');
    log('── Uninstalling Pulse ──', colors.red);
    console.log('');

    const confirm = await ask(rl, `${colors.yellow}Are you sure you want to uninstall Pulse? (yes/no): ${colors.reset}`);

    if (confirm.toLowerCase() !== 'yes' && confirm.toLowerCase() !== 'y') {
        logInfo('Uninstall cancelled');
        return false;
    }

    const paths = getInstallPaths();

    // Remove CEP extension
    logInfo('Removing CEP extension...');
    removeDir(paths.extensionPath);
    logSuccess('CEP extension removed');

    // Remove worker
    logInfo('Removing worker...');
    removeDir(paths.workerPath);
    logSuccess('Worker removed');

    // Remove launch scripts
    logInfo('Removing launch scripts...');
    removeLaunchScripts(paths);
    logSuccess('Launch scripts removed');

    // Remove config (optional - keep data?)
    const keepData = await ask(rl, `${colors.yellow}Keep user data and cache? (yes/no): ${colors.reset}`);

    if (keepData.toLowerCase() !== 'yes' && keepData.toLowerCase() !== 'y') {
        logInfo('Removing user data...');
        removeDir(paths.pulseData);
        logSuccess('User data removed');
    } else {
        // Just remove config
        if (fs.existsSync(paths.configPath)) {
            fs.unlinkSync(paths.configPath);
        }
        logInfo('User data preserved');
    }

    // Optionally disable debug mode
    const disableDebug = await ask(rl, `${colors.yellow}Disable CEP debug mode? (yes/no): ${colors.reset}`);

    if (disableDebug.toLowerCase() === 'yes' || disableDebug.toLowerCase() === 'y') {
        logInfo('Disabling debug mode...');
        disableDebugMode();
        logSuccess('Debug mode disabled');
    }

    console.log('');
    log('╔══════════════════════════════════════════════════╗', colors.green);
    log('║                                                  ║', colors.green);
    log('║          Uninstall Complete!                     ║', colors.green);
    log('║                                                  ║', colors.green);
    log('╚══════════════════════════════════════════════════╝', colors.green);
    console.log('');

    log('Pulse has been removed from your system.', colors.dim);
    console.log('');

    return true;
}

// Check for updates
async function checkForUpdates() {
    console.log('');
    log('── Checking for Updates ──', colors.cyan);
    console.log('');

    const installedVersion = getInstalledVersion();
    logInfo(`Installed version: ${installedVersion || 'unknown'}`);

    logInfo('Checking GitHub for latest version...');

    try {
        const release = await getLatestRelease();
        if (release) {
            const latestVersion = release.tag_name.replace(/^v/, '');
            logInfo(`Latest version: ${latestVersion}`);

            if (installedVersion && latestVersion !== installedVersion) {
                console.log('');
                log(`Update available: ${installedVersion} → ${latestVersion}`, colors.green);
                log('Select "Update Pulse" from the menu to update.', colors.yellow);
            } else {
                console.log('');
                logSuccess('You have the latest version!');
            }
        } else {
            logWarn('No releases found on GitHub');
        }
    } catch (error) {
        logError(`Failed to check for updates: ${error.message}`);
    }

    console.log('');
}

// Main function
async function main() {
    const rl = createRL();

    try {
        while (true) {
            showHeader();
            const { choice, installed } = await showMenu(rl);

            if (installed) {
                switch (choice) {
                    case '1': // Update
                        await performInstall(true);
                        await ask(rl, 'Press Enter to continue...');
                        break;
                    case '2': // Reinstall
                        await performInstall(false);
                        await ask(rl, 'Press Enter to continue...');
                        break;
                    case '3': // Uninstall
                        await performUninstall(rl);
                        await ask(rl, 'Press Enter to continue...');
                        break;
                    case '4': // Check updates
                        await checkForUpdates();
                        await ask(rl, 'Press Enter to continue...');
                        break;
                    case '5': // Exit
                        rl.close();
                        process.exit(0);
                        break;
                    default:
                        logWarn('Invalid option');
                        await ask(rl, 'Press Enter to continue...');
                }
            } else {
                switch (choice) {
                    case '1': // Install
                        await performInstall(false);
                        await ask(rl, 'Press Enter to continue...');
                        break;
                    case '2': // Exit
                        rl.close();
                        process.exit(0);
                        break;
                    default:
                        logWarn('Invalid option');
                        await ask(rl, 'Press Enter to continue...');
                }
            }
        }
    } catch (error) {
        logError(`Error: ${error.message}`);
        rl.close();
        process.exit(1);
    }
}

// Run
main();
