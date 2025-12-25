#!/usr/bin/env node

/**
 * Pulse for After Effects - Cross-Platform Setup Script
 * Run with: node scripts/setup.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

console.log('========================================');
console.log('Pulse for After Effects - Setup');
console.log('========================================\n');

const projectDir = path.resolve(__dirname, '..');
const cepDir = path.join(projectDir, 'cep-extension');
const workerDir = path.join(projectDir, 'worker');

console.log(`Project directory: ${projectDir}\n`);

// Determine platform
const platform = os.platform();
let cepExtensionsDir;

switch (platform) {
    case 'darwin':
        cepExtensionsDir = path.join(os.homedir(), 'Library', 'Application Support', 'Adobe', 'CEP', 'extensions');
        break;
    case 'win32':
        cepExtensionsDir = path.join(process.env.APPDATA, 'Adobe', 'CEP', 'extensions');
        break;
    case 'linux':
        cepExtensionsDir = path.join(os.homedir(), '.config', 'Adobe', 'CEP', 'extensions');
        break;
    default:
        console.error(`Unsupported platform: ${platform}`);
        process.exit(1);
}

console.log(`Platform: ${platform}`);
console.log(`CEP extensions: ${cepExtensionsDir}\n`);

// Step 1: Enable debug mode
console.log('Step 1: Enabling CEP debug mode...');
try {
    if (platform === 'darwin') {
        for (const version of [11, 10, 9, 8]) {
            try {
                execSync(`defaults write com.adobe.CSXS.${version} PlayerDebugMode 1`, { stdio: 'pipe' });
            } catch (e) {}
        }
        console.log('  Debug mode enabled for CSXS 8-11\n');
    } else if (platform === 'win32') {
        for (const version of [11, 10, 9, 8]) {
            try {
                execSync(`reg add "HKCU\\Software\\Adobe\\CSXS.${version}" /v PlayerDebugMode /t REG_SZ /d 1 /f`, { stdio: 'pipe' });
            } catch (e) {}
        }
        console.log('  Debug mode enabled for CSXS 8-11\n');
    } else {
        console.log('  Note: Manual debug mode setup may be required on Linux\n');
    }
} catch (err) {
    console.log('  Warning: Could not set debug mode automatically\n');
}

// Step 2: Create CEP extensions directory
console.log('Step 2: Creating CEP extensions directory...');
try {
    fs.mkdirSync(cepExtensionsDir, { recursive: true });
    console.log(`  Created: ${cepExtensionsDir}\n`);
} catch (err) {
    if (err.code !== 'EEXIST') {
        console.error(`  Error: ${err.message}\n`);
    } else {
        console.log(`  Already exists: ${cepExtensionsDir}\n`);
    }
}

// Step 3: Create symlink
console.log('Step 3: Creating symlink to extension...');
const extensionLink = path.join(cepExtensionsDir, 'com.pulse.aeoptimizer');

try {
    // Remove existing link/directory
    if (fs.existsSync(extensionLink)) {
        const stats = fs.lstatSync(extensionLink);
        if (stats.isSymbolicLink()) {
            fs.unlinkSync(extensionLink);
        } else if (stats.isDirectory()) {
            console.log('  Warning: Directory exists at target. Please remove manually:');
            console.log(`  ${extensionLink}\n`);
            // Continue anyway for other setup steps
        }
    }

    // Create symlink
    fs.symlinkSync(cepDir, extensionLink, 'junction');
    console.log(`  Symlink created: ${extensionLink}\n`);
} catch (err) {
    console.log(`  Warning: Could not create symlink: ${err.message}`);
    console.log('  You may need to run as administrator or copy manually:\n');
    console.log(`  Copy: ${cepDir}`);
    console.log(`  To:   ${extensionLink}\n`);
}

// Step 4: Install worker dependencies
console.log('Step 4: Installing worker dependencies...');
try {
    process.chdir(workerDir);
    execSync('npm install', { stdio: 'inherit' });
    console.log('  Dependencies installed\n');
} catch (err) {
    console.error(`  Error: ${err.message}\n`);
}

// Step 5: Create icons directory
console.log('Step 5: Creating icons directory...');
const iconsDir = path.join(cepDir, 'icons');
try {
    fs.mkdirSync(iconsDir, { recursive: true });
    console.log(`  Icons directory: ${iconsDir}`);
    console.log('  Note: Add your icon.png to this directory\n');
} catch (err) {
    if (err.code !== 'EEXIST') {
        console.error(`  Error: ${err.message}\n`);
    }
}

// Step 6: Check for aerender
console.log('Step 6: Checking for aerender...');
const aerenderLocations = platform === 'win32'
    ? [
        'C:\\Program Files\\Adobe\\Adobe After Effects 2024\\Support Files\\aerender.exe',
        'C:\\Program Files\\Adobe\\Adobe After Effects 2023\\Support Files\\aerender.exe',
        'C:\\Program Files\\Adobe\\Adobe After Effects 2022\\Support Files\\aerender.exe',
        'C:\\Program Files\\Adobe\\Adobe After Effects 2021\\Support Files\\aerender.exe'
    ]
    : [
        '/Applications/Adobe After Effects 2024/aerender',
        '/Applications/Adobe After Effects 2023/aerender',
        '/Applications/Adobe After Effects 2022/aerender',
        '/Applications/Adobe After Effects 2021/aerender'
    ];

let aerenderFound = false;
for (const loc of aerenderLocations) {
    if (fs.existsSync(loc)) {
        console.log(`  Found: ${loc}\n`);
        aerenderFound = true;
        break;
    }
}
if (!aerenderFound) {
    console.log('  aerender not found at default locations');
    console.log('  You may need to configure the path in Settings\n');
}

// Done
console.log('========================================');
console.log('Setup Complete!');
console.log('========================================\n');
console.log('Next steps:');
console.log('  1. Start the worker:');
console.log('     cd worker && npm start\n');
console.log('  2. Restart After Effects\n');
console.log('  3. Open Window > Extensions > Pulse\n');
console.log('Troubleshooting:');
console.log('  - If extension doesn\'t appear, restart AE');
console.log('  - Check CEP debug console for errors');
console.log('  - Ensure AE version is CC 2019 or later\n');
