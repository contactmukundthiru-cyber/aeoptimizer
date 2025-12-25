/**
 * Pulse Worker Configuration
 */

const os = require('os');
const path = require('path');

// Default configuration
const config = {
    // Server settings
    host: '127.0.0.1',
    port: 3847,

    // Cache settings
    cacheDir: path.join(os.homedir(), 'Pulse_Cache'),
    format: 'png',

    // Render settings
    concurrency: 1,

    // aerender path (auto-detected if not set)
    aerenderPath: null,

    // Auto-detect aerender based on platform
    getAerenderPath: function() {
        if (this.aerenderPath) {
            return this.aerenderPath;
        }

        const platform = os.platform();

        if (platform === 'win32') {
            // Common Windows paths
            const basePaths = [
                'C:\\Program Files\\Adobe',
                'C:\\Program Files (x86)\\Adobe'
            ];

            const versions = [
                'Adobe After Effects 2025',
                'Adobe After Effects 2024',
                'Adobe After Effects 2023',
                'Adobe After Effects 2022',
                'Adobe After Effects 2021',
                'Adobe After Effects 2020',
                'Adobe After Effects CC 2019'
            ];

            const fs = require('fs');

            for (const basePath of basePaths) {
                for (const version of versions) {
                    const aerenderPath = path.join(basePath, version, 'Support Files', 'aerender.exe');
                    if (fs.existsSync(aerenderPath)) {
                        return aerenderPath;
                    }
                }
            }

            return null;
        } else if (platform === 'darwin') {
            // Common macOS paths
            const versions = [
                'Adobe After Effects 2025',
                'Adobe After Effects 2024',
                'Adobe After Effects 2023',
                'Adobe After Effects 2022',
                'Adobe After Effects 2021',
                'Adobe After Effects 2020',
                'Adobe After Effects CC 2019'
            ];

            const fs = require('fs');

            for (const version of versions) {
                const aerenderPath = `/Applications/${version}/aerender`;
                if (fs.existsSync(aerenderPath)) {
                    return aerenderPath;
                }
            }

            return null;
        }

        return null;
    },

    // Update configuration
    update: function(newConfig) {
        if (newConfig.cacheDir) this.cacheDir = newConfig.cacheDir;
        if (newConfig.format) this.format = newConfig.format;
        if (newConfig.concurrency) this.concurrency = parseInt(newConfig.concurrency) || 1;
        if (newConfig.aerenderPath) this.aerenderPath = newConfig.aerenderPath;
    }
};

module.exports = config;
