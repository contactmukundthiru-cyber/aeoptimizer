#!/usr/bin/env node

/**
 * Pulse for After Effects - Auto Updater
 *
 * Checks for updates and notifies the user.
 * Can be run on system startup or periodically.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { execSync, spawn } = require('child_process');

// Get paths
function getPaths() {
    const platform = os.platform();
    const home = os.homedir();

    let pulseData;
    if (platform === 'win32') {
        pulseData = path.join(process.env.APPDATA, 'Pulse');
    } else if (platform === 'darwin') {
        pulseData = path.join(home, 'Library', 'Application Support', 'Pulse');
    } else {
        pulseData = path.join(home, '.config', 'Pulse');
    }

    return {
        pulseData,
        configPath: path.join(pulseData, 'config.json'),
        workerPath: path.join(pulseData, 'worker'),
        logPath: path.join(pulseData, 'updater.log')
    };
}

// Simple logger
function log(message) {
    const paths = getPaths();
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${message}\n`;

    console.log(message);

    try {
        fs.appendFileSync(paths.logPath, line);
    } catch (e) {}
}

// Read config
function readConfig() {
    const paths = getPaths();

    try {
        if (fs.existsSync(paths.configPath)) {
            return JSON.parse(fs.readFileSync(paths.configPath, 'utf8'));
        }
    } catch (e) {}

    return null;
}

// Write config
function writeConfig(config) {
    const paths = getPaths();

    try {
        fs.writeFileSync(paths.configPath, JSON.stringify(config, null, 2));
    } catch (e) {}
}

// HTTP request
function request(url) {
    return new Promise((resolve, reject) => {
        https.get(url, {
            headers: { 'User-Agent': 'Pulse-Updater/1.0' }
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return request(res.headers.location).then(resolve).catch(reject);
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

// Compare versions (simple semver)
function isNewer(latest, current) {
    const latestParts = latest.replace(/^v/, '').split('.').map(Number);
    const currentParts = current.replace(/^v/, '').split('.').map(Number);

    for (let i = 0; i < 3; i++) {
        const l = latestParts[i] || 0;
        const c = currentParts[i] || 0;
        if (l > c) return true;
        if (l < c) return false;
    }
    return false;
}

// Check for updates
async function checkForUpdates() {
    const config = readConfig();
    if (!config) {
        log('No config found, skipping update check');
        return null;
    }

    if (!config.autoUpdate) {
        log('Auto-update disabled');
        return null;
    }

    const { github, version: currentVersion } = config;
    const url = `https://api.github.com/repos/${github.owner}/${github.repo}/releases/latest`;

    try {
        const data = await request(url);
        const release = JSON.parse(data);
        const latestVersion = release.tag_name.replace(/^v/, '');

        if (isNewer(latestVersion, currentVersion)) {
            return {
                current: currentVersion,
                latest: latestVersion,
                downloadUrl: release.zipball_url,
                releaseUrl: release.html_url,
                notes: release.body
            };
        }

        log(`Already on latest version (${currentVersion})`);
        return null;
    } catch (error) {
        log(`Update check failed: ${error.message}`);
        return null;
    }
}

// Show notification (platform-specific)
function showNotification(title, message, url) {
    const platform = os.platform();

    try {
        if (platform === 'darwin') {
            // macOS notification
            const script = `display notification "${message}" with title "${title}"`;
            execSync(`osascript -e '${script}'`, { stdio: 'pipe' });
        } else if (platform === 'win32') {
            // Windows PowerShell notification
            const ps = `
                [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
                $template = [Windows.UI.Notifications.ToastTemplateType]::ToastText02
                $xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent($template)
                $text = $xml.GetElementsByTagName("text")
                $text[0].AppendChild($xml.CreateTextNode("${title}")) | Out-Null
                $text[1].AppendChild($xml.CreateTextNode("${message}")) | Out-Null
                $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
                [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Pulse").Show($toast)
            `;
            // Fallback to simple message box if toast fails
            try {
                execSync(`powershell -Command "${ps.replace(/\n/g, ' ')}"`, { stdio: 'pipe' });
            } catch (e) {
                execSync(`msg * "${title}: ${message}"`, { stdio: 'pipe' });
            }
        } else {
            // Linux - try notify-send
            execSync(`notify-send "${title}" "${message}"`, { stdio: 'pipe' });
        }
    } catch (error) {
        log(`Could not show notification: ${error.message}`);
    }
}

// Main
async function main() {
    const args = process.argv.slice(2);
    const silent = args.includes('--silent');

    if (!silent) {
        console.log('Pulse Updater - Checking for updates...');
    }

    const update = await checkForUpdates();

    if (update) {
        log(`Update available: ${update.current} → ${update.latest}`);

        // Update config with last check time
        const config = readConfig();
        if (config) {
            config.lastUpdateCheck = new Date().toISOString();
            config.updateAvailable = update;
            writeConfig(config);
        }

        // Show notification
        showNotification(
            'Pulse Update Available',
            `Version ${update.latest} is available. Visit the download page to update.`,
            update.releaseUrl
        );

        // Print to console
        if (!silent) {
            console.log('');
            console.log(`New version available: ${update.latest}`);
            console.log(`Current version: ${update.current}`);
            console.log('');
            console.log(`Download: ${update.releaseUrl}`);
            console.log('');
        }

        return 1; // Update available
    }

    // Update last check time
    const config = readConfig();
    if (config) {
        config.lastUpdateCheck = new Date().toISOString();
        config.updateAvailable = null;
        writeConfig(config);
    }

    return 0; // No update
}

main().then(process.exit).catch(error => {
    log(`Error: ${error.message}`);
    process.exit(1);
});
