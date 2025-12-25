/**
 * Pulse Render Queue
 * Manages render job queue with concurrency control
 */

const logger = require('./logger');
const tokenManager = require('./tokenManager');
const aerender = require('./aerender');
const config = require('../config');

class RenderQueue {
    constructor() {
        this.queue = [];
        this.processing = false;
    }

    /**
     * Add a render job to the queue
     */
    enqueue(tokenId, projectPath) {
        // Check if already in queue
        if (this.queue.some(job => job.tokenId === tokenId)) {
            logger.warn(`Token ${tokenId} already in queue`);
            return false;
        }

        // Check if already rendering
        if (aerender.isRendering(tokenId)) {
            logger.warn(`Token ${tokenId} is already rendering`);
            return false;
        }

        this.queue.push({
            tokenId,
            projectPath,
            addedAt: new Date().toISOString()
        });

        logger.info(`Added ${tokenId} to render queue (position: ${this.queue.length})`);

        // Start processing if not already
        this.processQueue();

        return true;
    }

    /**
     * Process the render queue
     */
    async processQueue() {
        if (this.processing) return;
        this.processing = true;

        while (this.queue.length > 0) {
            // Check concurrency limit
            if (aerender.getActiveCount() >= config.concurrency) {
                logger.debug('Concurrency limit reached, waiting...');
                await this.sleep(1000);
                continue;
            }

            const job = this.queue.shift();
            if (!job) continue;

            const token = tokenManager.getToken(job.tokenId);
            if (!token) {
                logger.warn(`Token not found for job: ${job.tokenId}`);
                continue;
            }

            // Update status to rendering
            tokenManager.updateStatus(job.tokenId, 'rendering');

            try {
                // Start render (don't await - allow concurrent renders)
                this.executeRender(job, token);
            } catch (err) {
                logger.error(`Failed to start render for ${job.tokenId}:`, err.message);
                tokenManager.updateStatus(job.tokenId, 'pending', { error: err.message });
            }

            // Small delay between starting renders
            await this.sleep(100);
        }

        this.processing = false;
    }

    /**
     * Execute a render job
     */
    async executeRender(job, token) {
        try {
            logger.info(`Starting render: ${job.tokenId}`);

            const result = await aerender.render(token, job.projectPath);

            if (result.success) {
                tokenManager.updateStatus(job.tokenId, 'ready', {
                    renderPath: result.renderPath,
                    renderDuration: result.duration
                });
                logger.info(`Render complete: ${job.tokenId}`);
            }
        } catch (err) {
            logger.error(`Render failed for ${job.tokenId}:`, err.message);
            tokenManager.updateStatus(job.tokenId, 'dirty', {
                error: err.message,
                lastError: new Date().toISOString()
            });
        }
    }

    /**
     * Get queue status
     */
    getStatus() {
        return {
            queueLength: this.queue.length,
            activeRenders: aerender.getActiveCount(),
            maxConcurrency: config.concurrency,
            queue: this.queue.map(job => ({
                tokenId: job.tokenId,
                addedAt: job.addedAt
            }))
        };
    }

    /**
     * Cancel a queued or active render
     */
    cancel(tokenId) {
        // Remove from queue
        const queueIndex = this.queue.findIndex(job => job.tokenId === tokenId);
        if (queueIndex !== -1) {
            this.queue.splice(queueIndex, 1);
            logger.info(`Removed ${tokenId} from queue`);
            return true;
        }

        // Cancel active render
        if (aerender.cancel(tokenId)) {
            tokenManager.updateStatus(tokenId, 'pending', { cancelled: true });
            return true;
        }

        return false;
    }

    /**
     * Clear the queue
     */
    clear() {
        const count = this.queue.length;
        this.queue = [];
        logger.info(`Cleared ${count} jobs from queue`);
        return count;
    }

    /**
     * Sleep utility
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = new RenderQueue();
