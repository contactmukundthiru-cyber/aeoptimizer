/**
 * Pulse aerender Integration
 * Handles invocation of Adobe After Effects aerender
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');
const config = require('../config');

class Aerender {
    constructor() {
        this.activeProcesses = new Map();
    }

    /**
     * Get aerender path
     */
    getPath() {
        return config.getAerenderPath();
    }

    /**
     * Check if aerender is available
     */
    isAvailable() {
        const aerenderPath = this.getPath();
        if (!aerenderPath) {
            logger.warn('aerender path not found - auto-detection failed');
            return false;
        }

        if (!fs.existsSync(aerenderPath)) {
            logger.warn('aerender executable not found at path:', aerenderPath);
            return false;
        }

        return true;
    }

    /**
     * Get the format-specific output module settings
     * Uses built-in output modules that exist in all AE installations
     */
    getOutputModuleArgs(format) {
        // These are built-in output modules available in all AE versions
        switch (format.toLowerCase()) {
            case 'png':
                // Use Lossless with Alpha - universally available
                return ['-OMtemplate', 'Lossless with Alpha'];
            case 'exr':
                // OpenEXR is available if the plugin is installed
                return ['-OMtemplate', 'OpenEXR'];
            case 'tiff':
                return ['-OMtemplate', 'TIFF Sequence with Alpha'];
            default:
                // Fallback to lossless
                return ['-OMtemplate', 'Lossless with Alpha'];
        }
    }

    /**
     * Build aerender arguments for rendering a composition
     * Uses direct command-line args to avoid template dependency issues
     */
    buildArgs(options) {
        const args = [];

        // Project file (required)
        args.push('-project', options.projectPath);

        // Composition to render (required)
        args.push('-comp', options.precompName);

        // Output path - aerender uses [#####] for frame padding
        args.push('-output', options.outputPath);

        // Render settings - use "Best Settings" which is a default template
        // If it doesn't exist, AE will use current render settings
        args.push('-RStemplate', 'Best Settings');

        // Output module - try to use a reliable default
        // "Lossless with Alpha" exists in all AE versions
        const omArgs = this.getOutputModuleArgs(options.format || 'png');
        args.push(...omArgs);

        // Sound off - we don't need audio for cached precomps
        args.push('-sound', 'OFF');

        // Memory usage - be conservative to avoid crashes
        // First number: image cache %, Second number: max memory %
        args.push('-mem_usage', '50', '70');

        // Don't render at lower than full resolution
        args.push('-reuse');

        // Continue on missing footage (don't fail entire render)
        args.push('-continueOnMissingFootage');

        // Close project when done (clean up)
        args.push('-close', 'DO_NOT_SAVE_CHANGES');

        return args;
    }

    /**
     * Render a token
     * Returns a promise that resolves when render completes
     */
    render(token, projectPath) {
        return new Promise((resolve, reject) => {
            const aerenderPath = this.getPath();

            if (!aerenderPath) {
                reject(new Error('aerender path not configured. Go to Settings and set the aerender path.'));
                return;
            }

            if (!fs.existsSync(aerenderPath)) {
                reject(new Error(`aerender not found at: ${aerenderPath}`));
                return;
            }

            if (!projectPath) {
                reject(new Error('Project path is required'));
                return;
            }

            if (!fs.existsSync(projectPath)) {
                reject(new Error(`Project file not found: ${projectPath}`));
                return;
            }

            // Ensure output directory exists
            if (!fs.existsSync(token.renderDir)) {
                fs.mkdirSync(token.renderDir, { recursive: true });
            }

            // Build output path with frame padding
            // AE uses [#####] format for 5-digit padding
            const outputPath = path.join(token.renderDir, 'frame_[#####].png');

            const args = this.buildArgs({
                projectPath: projectPath,
                precompName: token.precompName,
                outputPath: outputPath,
                format: config.format || 'png'
            });

            logger.info(`Starting aerender for ${token.tokenId}`);
            logger.info(`  Project: ${projectPath}`);
            logger.info(`  Comp: ${token.precompName}`);
            logger.info(`  Output: ${token.renderDir}`);
            logger.debug('aerender command:', `"${aerenderPath}" ${args.join(' ')}`);

            const startTime = Date.now();

            // Spawn aerender process
            const process = spawn(aerenderPath, args, {
                stdio: ['ignore', 'pipe', 'pipe'],
                windowsHide: true,
                // Set working directory to project directory for relative paths
                cwd: path.dirname(projectPath)
            });

            this.activeProcesses.set(token.tokenId, process);

            let stdout = '';
            let stderr = '';
            let lastProgressLog = 0;

            process.stdout.on('data', (data) => {
                stdout += data.toString();

                // Parse and log progress
                const lines = data.toString().split('\n');
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;

                    // Log progress every 5 seconds max to avoid spam
                    const now = Date.now();
                    if (trimmed.includes('PROGRESS:') || trimmed.includes('Finished Comp')) {
                        if (now - lastProgressLog > 5000) {
                            logger.info(`[${token.tokenId}] ${trimmed}`);
                            lastProgressLog = now;
                        }
                    } else if (trimmed.includes('ERROR') || trimmed.includes('Error')) {
                        logger.error(`[${token.tokenId}] ${trimmed}`);
                    }
                }
            });

            process.stderr.on('data', (data) => {
                stderr += data.toString();
                // Log stderr immediately as it usually indicates problems
                const lines = data.toString().split('\n');
                for (const line of lines) {
                    if (line.trim()) {
                        logger.warn(`[${token.tokenId}] stderr: ${line.trim()}`);
                    }
                }
            });

            process.on('error', (err) => {
                this.activeProcesses.delete(token.tokenId);
                logger.error(`aerender process error for ${token.tokenId}:`, err.message);
                reject(new Error(`Failed to start aerender: ${err.message}`));
            });

            process.on('close', (code) => {
                this.activeProcesses.delete(token.tokenId);
                const duration = ((Date.now() - startTime) / 1000).toFixed(1);

                // Save full output log
                try {
                    const logPath = path.join(token.renderDir, 'render.log');
                    fs.writeFileSync(logPath, `Exit code: ${code}\n\n=== STDOUT ===\n${stdout}\n\n=== STDERR ===\n${stderr}`);
                } catch (e) {
                    logger.warn('Could not save render log:', e.message);
                }

                if (code === 0) {
                    // Verify output exists - look for first frame
                    const firstFramePath = this.findFirstFrame(token.renderDir);

                    if (firstFramePath) {
                        logger.info(`Render complete for ${token.tokenId} in ${duration}s`);
                        logger.info(`  First frame: ${firstFramePath}`);
                        resolve({
                            success: true,
                            renderPath: firstFramePath,
                            duration: parseFloat(duration)
                        });
                    } else {
                        logger.error(`Render completed but no output found for ${token.tokenId}`);
                        logger.error('Check render.log in:', token.renderDir);
                        reject(new Error('Render completed but no output frames found. Check if the composition name is correct.'));
                    }
                } else {
                    logger.error(`aerender failed for ${token.tokenId} with code ${code}`);

                    // Try to extract useful error message
                    let errorMsg = `aerender exited with code ${code}`;
                    if (stderr.includes('doesn\'t exist')) {
                        errorMsg = 'Composition not found in project. Make sure the project is saved.';
                    } else if (stderr.includes('license')) {
                        errorMsg = 'After Effects license issue. Make sure AE is properly licensed.';
                    } else if (stderr.includes('memory')) {
                        errorMsg = 'Out of memory. Try reducing composition complexity.';
                    } else if (stdout.includes('Output Module')) {
                        errorMsg = 'Output module error. The default output settings may not be compatible.';
                    }

                    reject(new Error(errorMsg));
                }
            });

            // Set a timeout for very long renders (30 minutes)
            const timeout = setTimeout(() => {
                if (this.activeProcesses.has(token.tokenId)) {
                    logger.warn(`Render timeout for ${token.tokenId} after 30 minutes`);
                    this.cancel(token.tokenId);
                    reject(new Error('Render timed out after 30 minutes'));
                }
            }, 30 * 60 * 1000);

            // Clear timeout when process ends
            process.on('close', () => clearTimeout(timeout));
        });
    }

    /**
     * Find the first rendered frame in a directory
     */
    findFirstFrame(renderDir) {
        try {
            const files = fs.readdirSync(renderDir);

            // Look for common frame naming patterns
            const framePatterns = [
                /^frame_\d+\.(png|exr|tif|tiff)$/i,
                /^frames_\d+\.(png|exr|tif|tiff)$/i,
                /^\d+\.(png|exr|tif|tiff)$/i,
                /^.*_\d+\.(png|exr|tif|tiff)$/i
            ];

            const frameFiles = files.filter(f => {
                return framePatterns.some(pattern => pattern.test(f));
            }).sort();

            if (frameFiles.length > 0) {
                return path.join(renderDir, frameFiles[0]);
            }

            // Fallback: just return first image file
            const imageFiles = files.filter(f =>
                /\.(png|exr|tif|tiff|jpg|jpeg)$/i.test(f)
            ).sort();

            if (imageFiles.length > 0) {
                return path.join(renderDir, imageFiles[0]);
            }

            return null;
        } catch (err) {
            logger.error('Error finding first frame:', err.message);
            return null;
        }
    }

    /**
     * Cancel a running render
     */
    cancel(tokenId) {
        const process = this.activeProcesses.get(tokenId);
        if (process) {
            logger.info(`Cancelling render for ${tokenId}`);

            // Try graceful termination first
            process.kill('SIGTERM');

            // Force kill after 5 seconds if still running
            setTimeout(() => {
                if (this.activeProcesses.has(tokenId)) {
                    process.kill('SIGKILL');
                    this.activeProcesses.delete(tokenId);
                }
            }, 5000);

            return true;
        }
        return false;
    }

    /**
     * Check if a render is active
     */
    isRendering(tokenId) {
        return this.activeProcesses.has(tokenId);
    }

    /**
     * Get count of active renders
     */
    getActiveCount() {
        return this.activeProcesses.size;
    }

    /**
     * Get list of active render token IDs
     */
    getActiveRenders() {
        return Array.from(this.activeProcesses.keys());
    }
}

module.exports = new Aerender();
