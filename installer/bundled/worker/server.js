/**
 * Pulse for After Effects - Worker Server
 * Express server for handling render jobs and token management
 */

const express = require('express');
const cors = require('cors');
const config = require('./config');
const logger = require('./lib/logger');
const tokenManager = require('./lib/tokenManager');
const renderQueue = require('./lib/renderQueue');
const aerender = require('./lib/aerender');

// Initialize Express app
const app = express();

// Middleware
app.use(cors({
    origin: true, // Allow all origins (localhost only anyway)
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type']
}));
app.use(express.json());

// Request logging
app.use((req, res, next) => {
    logger.debug(`${req.method} ${req.path}`);
    next();
});

// ==================== Routes ====================

/**
 * GET /health
 * Health check endpoint
 */
app.get('/health', (req, res) => {
    const aerenderPath = aerender.getPath();
    const aerenderAvailable = aerender.isAvailable();

    res.json({
        status: 'ok',
        version: '1.0.0',
        uptime: process.uptime(),
        aerender: {
            path: aerenderPath,
            available: aerenderAvailable
        },
        queue: renderQueue.getStatus(),
        config: {
            cacheDir: config.cacheDir,
            format: config.format,
            concurrency: config.concurrency
        }
    });
});

/**
 * POST /config
 * Update worker configuration
 */
