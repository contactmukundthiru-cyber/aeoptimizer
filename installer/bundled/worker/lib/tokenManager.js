/**
 * Pulse Token Manager
 * Manages render tokens, hashing, and state
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

class TokenManager {
    constructor() {
        this.tokens = new Map();
        this.cacheDir = null;
    }

    /**
     * Initialize with cache directory
     */
    init(cacheDir) {
        this.cacheDir = cacheDir;
        this.rendersDir = path.join(cacheDir, 'Pulse_Renders');

        // Ensure renders directory exists
        if (!fs.existsSync(this.rendersDir)) {
            fs.mkdirSync(this.rendersDir, { recursive: true });
        }

        // Load existing tokens from disk
        this.loadTokens();
    }

    /**
     * Generate hash from comp summary
     */
    generateHash(summary) {
        const data = JSON.stringify(summary);
        return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16);
    }

    /**
     * Create a new token
     */
    createToken(tokenData) {
        const hash = this.generateHash(tokenData.summary);
        const tokenId = `${tokenData.precompName.replace(/[^a-zA-Z0-9]/g, '_')}_${hash}`;

        // Check if token already exists
        if (this.tokens.has(tokenId)) {
            const existing = this.tokens.get(tokenId);
            logger.info(`Token already exists: ${tokenId}`, { status: existing.status });
            return existing;
        }

        const token = {
            tokenId: tokenId,
            hash: hash,
            compName: tokenData.compName,
            precompName: tokenData.precompName,
            layerIndex: tokenData.layerIndex,
            frameRate: tokenData.frameRate,
            duration: tokenData.duration,
            width: tokenData.width,
            height: tokenData.height,
            status: 'pending', // pending, rendering, ready, dirty, swapped
            renderPath: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        // Calculate render output path
        token.renderDir = path.join(this.rendersDir, tokenId);
        token.renderPath = path.join(token.renderDir, 'frames_[#####].png');
        token.renderFirstFrame = path.join(token.renderDir, 'frames_00001.png');

        this.tokens.set(tokenId, token);
        this.saveTokens();

        logger.info(`Token created: ${tokenId}`);
        return token;
    }

    /**
     * Get token by ID
     */
    getToken(tokenId) {
        return this.tokens.get(tokenId);
    }

    /**
     * Get all tokens
     */
    getAllTokens() {
        return Array.from(this.tokens.values());
    }

    /**
     * Update token status
     */
    updateStatus(tokenId, status, extra = {}) {
        const token = this.tokens.get(tokenId);
        if (!token) {
            logger.warn(`Token not found: ${tokenId}`);
            return null;
        }

        token.status = status;
        token.updatedAt = new Date().toISOString();

        // Merge extra properties
        Object.assign(token, extra);

        this.tokens.set(tokenId, token);
        this.saveTokens();

        logger.info(`Token ${tokenId} status updated: ${status}`);
        return token;
    }

    /**
     * Mark token as dirty (needs re-render)
     */
    markDirty(tokenId) {
        return this.updateStatus(tokenId, 'dirty');
    }

    /**
     * Check if token render exists on disk
     */
    renderExists(tokenId) {
        const token = this.tokens.get(tokenId);
        if (!token) return false;

        // Check if first frame exists
        if (token.renderFirstFrame && fs.existsSync(token.renderFirstFrame)) {
            return true;
        }

        return false;
    }

    /**
     * Ensure render directory exists for token
     */
    ensureRenderDir(tokenId) {
        const token = this.tokens.get(tokenId);
        if (!token) return null;

        if (!fs.existsSync(token.renderDir)) {
            fs.mkdirSync(token.renderDir, { recursive: true });
        }

        return token.renderDir;
    }

    /**
     * Clean up render files for a token
     */
    cleanRender(tokenId) {
        const token = this.tokens.get(tokenId);
        if (!token || !token.renderDir) return;

        try {
            if (fs.existsSync(token.renderDir)) {
                const files = fs.readdirSync(token.renderDir);
                for (const file of files) {
                    fs.unlinkSync(path.join(token.renderDir, file));
                }
                fs.rmdirSync(token.renderDir);
                logger.info(`Cleaned render directory: ${tokenId}`);
            }
        } catch (err) {
            logger.error(`Failed to clean render directory: ${tokenId}`, err.message);
        }
    }

    /**
     * Save tokens to disk
     */
    saveTokens() {
        const tokensFile = path.join(this.cacheDir, 'tokens.json');
        const data = Array.from(this.tokens.entries());

        try {
            fs.writeFileSync(tokensFile, JSON.stringify(data, null, 2));
        } catch (err) {
            logger.error('Failed to save tokens:', err.message);
        }
    }

    /**
     * Load tokens from disk
     */
    loadTokens() {
        const tokensFile = path.join(this.cacheDir, 'tokens.json');

        try {
            if (fs.existsSync(tokensFile)) {
                const data = JSON.parse(fs.readFileSync(tokensFile, 'utf8'));
                this.tokens = new Map(data);

                // Validate status based on actual render files
                for (const [tokenId, token] of this.tokens) {
                    if (token.status === 'ready' && !this.renderExists(tokenId)) {
                        token.status = 'pending';
                    }
                    // Reset rendering status on restart
                    if (token.status === 'rendering') {
                        token.status = 'pending';
                    }
                }

                logger.info(`Loaded ${this.tokens.size} tokens from disk`);
            }
        } catch (err) {
            logger.error('Failed to load tokens:', err.message);
            this.tokens = new Map();
        }
    }
}

module.exports = new TokenManager();
