#!/usr/bin/env node

/**
 * Pulse for After Effects - One-Click Installer
 *
 * Downloads and installs the latest version from GitHub releases.
 * No Node.js required for end users when compiled with pkg.
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

// Colors for terminal (works without chalk in compiled binary)
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
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

    let cepExtensions, pulseData, workerPath;

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
            // Handle redirects
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
                // Handle redirects
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
        // If no releases yet, return null
        return null;
    }
}

// Check for updates
async function checkForUpdates(currentVersion) {
    try {
        const release = await getLatestRelease();
        if (!release) return null;

        const latestVersion = release.tag_name.replace(/^v/, '');

        // Simple version comparison
        if (latestVersion !== currentVersion) {
            return {
                version: latestVersion,
                downloadUrl: release.zipball_url,
                releaseUrl: release.html_url,
                notes: release.body
            };
        }
    } catch (error) {
        // Ignore update check errors
    }
    return null;
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
    // Use built-in unzip on macOS/Linux, PowerShell on Windows
    const { isWindows } = getPlatform();

    fs.mkdirSync(destPath, { recursive: true });

    if (isWindows) {
        execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destPath}' -Force"`, { stdio: 'pipe' });
    } else {
        execSync(`unzip -o "${zipPath}" -d "${destPath}"`, { stdio: 'pipe' });
    }
}

// Find extracted folder (GitHub zips have a folder inside)
function findExtractedFolder(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.isDirectory()) {
            return path.join(dir, entry.name);
        }
    }
    return dir;
}

// Install Node.js for worker (optional - can run embedded)
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
        // Windows batch script to start worker
        const batContent = `@echo off
title Pulse Worker
cd /d "${paths.workerPath}"
node server.js
pause
`;
        fs.writeFileSync(path.join(paths.pulseData, 'Start Pulse Worker.bat'), batContent);

        // Create desktop shortcut (optional)
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
        // macOS/Linux shell script
        const shContent = `#!/bin/bash
cd "${paths.workerPath}"
node server.js
`;
        const scriptPath = path.join(paths.pulseData, 'start-worker.sh');
        fs.writeFileSync(scriptPath, shContent);
        fs.chmodSync(scriptPath, '755');
    }
}

// Create updater config
function createUpdaterConfig(paths, version) {
    const config = {
        version: version,
        installedAt: new Date().toISOString(),
        github: CONFIG.github,
        autoUpdate: true,
        checkInterval: 86400000 // 24 hours
    };

    fs.writeFileSync(paths.configPath, JSON.stringify(config, null, 2));
}

// Progress bar helper
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

// Main installer function
async function install() {
    console.log('');
    log('╔══════════════════════════════════════════════════╗', colors.cyan);
    log('║                                                  ║', colors.cyan);
    log('║      Pulse for After Effects - Installer         ║', colors.cyan);
    log('║                                                  ║', colors.cyan);
    log('╚══════════════════════════════════════════════════╝', colors.cyan);
    console.log('');

    const { platform, isWindows, isMac } = getPlatform();
    const paths = getInstallPaths();

    log(`Platform: ${isWindows ? 'Windows' : isMac ? 'macOS' : 'Linux'}`, colors.bright);
    console.log('');

    // Step 1: Check Node.js
    logInfo('Checking Node.js installation...');
    const nodeVersion = checkNodeInstalled();
    if (nodeVersion) {
        logSuccess(`Node.js ${nodeVersion} found`);
    } else {
        logError('Node.js not found!');
        console.log('');
        log('Please install Node.js 18 or later from:', colors.yellow);
        log('  https://nodejs.org/en/download/', colors.bright);
        console.log('');
        log('After installing Node.js, run this installer again.', colors.yellow);
        process.exit(1);
    }

    // Step 2: Check for latest release
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
        logWarn('Could not check for releases, using bundled version');
    }

    // Step 3: Enable debug mode
    logInfo('Enabling CEP debug mode...');
    if (enableDebugMode()) {
        logSuccess('Debug mode enabled');
    } else {
        logWarn('Could not enable debug mode automatically');
    }

    // Step 4: Create directories
    logInfo('Creating directories...');
    fs.mkdirSync(paths.cepExtensions, { recursive: true });
    fs.mkdirSync(paths.pulseData, { recursive: true });
    logSuccess('Directories created');

    // Step 5: Download or extract
    let sourceDir;

    // Determine bundled path (works both in dev and pkg binary)
    // When compiled with pkg, __dirname is inside the binary
    const bundledPaths = [
        path.join(__dirname, '..', 'bundled'),           // Development
        path.join(__dirname, 'bundled'),                  // pkg snapshot
        path.join(process.cwd(), 'bundled'),              // Current directory
        path.join(path.dirname(process.execPath), 'bundled')  // Next to executable
    ];

    let bundledPath = null;
    for (const p of bundledPaths) {
        if (fs.existsSync(p)) {
            bundledPath = p;
            break;
        }
    }

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
                logInfo('Please check your internet connection and try again.');
                process.exit(1);
            }
        }
    } else if (bundledPath) {
        // Use bundled version (for offline installs)
        logInfo('Using bundled version...');
        sourceDir = bundledPath;
    } else {
        logError('No download available and no bundled version found.');
        logInfo('Please check your internet connection and try again.');
        process.exit(1);
    }

    // Step 6: Install CEP extension
    logInfo('Installing CEP extension...');
    const cepSource = path.join(sourceDir, 'cep-extension');
    if (fs.existsSync(cepSource)) {
        removeDir(paths.extensionPath);
        copyDir(cepSource, paths.extensionPath);
        logSuccess('CEP extension installed');
    } else {
        logError('CEP extension not found in package');
    }

    // Step 7: Install worker
    logInfo('Installing worker...');
    const workerSource = path.join(sourceDir, 'worker');
    if (fs.existsSync(workerSource)) {
        removeDir(paths.workerPath);
        copyDir(workerSource, paths.workerPath);

        // Install npm dependencies
        logInfo('Installing dependencies (this may take a minute)...');
        try {
            execSync('npm install --production', {
                cwd: paths.workerPath,
                stdio: 'pipe'
            });
            logSuccess('Dependencies installed');
        } catch (error) {
            logWarn('Could not install dependencies automatically');
            logInfo(`Please run: cd "${paths.workerPath}" && npm install`);
        }
    } else {
        logError('Worker not found in package');
    }

    // Step 8: Create launch scripts
    logInfo('Creating launch scripts...');
    createLaunchScripts(paths);
    createUpdaterConfig(paths, releaseVersion);
    logSuccess('Launch scripts created');

    // Done!
    console.log('');
    log('╔══════════════════════════════════════════════════╗', colors.green);
    log('║                                                  ║', colors.green);
    log('║          Installation Complete!                  ║', colors.green);
    log('║                                                  ║', colors.green);
    log('╚══════════════════════════════════════════════════╝', colors.green);
    console.log('');

    log('Next Steps:', colors.bright);
    console.log('');
    log('  1. Start the Pulse Worker:', colors.yellow);
    if (isWindows) {
        log(`     Double-click "Pulse Worker" on your Desktop`, colors.bright);
        log(`     Or run: "${path.join(paths.pulseData, 'Start Pulse Worker.bat')}"`, colors.bright);
    } else {
        log(`     Run: ${path.join(paths.pulseData, 'start-worker.sh')}`, colors.bright);
    }
    console.log('');
    log('  2. Restart After Effects', colors.yellow);
    console.log('');
    log('  3. Open Window > Extensions > Pulse', colors.yellow);
    console.log('');

    log('Worker location:', colors.cyan);
    log(`  ${paths.workerPath}`, colors.bright);
    console.log('');

    log('Press Enter to exit...', colors.cyan);

    // Wait for Enter
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('', () => {
        rl.close();
        process.exit(0);
    });
}

// Run installer
install().catch(error => {
    logError(`Installation failed: ${error.message}`);
    console.log('');
    log('Press Enter to exit...', colors.cyan);

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('', () => {
        rl.close();
        process.exit(1);
    });
});