app.post('/config', (req, res) => {
    try {
        const { cacheDir, format, concurrency, aerenderPath } = req.body;

        config.update({
            cacheDir,
            format,
            concurrency,
            aerenderPath
        });

        // Re-initialize managers with new config
        if (cacheDir) {
            logger.init(cacheDir);
            tokenManager.init(cacheDir);
        }

        logger.info('Configuration updated', req.body);

        res.json({
            success: true,
            config: {
                cacheDir: config.cacheDir,
                format: config.format,
                concurrency: config.concurrency,
                aerenderPath: config.aerenderPath
            }
        });
    } catch (err) {
        logger.error('Failed to update config:', err.message);
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

/**
 * GET /tokens
 * List all tokens
 */
app.get('/tokens', (req, res) => {
    try {
        const tokens = tokenManager.getAllTokens();
        res.json({
            success: true,
            count: tokens.length,
            tokens: tokens
        });
    } catch (err) {
        logger.error('Failed to get tokens:', err.message);
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

/**
 * POST /token/create
 * Create a new token from comp summary
 */
app.post('/token/create', (req, res) => {
    try {
        const { compName, precompName, layerIndex, frameRate, duration, width, height, summary } = req.body;

        if (!precompName || !summary) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: precompName, summary'
            });
        }

        const token = tokenManager.createToken({
            compName,
            precompName,
            layerIndex,
            frameRate,
            duration,
            width,
            height,
            summary
        });

        res.json({
            success: true,
            tokenId: token.tokenId,
            token: token
        });
    } catch (err) {
        logger.error('Failed to create token:', err.message);
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

/**
 * POST /token/render
 * Queue a token for rendering
 */
app.post('/token/render', (req, res) => {
    try {
        const { tokenId, projectPath } = req.body;

        if (!tokenId || !projectPath) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: tokenId, projectPath'
            });
        }

        const token = tokenManager.getToken(tokenId);
        if (!token) {
            return res.status(404).json({
                success: false,
                error: `Token not found: ${tokenId}`
            });
        }

        // Check aerender availability
        if (!aerender.isAvailable()) {
            return res.status(503).json({
                success: false,
                error: 'aerender not available. Please configure the aerender path.'
            });
        }

        // Ensure render directory exists
        tokenManager.ensureRenderDir(tokenId);

        // Add to queue
        const queued = renderQueue.enqueue(tokenId, projectPath);

        res.json({
            success: true,
            queued: queued,
            queue: renderQueue.getStatus()
        });
    } catch (err) {
        logger.error('Failed to queue render:', err.message);
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

/**
 * POST /token/swapin
 * Mark token as swapped in
 */
app.post('/token/swapin', (req, res) => {
    try {
        const { tokenId } = req.body;

        if (!tokenId) {
            return res.status(400).json({
                success: false,
                error: 'Missing required field: tokenId'
            });
        }

        const token = tokenManager.updateStatus(tokenId, 'swapped');

        if (!token) {
            return res.status(404).json({
                success: false,
                error: `Token not found: ${tokenId}`
            });
        }

        res.json({
            success: true,
            token: token
        });
    } catch (err) {
        logger.error('Failed to mark swap in:', err.message);
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

/**
 * POST /token/swapback
 * Mark token as swapped back (ready for re-swap)
 */
app.post('/token/swapback', (req, res) => {
    try {
        const { tokenId } = req.body;

        if (!tokenId) {
            return res.status(400).json({
                success: false,
                error: 'Missing required field: tokenId'
            });
        }

        const token = tokenManager.updateStatus(tokenId, 'ready');

        if (!token) {
            return res.status(404).json({
                success: false,
                error: `Token not found: ${tokenId}`
            });
        }

        res.json({
            success: true,
            token: token
        });
    } catch (err) {
        logger.error('Failed to mark swap back:', err.message);
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

/**
 * POST /token/dirty
 * Mark token as dirty (needs re-render)
 */
app.post('/token/dirty', (req, res) => {
    try {
        const { tokenId } = req.body;

        if (!tokenId) {
            return res.status(400).json({
                success: false,
                error: 'Missing required field: tokenId'
            });
        }

        const token = tokenManager.markDirty(tokenId);

        if (!token) {
            return res.status(404).json({
                success: false,
                error: `Token not found: ${tokenId}`
            });
        }

        res.json({
            success: true,
            token: token
        });
    } catch (err) {
        logger.error('Failed to mark dirty:', err.message);
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

/**
 * GET /queue
 * Get render queue status
 */
app.get('/queue', (req, res) => {
    res.json({
        success: true,
        ...renderQueue.getStatus()
    });
});

/**
 * POST /queue/cancel
 * Cancel a render job
 */
app.post('/queue/cancel', (req, res) => {
    try {
        const { tokenId } = req.body;

        if (!tokenId) {
            return res.status(400).json({
                success: false,
                error: 'Missing required field: tokenId'
            });
        }

        const cancelled = renderQueue.cancel(tokenId);

        res.json({
            success: cancelled,
            message: cancelled ? 'Render cancelled' : 'Token not found in queue or rendering'
        });
    } catch (err) {
        logger.error('Failed to cancel render:', err.message);
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Not found'
    });
});

// Error handler
app.use((err, req, res, next) => {
    logger.error('Server error:', err.message);
    res.status(500).json({
        success: false,
        error: err.message
    });
});

// ==================== Server Startup ====================

function startServer() {
    // Initialize components
    logger.init(config.cacheDir);
    tokenManager.init(config.cacheDir);

    // Log startup info
    logger.info('========================================');
    logger.info('Pulse Worker Starting');
    logger.info('========================================');
    logger.info(`Cache directory: ${config.cacheDir}`);
    logger.info(`Format: ${config.format}`);
    logger.info(`Concurrency: ${config.concurrency}`);

    const aerenderPath = aerender.getPath();
    if (aerenderPath) {
        logger.info(`aerender: ${aerenderPath}`);
    } else {
        logger.warn('aerender: NOT FOUND - please configure path');
    }

    // Start server
    const server = app.listen(config.port, config.host, () => {
        logger.info(`Server listening on http://${config.host}:${config.port}`);
        logger.info('========================================');
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
        logger.info('SIGTERM received, shutting down...');
        server.close(() => {
            logger.info('Server closed');
            process.exit(0);
        });
    });

    process.on('SIGINT', () => {
        logger.info('SIGINT received, shutting down...');
        server.close(() => {
            logger.info('Server closed');
            process.exit(0);
        });
    });
}

// Start the server
startServer();
