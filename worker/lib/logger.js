/**
 * Pulse Worker Logger
 * Logs to console and file
 */

const fs = require('fs');
const path = require('path');

class Logger {
    constructor() {
        this.logFile = null;
        this.logDir = null;
    }

    /**
     * Initialize logger with cache directory
     */
    init(cacheDir) {
        this.logDir = cacheDir;
        this.logFile = path.join(cacheDir, 'pulse.log');

        // Ensure cache directory exists
        if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir, { recursive: true });
        }

        this.info('Logger initialized');
    }

    /**
     * Format log entry
     */
    format(level, message, data) {
        const timestamp = new Date().toISOString();
        let entry = `[${timestamp}] [${level.toUpperCase()}] ${message}`;

        if (data) {
            if (typeof data === 'object') {
                entry += ' ' + JSON.stringify(data);
            } else {
                entry += ' ' + data;
            }
        }

        return entry;
    }

    /**
     * Write to log file
     */
    writeToFile(entry) {
        if (this.logFile) {
            try {
                fs.appendFileSync(this.logFile, entry + '\n');
            } catch (err) {
                console.error('Failed to write to log file:', err.message);
            }
        }
    }

    /**
     * Log info message
     */
    info(message, data) {
        const entry = this.format('info', message, data);
        console.log(entry);
        this.writeToFile(entry);
    }

    /**
     * Log warning message
     */
    warn(message, data) {
        const entry = this.format('warn', message, data);
        console.warn(entry);
        this.writeToFile(entry);
    }

    /**
     * Log error message
     */
    error(message, data) {
        const entry = this.format('error', message, data);
        console.error(entry);
        this.writeToFile(entry);
    }

    /**
     * Log debug message
     */
    debug(message, data) {
        const entry = this.format('debug', message, data);
        console.log(entry);
        // Only write debug to file if verbose
        // this.writeToFile(entry);
    }
}

module.exports = new Logger();
