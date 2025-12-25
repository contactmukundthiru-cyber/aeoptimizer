#!/usr/bin/env node

/**
 * Pulse for After Effects - Beta Installer
 *
 * Simple installer for beta testers. No admin rights required.
 *
 * Usage:
 *   node install-beta.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const { execSync } = require('child_process');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function ask(question) {
    return new Promise(resolve => {
        rl.question(question, resolve);
    });
}

function copyRecursive(src, dest) {
    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
    }

    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            copyRecursive(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

async function main() {
    console.log('');
    console.log('╔══════════════════════════════════════════╗');
    console.log('║   Pulse for After Effects - Installer    ║');
    console.log('║              Beta v1.0.0                 ║');
    console.log('╚══════════════════════════════════════════╝');
    console.log('');

    const platform = os.platform();
    const projectDir = path.resolve(__dirname, '..');
    const cepDir = path.join(projectDir, 'cep-extension');
    const workerDir = path.join(projectDir, 'worker');

    // Determine CEP extensions directory
    let cepExtensionsDir;
    if (platform === 'darwin') {
        cepExtensionsDir = path.join(os.homedir(), 'Library', 'Application Support', 'Adobe', 'CEP', 'extensions');
    } else if (platform === 'win32') {
        cepExtensionsDir = path.join(process.env.APPDATA, 'Adobe', 'CEP', 'extensions');
    } else {
        cepExtensionsDir = path.join(os.homedir(), '.config', 'Adobe', 'CEP', 'extensions');
    }

    const extensionDest = path.join(cepExtensionsDir, 'com.pulse.aeoptimizer');

    console.log('This installer will:');
    console.log('  1. Enable CEP debug mode (required for unsigned extensions)');
    console.log('  2. Install the Pulse extension for After Effects');
    console.log('  3. Install Node.js dependencies for the worker');
    console.log('');
    console.log(`Platform: ${platform === 'darwin' ? 'macOS' : platform === 'win32' ? 'Windows' : 'Linux'}`);
    console.log(`Install location: ${extensionDest}`);
    console.log('');

    const proceed = await ask('Continue? (y/n): ');
    if (proceed.toLowerCase() !== 'y') {
        console.log('Installation cancelled.');
        rl.close();
        process.exit(0);
    }

    console.log('');

    // Step 1: Enable debug mode
    console.log('[1/4] Enabling CEP debug mode...');
    try {
        if (platform === 'darwin') {
            for (const version of [11, 10, 9, 8]) {
                try {
                    execSync(`defaults write com.adobe.CSXS.${version} PlayerDebugMode 1`, { stdio: 'pipe' });
                } catch (e) {}
            }
            console.log('      Debug mode enabled for CSXS 8-11');
        } else if (platform === 'win32') {
            for (const version of [11, 10, 9, 8]) {
                try {
                    execSync(`reg add "HKCU\\Software\\Adobe\\CSXS.${version}" /v PlayerDebugMode /t REG_SZ /d 1 /f`, { stdio: 'pipe' });
                } catch (e) {}
            }
            console.log('      Debug mode enabled for CSXS 8-11');
        } else {
            console.log('      Note: On Linux, debug mode may need to be set manually');
        }
    } catch (error) {
        console.log('      Warning: Could not set debug mode automatically');
        console.log('      You may need to set it manually after installation');
    }

    // Step 2: Create extensions directory
    console.log('[2/4] Creating extensions directory...');
    try {
        fs.mkdirSync(cepExtensionsDir, { recursive: true });
        console.log(`      Created: ${cepExtensionsDir}`);
    } catch (error) {
        if (error.code !== 'EEXIST') {
            console.log(`      Warning: ${error.message}`);
        }
    }

    // Step 3: Copy extension files
    console.log('[3/4] Installing Pulse extension...');
    try {
        // Remove existing installation
        if (fs.existsSync(extensionDest)) {
            console.log('      Removing existing installation...');
            fs.rmSync(extensionDest, { recursive: true, force: true });
        }

        // Copy files
        copyRecursive(cepDir, extensionDest);
        console.log(`      Installed to: ${extensionDest}`);
    } catch (error) {
        console.log(`      Error: ${error.message}`);
        console.log('      Try running as administrator or manually copy the files.');
        rl.close();
        process.exit(1);
    }

    // Step 4: Install worker dependencies
    console.log('[4/4] Installing worker dependencies...');
    try {
        process.chdir(workerDir);
        execSync('npm install', { stdio: 'pipe' });
        console.log('      Dependencies installed');
    } catch (error) {
        console.log(`      Warning: npm install failed - ${error.message}`);
        console.log('      You can run "cd worker && npm install" manually later.');
    }

    console.log('');
    console.log('╔══════════════════════════════════════════╗');
    console.log('║       Installation Complete!             ║');
    console.log('╚══════════════════════════════════════════╝');
    console.log('');
    console.log('Next steps:');
    console.log('');
    console.log('  1. Start the worker (keep this running):');
    console.log(`     cd "${workerDir}"`);
    console.log('     npm start');
    console.log('');
    console.log('  2. Restart After Effects');
    console.log('');
    console.log('  3. Open Window > Extensions > Pulse');
    console.log('');
    console.log('If the extension doesn\'t appear:');
    console.log('  - Make sure After Effects is CC 2019 or later');
    console.log('  - Check that debug mode is enabled');
    console.log('  - Restart After Effects again');
    console.log('');

    rl.close();
}

main().catch(error => {
    console.error('Installation failed:', error.message);
    rl.close();
    process.exit(1);
});
