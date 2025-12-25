/**
 * Pulse for After Effects - Panel Controller
 * Self-contained - no external worker required
 * Uses CEP's embedded Node.js for all operations
 */

(function() {
    'use strict';

    // Node.js modules (available in CEP with --enable-nodejs)
    const fs = window.cep_node ? window.cep_node.require('fs') : null;
    const path = window.cep_node ? window.cep_node.require('path') : null;
    const os = window.cep_node ? window.cep_node.require('os') : null;
    const { spawn } = window.cep_node ? window.cep_node.require('child_process') : {};
    const crypto = window.cep_node ? window.cep_node.require('crypto') : null;

    // Fallback for non-CEP environments (testing)
    const nodeAvailable = !!(fs && path && os);

    // Configuration
    const CONFIG = {
        cacheDir: null, // Set on init
        format: 'png',
        aerenderPath: null // Auto-detected
    };

    // State
    const state = {
        csInterface: null,
        tokens: {},
        draftModeActive: false,
        profilerResults: [],
        ready: false
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
                showError('CSInterface not loaded. Please restart After Effects.');
                return;
            }

            state.csInterface = new CSInterface();

            // Setup paths
            setupPaths();

            // Detect aerender
            detectAerender();

            // Load saved tokens
            loadTokens();

            // Setup UI
            setupEventListeners();

            // Test ExtendScript
            testExtendScript();

            state.ready = true;
            updateStatus('ready');
            log('success', 'Pulse ready');

        } catch (error) {
            console.error('[Pulse] Init error:', error);
            showError('Initialization failed: ' + error.message);
        }
    }

    function setupPaths() {
        if (!nodeAvailable) {
            CONFIG.cacheDir = '';
            return;
        }

        // Default cache directory
        const homeDir = os.homedir();
        CONFIG.cacheDir = path.join(homeDir, 'Pulse_Cache');

        // Create cache dir if needed
        if (!fs.existsSync(CONFIG.cacheDir)) {
            fs.mkdirSync(CONFIG.cacheDir, { recursive: true });
        }

        console.log('[Pulse] Cache directory:', CONFIG.cacheDir);
    }

    function detectAerender() {
        if (!nodeAvailable) return;

        const platform = os.platform();
        const possiblePaths = [];

        if (platform === 'win32') {
            // Windows paths
            const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
            const adobeDir = path.join(programFiles, 'Adobe');

            if (fs.existsSync(adobeDir)) {
                try {
                    const versions = fs.readdirSync(adobeDir)
                        .filter(d => d.includes('After Effects'))
                        .sort()
                        .reverse();

                    for (const ver of versions) {
                        possiblePaths.push(path.join(adobeDir, ver, 'Support Files', 'aerender.exe'));
                    }
                } catch (e) {}
            }
        } else if (platform === 'darwin') {
            // macOS paths
            const apps = '/Applications';
            if (fs.existsSync(apps)) {
                try {
                    const versions = fs.readdirSync(apps)
                        .filter(d => d.includes('Adobe After Effects'))
                        .sort()
                        .reverse();

                    for (const ver of versions) {
                        possiblePaths.push(path.join(apps, ver, 'aerender'));
                    }
                } catch (e) {}
            }
        }

        for (const p of possiblePaths) {
            if (fs.existsSync(p)) {
                CONFIG.aerenderPath = p;
                console.log('[Pulse] Found aerender:', p);
                return;
            }
        }

        console.warn('[Pulse] aerender not found');
    }

    function showError(message) {
        const app = document.getElementById('app');
        if (app) {
            app.innerHTML = `
                <div style="padding: 20px; color: #f44336;">
                    <h2>Error</h2>
                    <p>${message}</p>
                </div>
            `;
        }
    }

    function updateStatus(status) {
        const statusEl = document.getElementById('connection-status');
        const textEl = statusEl?.querySelector('.status-text');

        if (!statusEl || !textEl) return;

        statusEl.className = 'status-indicator ' + status;

        switch (status) {
            case 'ready':
                textEl.textContent = 'Ready';
                break;
            case 'busy':
                textEl.textContent = 'Working...';
                break;
            case 'error':
                textEl.textContent = 'Error';
                break;
            default:
                textEl.textContent = 'Ready';
        }
    }

    async function testExtendScript() {
        try {
            const result = await evalScript('pulse_ping()');
            if (result && result.success) {
                console.log('[Pulse] ExtendScript OK, AE:', result.aeVersion);
            }
        } catch (e) {
            console.warn('[Pulse] ExtendScript test failed:', e.message);
        }
    }

    // ==================== Event Listeners ====================

    function setupEventListeners() {
        // Tab navigation
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => switchTab(tab.dataset.tab));
        });

        // Quick Toggles
        const slider = document.getElementById('draft-aggressiveness');
        if (slider) slider.addEventListener('input', updateAggressivenessDisplay);

        addClickListener('btn-draft-enable', enableDraftMode);
        addClickListener('btn-draft-disable', disableDraftMode);
        addClickListener('btn-refresh-comp', refreshCompSummary);
        addClickListener('btn-create-token', createToken);

        // Tokens
        addClickListener('btn-refresh-tokens', renderTokensList);

        // Profiler
        addClickListener('btn-run-profiler', runProfiler);

        // Settings
        addClickListener('btn-save-settings', saveSettings);
        addClickListener('btn-open-cache', openCacheFolder);

        // Load settings into UI
        loadSettingsUI();
    }

    function addClickListener(id, handler) {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', handler);
    }

    // ==================== Tabs ====================

    function switchTab(tabId) {
        document.querySelectorAll('.tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.tab === tabId);
        });

        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.toggle('active', content.id === `tab-${tabId}`);
        });

        if (tabId === 'tokens') renderTokensList();
    }

    // ==================== ExtendScript ====================

    function evalScript(script) {
        return new Promise((resolve, reject) => {
            if (!state.csInterface) {
                reject(new Error('CSInterface not ready'));
                return;
            }

            const timeout = setTimeout(() => reject(new Error('Script timeout')), 30000);

            try {
                state.csInterface.evalScript(script, (result) => {
                    clearTimeout(timeout);

                    if (result === 'EvalScript error.' || result === 'undefined') {
                        reject(new Error('Script error'));
                        return;
                    }

                    try {
                        resolve(JSON.parse(result));
                    } catch (e) {
                        resolve(result);
                    }
                });
            } catch (e) {
                clearTimeout(timeout);
                reject(e);
            }
        });
    }

    // ==================== Draft Mode ====================

    function updateAggressivenessDisplay() {
        const slider = document.getElementById('draft-aggressiveness');
        const display = document.getElementById('aggressiveness-value');
        if (slider && display) display.textContent = slider.value;
    }

    async function enableDraftMode() {
        const slider = document.getElementById('draft-aggressiveness');
        const level = slider ? parseInt(slider.value) : 2;

        log('info', `Enabling draft mode (level ${level})...`);

        try {
            const result = await evalScript(`pulse_applyDraftMode(true, ${level})`);

            if (result?.success) {
                state.draftModeActive = true;
                document.getElementById('btn-draft-enable').disabled = true;
                document.getElementById('btn-draft-disable').disabled = false;
                document.getElementById('draft-status')?.classList.remove('hidden');
                log('success', 'Draft mode enabled');
            } else {
                log('error', result?.error || 'Failed');
            }
        } catch (e) {
            log('error', e.message);
        }
    }

    async function disableDraftMode() {
        log('info', 'Disabling draft mode...');

        try {
            const result = await evalScript('pulse_applyDraftMode(false, 0)');

            if (result?.success) {
                state.draftModeActive = false;
                document.getElementById('btn-draft-enable').disabled = false;
                document.getElementById('btn-draft-disable').disabled = true;
                document.getElementById('draft-status')?.classList.add('hidden');
                log('success', 'Draft mode disabled');
            }
        } catch (e) {
            log('error', e.message);
        }
    }

    // ==================== Comp Summary ====================

    async function refreshCompSummary() {
        try {
            const result = await evalScript('pulse_getActiveCompSummary()');
            const el = document.getElementById('comp-summary');
            if (!el) return;

            if (result?.success && result.comp) {
                const c = result.comp;
                el.innerHTML = `
                    <p><strong>${esc(c.name)}</strong></p>
                    <p>${c.width}x${c.height} @ ${c.frameRate}fps</p>
                    <p>Duration: ${c.duration.toFixed(2)}s</p>
                    <p>Layers: ${c.numLayers}</p>
                `;
            } else {
                el.innerHTML = '<p class="muted">No active composition</p>';
            }
        } catch (e) {
            log('error', e.message);
        }
    }

    // ==================== Token Management ====================

    function loadTokens() {
        if (!nodeAvailable) return;

        const tokensFile = path.join(CONFIG.cacheDir, 'tokens.json');
        try {
            if (fs.existsSync(tokensFile)) {
                state.tokens = JSON.parse(fs.readFileSync(tokensFile, 'utf8'));
            }
        } catch (e) {
            console.error('[Pulse] Failed to load tokens:', e);
            state.tokens = {};
        }
    }

    function saveTokens() {
        if (!nodeAvailable) return;

        const tokensFile = path.join(CONFIG.cacheDir, 'tokens.json');
        try {
            fs.writeFileSync(tokensFile, JSON.stringify(state.tokens, null, 2));
        } catch (e) {
            console.error('[Pulse] Failed to save tokens:', e);
        }
    }

    async function createToken() {
        log('info', 'Creating token...');

        try {
            const info = await evalScript('pulse_createPrecompToken()');

            if (!info?.success) {
                log('error', info?.error || 'Select a precomp layer first');
                return;
            }

            // Generate token ID
            const hash = nodeAvailable
                ? crypto.createHash('md5').update(info.summary).digest('hex').slice(0, 8)
                : Math.random().toString(36).slice(2, 10);

            const tokenId = `${sanitize(info.precompName)}_${hash}`;

            // Create token
            state.tokens[tokenId] = {
                tokenId,
                compName: info.compName,
                precompName: info.precompName,
                layerIndex: info.layerIndex,
                width: info.width,
                height: info.height,
                frameRate: info.frameRate,
                duration: info.duration,
                summary: info.summary,
                status: 'pending',
                renderPath: null,
                createdAt: Date.now()
            };

            saveTokens();
            log('success', `Token created: ${tokenId}`);
            renderTokensList();
            switchTab('tokens');

        } catch (e) {
            log('error', e.message);
        }
    }

    function renderTokensList() {
        const container = document.getElementById('tokens-list');
        if (!container) return;

        const tokens = Object.values(state.tokens);

        if (tokens.length === 0) {
            container.innerHTML = '<p class="muted">No tokens yet. Select a precomp and click "Create Token".</p>';
            return;
        }

        container.innerHTML = tokens.map(t => `
            <div class="token-item" data-id="${esc(t.tokenId)}">
                <div class="token-header">
                    <span class="token-name">${esc(t.precompName)}</span>
                    <span class="token-status ${t.status}">${t.status}</span>
                </div>
                <div class="token-info">
                    ${t.width}x${t.height} @ ${t.frameRate}fps
                </div>
                <div class="token-actions">
                    ${t.status === 'ready'
                        ? `<button class="btn btn-small btn-success" onclick="Pulse.swapIn('${t.tokenId}')">Swap In</button>`
                        : `<button class="btn btn-small btn-primary" onclick="Pulse.render('${t.tokenId}')">Render</button>`
                    }
                    ${t.status === 'swapped'
                        ? `<button class="btn btn-small btn-warning" onclick="Pulse.swapBack('${t.tokenId}')">Swap Back</button>`
                        : ''
                    }
                    <button class="btn btn-small btn-danger" onclick="Pulse.deleteToken('${t.tokenId}')">Delete</button>
                </div>
            </div>
        `).join('');
    }

    async function renderToken(tokenId) {
        const token = state.tokens[tokenId];
        if (!token) {
            log('error', 'Token not found');
            return;
        }

        if (!CONFIG.aerenderPath) {
            log('error', 'aerender not found. Configure in Settings.');
            return;
        }

        log('info', `Rendering ${token.precompName}...`);
        updateStatus('busy');
        token.status = 'rendering';
        saveTokens();
        renderTokensList();

        try {
            // Get project path
            const projInfo = await evalScript('pulse_getProjectPath()');
            if (!projInfo?.success) {
                throw new Error('Save your project first');
            }

            // Create output folder
            const outputDir = path.join(CONFIG.cacheDir, tokenId);
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }

            const outputPath = path.join(outputDir, `[#####].${CONFIG.format}`);

            // Build aerender command
            const args = [
                '-project', projInfo.path,
                '-comp', token.precompName,
                '-output', outputPath,
                '-OMtemplate', 'Lossless with Alpha',
                '-RStemplate', 'Best Settings',
                '-s', '0',
                '-e', String(Math.ceil(token.duration * token.frameRate) - 1)
            ];

            // Run aerender
            await runAerender(args);

            token.status = 'ready';
            token.renderPath = outputDir;
            saveTokens();
            log('success', `Render complete: ${token.precompName}`);

        } catch (e) {
            token.status = 'error';
            saveTokens();
            log('error', `Render failed: ${e.message}`);
        } finally {
            updateStatus('ready');
            renderTokensList();
        }
    }

    function runAerender(args) {
        return new Promise((resolve, reject) => {
            if (!nodeAvailable) {
                reject(new Error('Node.js not available'));
                return;
            }

            console.log('[Pulse] Running aerender:', args.join(' '));

            const proc = spawn(CONFIG.aerenderPath, args);

            let output = '';
            proc.stdout.on('data', d => { output += d; });
            proc.stderr.on('data', d => { output += d; });

            proc.on('close', code => {
                if (code === 0) {
                    resolve(output);
                } else {
                    reject(new Error(`aerender exited with code ${code}`));
                }
            });

            proc.on('error', reject);
        });
    }

    async function swapIn(tokenId) {
        const token = state.tokens[tokenId];
        if (!token || !token.renderPath) {
            log('error', 'Render the token first');
            return;
        }

        log('info', `Swapping in ${token.precompName}...`);

        try {
            const renderPath = token.renderPath.replace(/\\/g, '\\\\');
            const result = await evalScript(`pulse_swapInRender("${tokenId}", "${renderPath}")`);

            if (result?.success) {
                token.status = 'swapped';
                saveTokens();
                log('success', 'Swapped in');
                renderTokensList();
            } else {
                log('error', result?.error || 'Swap failed');
            }
        } catch (e) {
            log('error', e.message);
        }
    }

    async function swapBack(tokenId) {
        const token = state.tokens[tokenId];
        if (!token) return;

        log('info', `Restoring ${token.precompName}...`);

        try {
            const result = await evalScript(`pulse_swapBack("${tokenId}")`);

            if (result?.success) {
                token.status = 'ready';
                saveTokens();
                log('success', 'Restored');
                renderTokensList();
            }
        } catch (e) {
            log('error', e.message);
        }
    }

    function deleteToken(tokenId) {
        if (confirm('Delete this token?')) {
            delete state.tokens[tokenId];
            saveTokens();
            renderTokensList();
            log('info', 'Token deleted');
        }
    }

    // ==================== Profiler ====================

    async function runProfiler() {
        log('info', 'Running profiler...');

        try {
            const result = await evalScript('pulse_runProfiler()');

            if (result?.success) {
                state.profilerResults = result.items || [];
                renderProfilerResults();
                log('success', `Found ${state.profilerResults.length} items`);
            }
        } catch (e) {
            log('error', e.message);
        }
    }

    function renderProfilerResults() {
        const container = document.getElementById('profiler-results');
        if (!container) return;

        if (state.profilerResults.length === 0) {
            container.innerHTML = '<p class="muted">No heavy items found</p>';
            return;
        }

        const max = Math.max(...state.profilerResults.map(r => r.score));

        container.innerHTML = state.profilerResults.slice(0, 10).map(item => {
            const pct = (item.score / max) * 100;
            return `
                <div class="profiler-item">
                    <div class="profiler-info">
                        <div class="profiler-name">${esc(item.name)}</div>
                        <div class="profiler-details">${esc(item.type)}</div>
                    </div>
                    <div class="profiler-score">
                        <div class="score-bar">
                            <div class="score-fill" style="width: ${pct}%"></div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    // ==================== Settings ====================

    function loadSettingsUI() {
        setVal('setting-cache-dir', CONFIG.cacheDir);
        setVal('setting-format', CONFIG.format);
        setVal('setting-aerender', CONFIG.aerenderPath || '');
    }

    function saveSettings() {
        CONFIG.cacheDir = getVal('setting-cache-dir') || CONFIG.cacheDir;
        CONFIG.format = getVal('setting-format') || 'png';
        CONFIG.aerenderPath = getVal('setting-aerender') || CONFIG.aerenderPath;

        // Create cache dir if needed
        if (nodeAvailable && CONFIG.cacheDir && !fs.existsSync(CONFIG.cacheDir)) {
            fs.mkdirSync(CONFIG.cacheDir, { recursive: true });
        }

        log('success', 'Settings saved');
    }

    function openCacheFolder() {
        if (!nodeAvailable || !CONFIG.cacheDir) return;

        const platform = os.platform();
        const cmd = platform === 'win32' ? 'explorer' : 'open';

        require('child_process').exec(`${cmd} "${CONFIG.cacheDir}"`);
    }

    function setVal(id, val) {
        const el = document.getElementById(id);
        if (el) el.value = val || '';
    }

    function getVal(id) {
        const el = document.getElementById(id);
        return el ? el.value : '';
    }

    // ==================== Utilities ====================

    function esc(str) {
        if (typeof str !== 'string') return str;
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function sanitize(str) {
        return str.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32);
    }

    function log(level, msg) {
        const area = document.getElementById('log-area');
        if (!area) {
            console.log(`[Pulse] ${msg}`);
            return;
        }

        const time = new Date().toLocaleTimeString();
        const entry = document.createElement('div');
        entry.className = `log-entry ${level}`;
        entry.textContent = `[${time}] ${msg}`;
        area.appendChild(entry);
        area.scrollTop = area.scrollHeight;

        while (area.children.length > 50) {
            area.removeChild(area.firstChild);
        }

        console.log(`[Pulse] [${level}] ${msg}`);
    }

    // Expose global API for button onclick handlers
    window.Pulse = {
        render: renderToken,
        swapIn: swapIn,
        swapBack: swapBack,
        deleteToken: deleteToken
    };

})();
