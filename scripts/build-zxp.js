#!/usr/bin/env node

/**
 * Pulse for After Effects - ZXP Build Script
 *
 * This script packages the CEP extension into a ZXP file for distribution.
 *
 * Requirements:
 * - ZXPSignCmd (download from Adobe)
 *   https://github.com/AdobeHIDevs/ZXPSignCMD/releases
 *
 * Usage:
 *   node scripts/build-zxp.js
 *
 * For unsigned (development) builds:
 *   node scripts/build-zxp.js --unsigned
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const os = require('os');

// Configuration
const config = {
    extensionId: 'com.pulse.aeoptimizer',
    extensionName: 'Pulse',
    version: '1.0.0',
    sourceDir: path.resolve(__dirname, '..', 'cep-extension'),
    outputDir: path.resolve(__dirname, '..', 'dist'),
    outputFile: 'Pulse-1.0.0.zxp'
};

// Parse arguments
const args = process.argv.slice(2);
const unsigned = args.includes('--unsigned');

console.log('========================================');
console.log('Pulse for After Effects - ZXP Builder');
console.log('========================================\n');

// Ensure output directory exists
if (!fs.existsSync(config.outputDir)) {
    fs.mkdirSync(config.outputDir, { recursive: true });
}

// Find ZXPSignCmd
function findZXPSignCmd() {
    const possiblePaths = [
        // Environment variable
        process.env.ZXPSIGNCMD,
        // Common locations
        '/usr/local/bin/ZXPSignCmd',
        '/opt/ZXPSignCmd/ZXPSignCmd',
        path.join(os.homedir(), 'ZXPSignCmd', 'ZXPSignCmd'),
        // Windows
        'C:\\Program Files\\ZXPSignCmd\\ZXPSignCmd.exe',
        'C:\\ZXPSignCmd\\ZXPSignCmd.exe',
        path.join(os.homedir(), 'ZXPSignCmd', 'ZXPSignCmd.exe'),
        // macOS app bundle
        '/Applications/ZXPSignCmd.app/Contents/MacOS/ZXPSignCmd'
    ].filter(Boolean);

    for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
            return p;
        }
    }

    // Try PATH
    try {
        const result = spawnSync('which', ['ZXPSignCmd'], { encoding: 'utf8' });
        if (result.status === 0 && result.stdout.trim()) {
            return result.stdout.trim();
        }
    } catch (e) {}

    try {
        const result = spawnSync('where', ['ZXPSignCmd'], { encoding: 'utf8' });
        if (result.status === 0 && result.stdout.trim()) {
            return result.stdout.trim().split('\n')[0].trim();
        }
    } catch (e) {}

    return null;
}

// Create self-signed certificate for development
function createSelfSignedCert(certPath, password) {
    const zxpSignCmd = findZXPSignCmd();
    if (!zxpSignCmd) {
        throw new Error('ZXPSignCmd not found. Cannot create certificate.');
    }

    console.log('Creating self-signed certificate...');

    const args = [
        '-selfSignedCert',
        'US',                    // Country
        'California',            // State
        'Pulse',                 // Organization
        'Pulse',                 // Common Name
        password,
        certPath
    ];

    try {
        execSync(`"${zxpSignCmd}" ${args.join(' ')}`, { stdio: 'inherit' });
        console.log('Certificate created:', certPath);
        return true;
    } catch (error) {
        console.error('Failed to create certificate:', error.message);
        return false;
    }
}

// Package as ZXP
function packageZXP(signCmd, sourceDir, outputPath, certPath, password) {
    console.log('\nPackaging ZXP...');
    console.log('  Source:', sourceDir);
    console.log('  Output:', outputPath);

    const args = [
        '-sign',
        sourceDir,
        outputPath,
        certPath,
        password
    ];

    try {
        execSync(`"${signCmd}" ${args.join(' ')}`, { stdio: 'inherit' });
        console.log('\nZXP created successfully:', outputPath);
        return true;
    } catch (error) {
        console.error('Failed to create ZXP:', error.message);
        return false;
    }
}

// Create unsigned package (just a zip)
function createUnsignedPackage(sourceDir, outputPath) {
    console.log('\nCreating unsigned package (ZIP)...');
    console.log('  Source:', sourceDir);

    const zipPath = outputPath.replace('.zxp', '.zip');

    try {
        // Use built-in zip on Unix or PowerShell on Windows
        if (os.platform() === 'win32') {
            const psScript = `Compress-Archive -Path "${sourceDir}\\*" -DestinationPath "${zipPath}" -Force`;
            execSync(`powershell -Command "${psScript}"`, { stdio: 'inherit' });
        } else {
            execSync(`cd "${sourceDir}" && zip -r "${zipPath}" .`, { stdio: 'inherit' });
        }

        console.log('\nUnsigned package created:', zipPath);
        console.log('\nNote: For beta testing, testers should:');
        console.log('  1. Unzip this file');
        console.log('  2. Copy contents to the CEP extensions folder');
        console.log('  3. Enable PlayerDebugMode in registry/defaults');
        return true;
    } catch (error) {
        console.error('Failed to create package:', error.message);
        return false;
    }
}

// Main
async function main() {
    const outputPath = path.join(config.outputDir, config.outputFile);

    if (unsigned) {
        console.log('Creating unsigned package for development...\n');
        createUnsignedPackage(config.sourceDir, outputPath);
        return;
    }

    const zxpSignCmd = findZXPSignCmd();
    if (!zxpSignCmd) {
        console.log('ZXPSignCmd not found.');
        console.log('\nTo create signed ZXP packages, download ZXPSignCmd from:');
        console.log('https://github.com/AdobeHIDevs/ZXPSignCMD/releases\n');
        console.log('Then set ZXPSIGNCMD environment variable to the path.\n');
        console.log('Creating unsigned package instead...\n');
        createUnsignedPackage(config.sourceDir, outputPath);
        return;
    }

    console.log('Found ZXPSignCmd:', zxpSignCmd);

    // Certificate setup
    const certDir = path.join(config.outputDir, 'certs');
    const certPath = path.join(certDir, 'pulse-dev.p12');
    const certPassword = 'pulse-dev-2024';

    if (!fs.existsSync(certDir)) {
        fs.mkdirSync(certDir, { recursive: true });
    }

    // Create certificate if it doesn't exist
    if (!fs.existsSync(certPath)) {
        if (!createSelfSignedCert(certPath, certPassword)) {
            console.log('Falling back to unsigned package...');
            createUnsignedPackage(config.sourceDir, outputPath);
            return;
        }
    }

    // Package the extension
    if (!packageZXP(zxpSignCmd, config.sourceDir, outputPath, certPath, certPassword)) {
        console.log('ZXP packaging failed. Creating unsigned package...');
        createUnsignedPackage(config.sourceDir, outputPath);
    }
}

main().catch(console.error);
