#!/usr/bin/env node

/**
 * Pulse for After Effects - Installer
 * Features: Install, Update, Uninstall
 * Downloads latest from GitHub or uses bundled version
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { execSync } = require('child_process');
const readline = require('readline');

// ============ Configuration ============
const CONFIG = {
    github: {
        owner: 'contactmukundthiru-cyber',
        repo: 'aeoptimizer'
    },
    extensionId: 'com.pulse.aeoptimizer',
    appName: 'Pulse for After Effects',
    version: '1.0.0'
};

// ============ Console Colors ============
const C = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    dim: '\x1b[2m'
};

function log(msg) { console.log(msg); }
function ok(msg) { console.log(`${C.green}✓ ${msg}${C.reset}`); }
function fail(msg) { console.log(`${C.red}✗ ${msg}${C.reset}`); }
function info(msg) { console.log(`${C.cyan}→ ${msg}${C.reset}`); }
function warn(msg) { console.log(`${C.yellow}! ${msg}${C.reset}`); }

// ============ Platform Helpers ============
function isWindows() { return os.platform() === 'win32'; }
function isMac() { return os.platform() === 'darwin'; }

function getExtensionPath() {
    if (isWindows()) {
        return path.join(process.env.APPDATA, 'Adobe', 'CEP', 'extensions', CONFIG.extensionId);
    } else if (isMac()) {
        return path.join(os.homedir(), 'Library', 'Application Support', 'Adobe', 'CEP', 'extensions', CONFIG.extensionId);
    }
    return path.join(os.homedir(), '.config', 'Adobe', 'CEP', 'extensions', CONFIG.extensionId);
}

function getConfigPath() {
    if (isWindows()) {
        return path.join(process.env.APPDATA, 'Pulse', 'config.json');
    } else if (isMac()) {
        return path.join(os.homedir(), 'Library', 'Application Support', 'Pulse', 'config.json');
    }
    return path.join(os.homedir(), '.config', 'Pulse', 'config.json');
}

// ============ File Operations ============
function copyDir(src, dest) {
    if (!fs.existsSync(src)) {
        throw new Error(`Source not found: ${src}`);
    }
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

function removeDir(dir) {
    if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

// ============ Source Location ============
function findSourcePath() {
    const locations = [
        path.join(__dirname, '..', 'bundled', 'cep-extension'),
        path.join(__dirname, '..', '..', 'cep-extension'),
        path.join(process.cwd(), 'bundled', 'cep-extension'),
        path.join(process.cwd(), 'cep-extension'),
        path.join(path.dirname(process.execPath), 'bundled', 'cep-extension')
    ];

    for (const loc of locations) {
        if (fs.existsSync(loc) && fs.existsSync(path.join(loc, 'index.html'))) {
            return loc;
        }
    }
    return null;
}

// ============ GitHub API ============
function httpsGet(url) {
    return new Promise((resolve, reject) => {
        const options = {
            headers: { 'User-Agent': 'Pulse-Installer/1.0' }
        };

        https.get(url, options, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                httpsGet(res.headers.location).then(resolve).catch(reject);
                return;
            }

            if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }

            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        ensureDir(path.dirname(destPath));
        const file = fs.createWriteStream(destPath);

        const doDownload = (downloadUrl) => {
            https.get(downloadUrl, { headers: { 'User-Agent': 'Pulse-Installer/1.0' } }, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    doDownload(res.headers.location);
                    return;
                }

                if (res.statusCode !== 200) {
                    file.close();
                    fs.unlinkSync(destPath);
                    reject(new Error(`HTTP ${res.statusCode}`));
                    return;
                }

                const total = parseInt(res.headers['content-length'], 10) || 0;
                let downloaded = 0;

                res.on('data', (chunk) => {
                    downloaded += chunk.length;
                    if (total > 0) {
                        const pct = Math.round((downloaded / total) * 100);
                        process.stdout.write(`\r${C.cyan}Downloading: ${pct}%${C.reset}   `);
                    }
                });

                res.pipe(file);
                file.on('finish', () => {
                    file.close();
                    console.log('');
                    resolve(destPath);
                });
            }).on('error', (err) => {
                file.close();
                if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
                reject(err);
            });
        };

        doDownload(url);
    });
}

async function getLatestRelease() {
    try {
        const url = `https://api.github.com/repos/${CONFIG.github.owner}/${CONFIG.github.repo}/releases/latest`;
        const data = await httpsGet(url);
        return JSON.parse(data);
    } catch (e) {
        return null;
    }
}

async function checkForUpdates(currentVersion) {
    try {
        const release = await getLatestRelease();
        if (!release) return null;

        const latestVersion = release.tag_name.replace(/^v/, '');
        if (latestVersion !== currentVersion) {
            return {
                version: latestVersion,
                downloadUrl: release.zipball_url,
                notes: release.body
            };
        }
    } catch (e) {}
    return null;
}

// ============ CEP Debug Mode ============
function enableDebugMode() {
    try {
        const versions = [8, 9, 10, 11, 12];
        if (isMac()) {
            versions.forEach(v => {
                try { execSync(`defaults write com.adobe.CSXS.${v} PlayerDebugMode 1`, { stdio: 'pipe' }); } catch (e) {}
            });
        } else if (isWindows()) {
            versions.forEach(v => {
                try { execSync(`reg add "HKCU\\Software\\Adobe\\CSXS.${v}" /v PlayerDebugMode /t REG_SZ /d 1 /f`, { stdio: 'pipe' }); } catch (e) {}
            });
        }
        return true;
    } catch (e) {
        return false;
    }
}

function disableDebugMode() {
    try {
        const versions = [8, 9, 10, 11, 12];
        if (isMac()) {
            versions.forEach(v => {
                try { execSync(`defaults delete com.adobe.CSXS.${v} PlayerDebugMode`, { stdio: 'pipe' }); } catch (e) {}
            });
        } else if (isWindows()) {
            versions.forEach(v => {
                try { execSync(`reg delete "HKCU\\Software\\Adobe\\CSXS.${v}" /v PlayerDebugMode /f`, { stdio: 'pipe' }); } catch (e) {}
            });
        }
    } catch (e) {}
}

// ============ Zip Extraction ============
function extractZip(zipPath, destPath) {
    ensureDir(destPath);

    if (isWindows()) {
        execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destPath}' -Force"`, { stdio: 'pipe' });
    } else {
        execSync(`unzip -o "${zipPath}" -d "${destPath}"`, { stdio: 'pipe' });
    }
}

function findExtractedDir(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.isDirectory()) {
            return path.join(dir, entry.name);
        }
    }
    return dir;
}

// ============ Installation State ============
function isInstalled() {
    const extPath = getExtensionPath();
    return fs.existsSync(extPath) && fs.existsSync(path.join(extPath, 'index.html'));
}

function getInstalledVersion() {
    try {
        const configPath = getConfigPath();
        if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            return config.version || CONFIG.version;
        }
    } catch (e) {}
    return null;
}

function saveConfig(version) {
    const configPath = getConfigPath();
    ensureDir(path.dirname(configPath));

    const config = {
        version: version,
        installedAt: new Date().toISOString(),
        github: CONFIG.github
    };

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

// ============ Readline Helpers ============
function createRL() {
    return readline.createInterface({ input: process.stdin, output: process.stdout });
}

function ask(rl, question) {
    return new Promise(resolve => rl.question(question, resolve));
}

// ============ Main Operations ============
async function performInstall(useGitHub = true) {
    const destPath = getExtensionPath();
    let version = CONFIG.version;
    let sourcePath = null;

    log('');
    info('Installing Pulse for After Effects...');
    log('');

    // Try to download from GitHub first
    if (useGitHub) {
        info('Checking for latest version...');
        try {
            const release = await getLatestRelease();
            if (release && release.zipball_url) {
                version = release.tag_name.replace(/^v/, '');
                ok(`Latest version: ${version}`);

                info('Downloading...');
                const tempDir = path.join(os.tmpdir(), `pulse-install-${Date.now()}`);
                const zipPath = path.join(tempDir, 'pulse.zip');

                try {
                    await downloadFile(release.zipball_url, zipPath);
                    ok('Download complete');

                    info('Extracting...');
                    extractZip(zipPath, tempDir);
                    const extractedDir = findExtractedDir(tempDir);
                    sourcePath = path.join(extractedDir, 'cep-extension');

                    if (!fs.existsSync(sourcePath)) {
                        throw new Error('cep-extension not found in download');
                    }
                    ok('Extraction complete');
                } catch (e) {
                    warn(`Download failed: ${e.message}`);
                    sourcePath = null;
                }
            } else {
                warn('No releases found on GitHub');
            }
        } catch (e) {
            warn(`Could not connect to GitHub: ${e.message}`);
        }
    }

    // Fall back to bundled version
    if (!sourcePath) {
        info('Using bundled version...');
        sourcePath = findSourcePath();

        if (!sourcePath) {
            fail('Extension files not found!');
            fail('Please ensure the bundled folder contains cep-extension.');
            return false;
        }
    }

    log(`${C.dim}Source: ${sourcePath}${C.reset}`);
    log(`${C.dim}Destination: ${destPath}${C.reset}`);
    log('');

    // Enable debug mode
    info('Enabling CEP debug mode...');
    if (enableDebugMode()) {
        ok('Debug mode enabled');
    } else {
        warn('Could not enable debug mode automatically');
    }

    // Remove old installation
    if (fs.existsSync(destPath)) {
        info('Removing old installation...');
        removeDir(destPath);
    }

    // Copy files
    info('Installing extension...');
    try {
        ensureDir(path.dirname(destPath));
        copyDir(sourcePath, destPath);
        ok('Extension installed');
    } catch (e) {
        fail(`Installation failed: ${e.message}`);
        return false;
    }

    // Verify
    if (!fs.existsSync(path.join(destPath, 'index.html'))) {
        fail('Installation verification failed');
        return false;
    }

    // Save config
    saveConfig(version);
    ok('Configuration saved');

    // Success
    log('');
    log(`${C.green}╔══════════════════════════════════════════════════╗${C.reset}`);
    log(`${C.green}║          Installation Complete!                  ║${C.reset}`);
    log(`${C.green}╚══════════════════════════════════════════════════╝${C.reset}`);
    log('');
    log(`${C.yellow}Next steps:${C.reset}`);
    log('  1. Close After Effects completely (File → Exit)');
    log('  2. Reopen After Effects');
    log('  3. Go to Window → Extensions → Pulse');
    log('');

    return true;
}

async function performUninstall(rl) {
    log('');
    const confirm = await ask(rl, `${C.yellow}Uninstall Pulse? (yes/no): ${C.reset}`);

    if (confirm.toLowerCase() !== 'yes' && confirm.toLowerCase() !== 'y') {
        info('Cancelled');
        return;
    }

    const destPath = getExtensionPath();

    info('Removing extension...');
    if (fs.existsSync(destPath)) {
        removeDir(destPath);
        ok('Extension removed');
    }

    // Remove config
    const configPath = getConfigPath();
    if (fs.existsSync(configPath)) {
        fs.unlinkSync(configPath);
    }

    // Ask about cache
    const cacheDir = path.join(os.homedir(), 'Pulse_Cache');
    if (fs.existsSync(cacheDir)) {
        const removeCache = await ask(rl, `${C.yellow}Remove cache folder? (yes/no): ${C.reset}`);
        if (removeCache.toLowerCase() === 'yes' || removeCache.toLowerCase() === 'y') {
            removeDir(cacheDir);
            ok('Cache removed');
        }
    }

    // Ask about debug mode
    const disableDebug = await ask(rl, `${C.yellow}Disable CEP debug mode? (yes/no): ${C.reset}`);
    if (disableDebug.toLowerCase() === 'yes' || disableDebug.toLowerCase() === 'y') {
        disableDebugMode();
        ok('Debug mode disabled');
    }

    log('');
    ok('Uninstall complete');
}

async function performCheckUpdates() {
    log('');
    info('Checking for updates...');

    const currentVersion = getInstalledVersion() || CONFIG.version;
    log(`${C.dim}Current version: ${currentVersion}${C.reset}`);

    const update = await checkForUpdates(currentVersion);

    if (update) {
        log('');
        log(`${C.green}Update available: ${currentVersion} → ${update.version}${C.reset}`);
        log('Select "Update Pulse" from the menu to install.');
    } else {
        log('');
        ok('You have the latest version!');
    }
}

// ============ Menu ============
function showHeader() {
    console.clear();
    log(`${C.cyan}╔══════════════════════════════════════════════════╗${C.reset}`);
    log(`${C.cyan}║      Pulse for After Effects                     ║${C.reset}`);
    log(`${C.cyan}║      Installer                                   ║${C.reset}`);
    log(`${C.cyan}╚══════════════════════════════════════════════════╝${C.reset}`);
    log('');
}

async function showMenu(rl) {
    const installed = isInstalled();
    const version = getInstalledVersion();

    log(`${C.dim}Platform: ${isWindows() ? 'Windows' : isMac() ? 'macOS' : 'Linux'}${C.reset}`);

    if (installed) {
        log(`${C.green}Status: Installed${version ? ` (v${version})` : ''}${C.reset}`);
    } else {
        log(`${C.yellow}Status: Not installed${C.reset}`);
    }

    log('');
    log('─────────────────────────────────────────────────');
    log('');

    if (installed) {
        log('  [1] Update Pulse');
        log('  [2] Reinstall Pulse');
        log(`  ${C.red}[3] Uninstall Pulse${C.reset}`);
        log('  [4] Check for Updates');
        log(`  ${C.dim}[5] Exit${C.reset}`);
    } else {
        log(`  ${C.green}[1] Install Pulse${C.reset}`);
        log(`  ${C.dim}[2] Exit${C.reset}`);
    }

    log('');
    const choice = await ask(rl, `${C.cyan}Select option: ${C.reset}`);

    return { choice: choice.trim(), installed };
}

// ============ Main ============
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
                        await ask(rl, '\nPress Enter to continue...');
                        break;
                    case '2': // Reinstall
                        await performInstall(true);
                        await ask(rl, '\nPress Enter to continue...');
                        break;
                    case '3': // Uninstall
                        await performUninstall(rl);
                        await ask(rl, '\nPress Enter to continue...');
                        break;
                    case '4': // Check updates
                        await performCheckUpdates();
                        await ask(rl, '\nPress Enter to continue...');
                        break;
                    case '5': // Exit
                        rl.close();
                        process.exit(0);
                        break;
                    default:
                        warn('Invalid option');
                        await ask(rl, '\nPress Enter to continue...');
                }
            } else {
                switch (choice) {
                    case '1': // Install
                        await performInstall(true);
                        await ask(rl, '\nPress Enter to continue...');
                        break;
                    case '2': // Exit
                        rl.close();
                        process.exit(0);
                        break;
                    default:
                        warn('Invalid option');
                        await ask(rl, '\nPress Enter to continue...');
                }
            }
        }
    } catch (e) {
        fail(`Error: ${e.message}`);
        console.error(e.stack);
        rl.close();
        process.exit(1);
    }
}

main();
