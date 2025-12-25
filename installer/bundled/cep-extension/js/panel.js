/**
 * Pulse for After Effects - Panel Controller
 * Handles UI interactions, worker communication, and ExtendScript calls
 *
 * Version 1.0.0
 */

(function() {
    'use strict';

    // Configuration
    const CONFIG = {
        workerUrl: 'http://localhost:3847',
        pollInterval: 3000,
        reconnectInterval: 5000,
        requestTimeout: 30000,
        maxRetries: 3
    };

    // State
    const state = {
        csInterface: null,
        connected: false,
        connecting: false,
        draftModeActive: false,
        tokens: [],
        profilerResults: [],
        retryCount: 0,
        lastError: null
    };

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    function init() {
        console.log('[Pulse] Initializing panel v1.0.0...');

        try {
            // Initialize CSInterface
            if (typeof CSInterface === 'undefined') {
                showFatalError('CSInterface not loaded. Please restart After Effects.');
                return;
            }

            state.csInterface = new CSInterface();

            // Test ExtendScript connection
            testExtendScriptConnection();

            // Load settings from storage
            loadSettings();

            // Setup event listeners
            setupEventListeners();

            // Check worker connection
            checkWorkerConnection();

            // Start polling for status updates
            startPolling();

            log('info', 'Panel initialized');
        } catch (error) {
            console.error('[Pulse] Initialization error:', error);
            showFatalError('Initialization failed: ' + error.message);
        }
    }

    function showFatalError(message) {
        const app = document.getElementById('app');
        if (app) {
            app.innerHTML = `
                <div style="padding: 20px; color: #f44336;">
                    <h2>Error</h2>
                    <p>${message}</p>
                    <p style="margin-top: 10px; color: #999;">Try restarting After Effects.</p>
                </div>
            `;
        }
    }

    async function testExtendScriptConnection() {
        try {
            const result = await evalScript('pulse_ping()');
            if (result && result.success) {
                console.log('[Pulse] ExtendScript connected, AE version:', result.aeVersion);
            }
        } catch (error) {
            console.warn('[Pulse] ExtendScript test failed:', error.message);
        }
    }

    // ==================== Event Listeners ====================

    function setupEventListeners() {
        // Tab navigation
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => switchTab(tab.dataset.tab));
        });

        // Quick Toggles
        const draftSlider = document.getElementById('draft-aggressiveness');
        if (draftSlider) {
            draftSlider.addEventListener('input', updateAggressivenessDisplay);
        }

        addClickListener('btn-draft-enable', enableDraftMode);
        addClickListener('btn-draft-disable', disableDraftMode);
        addClickListener('btn-refresh-comp', refreshCompSummary);
        addClickListener('btn-create-token', createTokenFromSelection);

        // Tokens
        addClickListener('btn-refresh-tokens', refreshTokens);

        // Profiler
        addClickListener('btn-run-profiler', runProfiler);

        // Settings
        addClickListener('btn-save-settings', saveSettings);
    }

    function addClickListener(id, handler) {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('click', handler);
        }
    }

    // ==================== Tab Navigation ====================

    function switchTab(tabId) {
        // Update tab buttons
        document.querySelectorAll('.tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.tab === tabId);
        });

        // Update tab content
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.toggle('active', content.id === `tab-${tabId}`);
        });

        // Refresh data when switching tabs
        if (tabId === 'tokens' && state.connected) {
            refreshTokens();
        }
    }

    // ==================== Worker Communication ====================

    async function workerRequest(method, endpoint, data = null, retries = 0) {
        const url = CONFIG.workerUrl + endpoint;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), CONFIG.requestTimeout);

        const options = {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal
        };

        if (data) {
            options.body = JSON.stringify(data);
        }

        try {
            const response = await fetch(url, options);
            clearTimeout(timeout);

            if (!response.ok) {
                const errorText = await response.text().catch(() => 'Unknown error');
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }

            const result = await response.json();

            // Reset retry count on success
            state.retryCount = 0;

            return result;
        } catch (error) {
            clearTimeout(timeout);

            if (error.name === 'AbortError') {
                throw new Error('Request timed out');
            }

            // Retry logic
            if (retries < CONFIG.maxRetries && !error.message.includes('timed out')) {
                console.log(`[Pulse] Retrying ${endpoint} (attempt ${retries + 1}/${CONFIG.maxRetries})`);
                await sleep(1000 * (retries + 1)); // Exponential backoff
                return workerRequest(method, endpoint, data, retries + 1);
            }

            console.error(`[Pulse] Worker request failed: ${endpoint}`, error);
            throw error;
        }
    }

    async function checkWorkerConnection() {
        if (state.connecting) return state.connected;

        state.connecting = true;
        setConnectionStatus('connecting');

        try {
            const result = await workerRequest('GET', '/health');

            if (!state.connected) {
                log('success', 'Connected to worker');
            }

            setConnectionStatus('connected');
            state.connected = true;
            state.retryCount = 0;
            state.lastError = null;

            // Show aerender status
            if (result.aerender && !result.aerender.available) {
                log('warning', 'aerender not found - configure path in Settings');
            }

            return true;
        } catch (error) {
            setConnectionStatus('disconnected');
            state.connected = false;
            state.retryCount++;
            state.lastError = error.message;

            if (state.retryCount === 1) {
                log('error', 'Worker not available - start it with: cd worker && npm start');
            }

            return false;
        } finally {
            state.connecting = false;
        }
    }

    function setConnectionStatus(status) {
        const statusEl = document.getElementById('connection-status');
        const textEl = statusEl?.querySelector('.status-text');

        if (!statusEl || !textEl) return;

        statusEl.classList.remove('connected', 'disconnected', 'connecting');
        statusEl.classList.add(status);

        switch (status) {
            case 'connected':
                textEl.textContent = 'Connected';
                break;
            case 'connecting':
                textEl.textContent = 'Connecting...';
                break;
            default:
                textEl.textContent = 'Disconnected';
        }
    }

    function startPolling() {
        // Check connection periodically
        setInterval(() => {
            if (!state.connected && !state.connecting) {
                checkWorkerConnection();
            }
        }, CONFIG.reconnectInterval);

        // Poll for token status updates when connected and tokens tab is active
        setInterval(() => {
            if (state.connected && document.querySelector('#tab-tokens.active')) {
                refreshTokens();
            }
        }, CONFIG.pollInterval);
    }

    // ==================== ExtendScript Communication ====================

    function evalScript(script) {
        return new Promise((resolve, reject) => {
            if (!state.csInterface) {
                reject(new Error('CSInterface not initialized'));
                return;
            }

            const timeoutId = setTimeout(() => {
                reject(new Error('ExtendScript timed out'));
            }, 30000);

            try {
                state.csInterface.evalScript(script, (result) => {
                    clearTimeout(timeoutId);

                    if (result === 'EvalScript error.' || result === 'undefined') {
                        reject(new Error('ExtendScript evaluation error. Make sure a composition is open.'));
                        return;
                    }

                    try {
                        // Try to parse as JSON, otherwise return raw result
                        const parsed = JSON.parse(result);
                        resolve(parsed);
                    } catch (e) {
                        // Return raw result if not JSON
                        resolve(result);
                    }
                });
            } catch (error) {
                clearTimeout(timeoutId);
                reject(error);
            }
        });
    }

    // ==================== Draft Mode ====================

    function updateAggressivenessDisplay() {
        const slider = document.getElementById('draft-aggressiveness');
        const display = document.getElementById('aggressiveness-value');
        if (slider && display) {
            display.textContent = slider.value;
        }
    }

    async function enableDraftMode() {
        const slider = document.getElementById('draft-aggressiveness');
        const aggressiveness = slider ? parseInt(slider.value) : 2;

        log('info', `Enabling draft mode (level ${aggressiveness})...`);

        try {
            const result = await evalScript(`pulse_applyDraftMode(true, ${aggressiveness})`);

            if (result && result.success) {
                state.draftModeActive = true;

                const btnEnable = document.getElementById('btn-draft-enable');
                const btnDisable = document.getElementById('btn-draft-disable');
                if (btnEnable) btnEnable.disabled = true;
                if (btnDisable) btnDisable.disabled = false;

                const statusEl = document.getElementById('draft-status');
                const detailsEl = document.getElementById('draft-status-details');
                if (statusEl) statusEl.classList.remove('hidden');
                if (detailsEl) detailsEl.textContent = `Level ${aggressiveness} - ${result.changes || 'Settings applied'}`;

                log('success', 'Draft mode enabled');
            } else {
                log('error', result?.error || 'Failed to enable draft mode');
            }
        } catch (error) {
            log('error', 'Draft mode error: ' + error.message);
        }
    }

    async function disableDraftMode() {
        log('info', 'Disabling draft mode...');

        try {
            const result = await evalScript('pulse_applyDraftMode(false, 0)');

            if (result && result.success) {
                state.draftModeActive = false;

                const btnEnable = document.getElementById('btn-draft-enable');
                const btnDisable = document.getElementById('btn-draft-disable');
                const statusEl = document.getElementById('draft-status');

                if (btnEnable) btnEnable.disabled = false;
                if (btnDisable) btnDisable.disabled = true;
                if (statusEl) statusEl.classList.add('hidden');

                log('success', 'Draft mode disabled, settings restored');
            } else {
                log('error', result?.error || 'Failed to disable draft mode');
            }
        } catch (error) {
            log('error', 'Draft mode error: ' + error.message);
        }
    }

    // ==================== Comp Summary ====================

    async function refreshCompSummary() {
        log('info', 'Refreshing composition summary...');

        try {
            const result = await evalScript('pulse_getActiveCompSummary()');
            const summaryEl = document.getElementById('comp-summary');

            if (!summaryEl) return;

            if (result && result.success && result.comp) {
                const comp = result.comp;
                summaryEl.innerHTML = `
                    <p><strong>${escapeHtml(comp.name)}</strong></p>
                    <p>${comp.width}x${comp.height} @ ${comp.frameRate}fps</p>
                    <p>Duration: ${comp.duration.toFixed(2)}s (${comp.numFrames} frames)</p>
                    <p>Layers: ${comp.numLayers} (${comp.numPrecomps} precomps)</p>
                `;
                log('success', 'Comp summary updated');
            } else {
                summaryEl.innerHTML = '<p class="muted">No active composition</p>';
                log('warning', result?.error || 'No active composition');
            }
        } catch (error) {
            log('error', 'Failed to get comp summary: ' + error.message);
        }
    }

    // ==================== Token Management ====================

    async function createTokenFromSelection() {
        if (!state.connected) {
            log('error', 'Worker not connected. Start worker first.');
            return;
        }

        log('info', 'Creating token from selection...');

        try {
            // Get precomp info from AE
            const precompInfo = await evalScript('pulse_createPrecompToken()');

            if (!precompInfo || !precompInfo.success) {
                log('error', precompInfo?.error || 'No valid precomp selected');
                return;
            }

            // Send to worker to create token
            const response = await workerRequest('POST', '/token/create', {
                compName: precompInfo.compName,
                precompName: precompInfo.precompName,
                layerIndex: precompInfo.layerIndex,
                frameRate: precompInfo.frameRate,
                duration: precompInfo.duration,
                width: precompInfo.width,
                height: precompInfo.height,
                summary: precompInfo.summary
            });

            log('success', `Token created: ${response.tokenId}`);
            await refreshTokens();
            switchTab('tokens');
        } catch (error) {
            log('error', 'Failed to create token: ' + error.message);
        }
    }

    async function refreshTokens() {
        if (!state.connected) return;

        try {
            const result = await workerRequest('GET', '/tokens');
            state.tokens = result.tokens || [];
            renderTokensList();
        } catch (error) {
            console.error('[Pulse] Failed to refresh tokens:', error);
        }
    }

    function renderTokensList() {
        const container = document.getElementById('tokens-list');
        if (!container) return;

        if (state.tokens.length === 0) {
            container.innerHTML = '<p class="muted">No tokens created yet. Select a precomp layer and click "Create Token".</p>';
            return;
        }

        container.innerHTML = state.tokens.map(token => `
            <div class="token-item" data-token-id="${escapeHtml(token.tokenId)}">
                <div class="token-header">
                    <span class="token-name">${escapeHtml(token.precompName)}</span>
                    <span class="token-status ${token.status}">${token.status}</span>
                </div>
                <div class="token-info">
                    ${token.width}x${token.height} @ ${token.frameRate}fps &bull; ${token.duration.toFixed(2)}s
                </div>
                <div class="token-actions">
                    ${getTokenActions(token)}
                </div>
            </div>
        `).join('');

        // Attach event listeners
        container.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', handleTokenAction);
        });
    }

    function getTokenActions(token) {
        const actions = [];
        const tokenId = escapeHtml(token.tokenId);

        switch (token.status) {
            case 'pending':
            case 'dirty':
                actions.push(`<button class="btn btn-small btn-primary" data-action="render" data-token-id="${tokenId}">Render</button>`);
                break;
            case 'rendering':
                actions.push(`<button class="btn btn-small btn-warning" disabled>Rendering...</button>`);
                break;
            case 'ready':
                actions.push(`<button class="btn btn-small btn-success" data-action="swapin" data-token-id="${tokenId}">Swap In</button>`);
                actions.push(`<button class="btn btn-small btn-secondary" data-action="render" data-token-id="${tokenId}">Re-render</button>`);
                break;
            case 'swapped':
                actions.push(`<button class="btn btn-small btn-warning" data-action="swapback" data-token-id="${tokenId}">Swap Back</button>`);
                break;
        }

        actions.push(`<button class="btn btn-small btn-secondary" data-action="dirty" data-token-id="${tokenId}">Mark Dirty</button>`);

        return actions.join('');
    }

    async function handleTokenAction(event) {
        const action = event.target.dataset.action;
        const tokenId = event.target.dataset.tokenId;

        if (!action || !tokenId) return;

        // Disable button during action
        event.target.disabled = true;

        log('info', `${action}: ${tokenId}`);

        try {
            switch (action) {
                case 'render':
                    await renderToken(tokenId);
                    break;
                case 'swapin':
                    await swapInToken(tokenId);
                    break;
                case 'swapback':
                    await swapBackToken(tokenId);
                    break;
                case 'dirty':
                    await markTokenDirty(tokenId);
                    break;
            }
        } catch (error) {
            log('error', `Failed to ${action}: ${error.message}`);
        } finally {
            event.target.disabled = false;
        }
    }

    async function renderToken(tokenId) {
        log('info', `Queueing render for ${tokenId}...`);

        // Get project path from AE
        const projectInfo = await evalScript('pulse_getProjectPath()');
        if (!projectInfo || !projectInfo.success) {
            log('error', projectInfo?.error || 'Please save the project before rendering');
            return;
        }

        const response = await workerRequest('POST', '/token/render', {
            tokenId: tokenId,
            projectPath: projectInfo.path
        });

        if (response.success) {
            log('success', 'Render queued - check worker console for progress');
        } else {
            log('error', response.error || 'Failed to queue render');
        }

        await refreshTokens();
    }

    async function swapInToken(tokenId) {
        const token = state.tokens.find(t => t.tokenId === tokenId);
        if (!token) {
            log('error', 'Token not found');
            return;
        }

        if (!token.renderPath) {
            log('error', 'No render path available. Render the token first.');
            return;
        }

        log('info', `Swapping in ${tokenId}...`);

        // Escape backslashes for ExtendScript
        const escapedPath = token.renderPath.replace(/\\/g, '\\\\');
        const result = await evalScript(`pulse_swapInRender("${tokenId}", "${escapedPath}")`);

        if (result && result.success) {
            await workerRequest('POST', '/token/swapin', { tokenId });
            log('success', 'Render swapped in');
            await refreshTokens();
        } else {
            log('error', result?.error || 'Swap in failed');
        }
    }

    async function swapBackToken(tokenId) {
        log('info', `Swapping back ${tokenId}...`);

        const result = await evalScript(`pulse_swapBack("${tokenId}")`);

        if (result && result.success) {
            await workerRequest('POST', '/token/swapback', { tokenId });
            log('success', 'Original precomp restored');
            await refreshTokens();
        } else {
            log('error', result?.error || 'Swap back failed');
        }
    }

    async function markTokenDirty(tokenId) {
        await workerRequest('POST', '/token/dirty', { tokenId });
        await evalScript(`pulse_markTokenDirty("${tokenId}")`);

        log('success', 'Token marked as dirty');
        await refreshTokens();
    }

    // ==================== Profiler ====================

    async function runProfiler() {
        log('info', 'Running profiler...');

        try {
            const result = await evalScript('pulse_runProfiler()');

            if (result && result.success) {
                state.profilerResults = result.items || [];
                renderProfilerResults();
                log('success', `Found ${state.profilerResults.length} heavy items`);
            } else {
                log('error', result?.error || 'Profiler failed');
            }
        } catch (error) {
            log('error', 'Profiler error: ' + error.message);
        }
    }

    function renderProfilerResults() {
        const container = document.getElementById('profiler-results');
        if (!container) return;

        if (state.profilerResults.length === 0) {
            container.innerHTML = '<p class="muted">No heavy items found in this composition</p>';
            return;
        }

        const maxScore = Math.max(...state.profilerResults.map(r => r.score));

        container.innerHTML = state.profilerResults.slice(0, 10).map(item => {
            const percent = (item.score / maxScore) * 100;
            const level = percent > 66 ? 'high' : percent > 33 ? 'medium' : 'low';

            return `
                <div class="profiler-item">
                    <div class="profiler-info">
                        <div class="profiler-name">${escapeHtml(item.name)}</div>
                        <div class="profiler-details">${escapeHtml(item.type)} &bull; ${escapeHtml(item.details)}</div>
                    </div>
                    <div class="profiler-score">
                        <div class="score-bar">
                            <div class="score-fill ${level}" style="width: ${percent}%"></div>
                        </div>
                        ${item.isPrecomp ?
                            `<button class="btn btn-small btn-primary" data-profiler-action="token" data-layer-index="${item.layerIndex}">Token</button>` :
                            ''}
                    </div>
                </div>
            `;
        }).join('');

        // Attach event listeners for token buttons
        container.querySelectorAll('[data-profiler-action="token"]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const layerIndex = parseInt(btn.dataset.layerIndex);
                btn.disabled = true;
                try {
                    await evalScript(`pulse_selectLayer(${layerIndex})`);
                    await createTokenFromSelection();
                } finally {
                    btn.disabled = false;
                }
            });
        });
    }

    // ==================== Settings ====================

    function loadSettings() {
        try {
            const saved = localStorage.getItem('pulse_settings');
            if (saved) {
                const settings = JSON.parse(saved);
                CONFIG.workerUrl = settings.workerUrl || CONFIG.workerUrl;

                setInputValue('setting-worker-url', CONFIG.workerUrl);
                setInputValue('setting-cache-dir', settings.cacheDir || '');
                setInputValue('setting-format', settings.format || 'png');
                setInputValue('setting-concurrency', settings.concurrency || 1);
                setInputValue('setting-aerender', settings.aerenderPath || '');
            }
        } catch (e) {
            console.error('[Pulse] Failed to load settings:', e);
        }
    }

    function setInputValue(id, value) {
        const el = document.getElementById(id);
        if (el) el.value = value;
    }

    function getInputValue(id, defaultValue = '') {
        const el = document.getElementById(id);
        return el ? el.value : defaultValue;
    }

    async function saveSettings() {
        const settings = {
            workerUrl: getInputValue('setting-worker-url', CONFIG.workerUrl),
            cacheDir: getInputValue('setting-cache-dir'),
            format: getInputValue('setting-format', 'png'),
            concurrency: parseInt(getInputValue('setting-concurrency', '1')) || 1,
            aerenderPath: getInputValue('setting-aerender')
        };

        // Save locally
        CONFIG.workerUrl = settings.workerUrl;
        localStorage.setItem('pulse_settings', JSON.stringify(settings));

        // Send to worker
        if (state.connected) {
            try {
                await workerRequest('POST', '/config', settings);
                log('success', 'Settings saved');
            } catch (error) {
                log('error', 'Failed to save to worker: ' + error.message);
            }
        } else {
            log('warning', 'Settings saved locally (worker not connected)');
        }

        // Re-check connection with new URL
        state.connected = false;
        await checkWorkerConnection();
    }

    // ==================== Utilities ====================

    function escapeHtml(str) {
        if (typeof str !== 'string') return str;
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function log(level, message) {
        const logArea = document.getElementById('log-area');
        if (!logArea) {
            console.log(`[Pulse] [${level.toUpperCase()}] ${message}`);
            return;
        }

        const timestamp = new Date().toLocaleTimeString();

        const entry = document.createElement('div');
        entry.className = `log-entry ${level}`;
        entry.textContent = `[${timestamp}] ${message}`;

        logArea.appendChild(entry);
        logArea.scrollTop = logArea.scrollHeight;

        // Keep only last 50 entries
        while (logArea.children.length > 50) {
            logArea.removeChild(logArea.firstChild);
        }

        console.log(`[Pulse] [${level.toUpperCase()}] ${message}`);
    }

})();
