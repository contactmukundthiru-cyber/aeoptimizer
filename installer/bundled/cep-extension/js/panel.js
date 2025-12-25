/**
 * Pulse for After Effects - Performance Accelerator
 *
 * Features:
 * - Auto Draft Ladder: Activity-aware quality switching
 * - Render Tokens: Smart caching with dependency hashing
 * - Predictive Pre-rendering: Render ahead of CTI
 * - Real Profiler: Cost estimation with actionable recommendations
 */

(function() {
    'use strict';

    // Node.js modules (CEP embedded Node.js)
    const fs = window.cep_node ? window.cep_node.require('fs') : null;
    const path = window.cep_node ? window.cep_node.require('path') : null;
    const os = window.cep_node ? window.cep_node.require('os') : null;
    const { spawn } = window.cep_node ? window.cep_node.require('child_process') : {};
    const crypto = window.cep_node ? window.cep_node.require('crypto') : null;

    const nodeAvailable = !!(fs && path && os);

    // ==================== Configuration ====================
    const CONFIG = {
        cacheDir: null,
        format: 'png',
        aerenderPath: null,
        autoDraft: {
            enabled: false,
            idleDelay: 400,        // ms before restoring quality
            scrubDelay: 100,       // ms of scrub before activating
            resolution: 'half',
            disableMotionBlur: true,
            disableFrameBlending: true,
            optimizeLayers: true,
            costThreshold: 40
        },
        preRender: {
            enabled: false,
            radius: 2  // seconds around CTI
        }
    };

    // ==================== State ====================
    const state = {
        csInterface: null,
        ready: false,
        tokens: {},
        compState: null,
        profilerResults: null,

        // Auto Draft state
        autoDraftActive: false,
        lastActivity: 0,
        activityTimer: null,
        idleTimer: null,
        isInteracting: false,

        // Pre-render state
        preRenderQueue: [],
        preRenderProcess: null
    };

    // ==================== Initialization ====================
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    function init() {
        console.log('[Pulse] Initializing v2.0.0...');

        try {
            if (typeof CSInterface === 'undefined') {
                showError('CSInterface not loaded');
                return;
            }

            state.csInterface = new CSInterface();

            setupPaths();
            detectAerender();
            loadConfig();
            loadTokens();
            setupEventListeners();
            setupAEEventListeners();
            testConnection();

            state.ready = true;
            updateStatus('ready');
            log('success', 'Pulse 2.0 ready');

            // Initial comp state
            refreshCompState();

        } catch (error) {
            console.error('[Pulse] Init error:', error);
            showError('Init failed: ' + error.message);
        }
    }

    function setupPaths() {
        if (!nodeAvailable) return;

        const homeDir = os.homedir();
        CONFIG.cacheDir = path.join(homeDir, 'Pulse_Cache');

        if (!fs.existsSync(CONFIG.cacheDir)) {
            fs.mkdirSync(CONFIG.cacheDir, { recursive: true });
        }
    }

    function detectAerender() {
        if (!nodeAvailable) return;

        const platform = os.platform();
        const paths = [];

        if (platform === 'win32') {
            const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
            const adobeDir = path.join(programFiles, 'Adobe');

            if (fs.existsSync(adobeDir)) {
                try {
                    fs.readdirSync(adobeDir)
                        .filter(d => d.includes('After Effects'))
                        .sort().reverse()
                        .forEach(ver => {
                            paths.push(path.join(adobeDir, ver, 'Support Files', 'aerender.exe'));
                        });
                } catch (e) {}
            }
        } else if (platform === 'darwin') {
            try {
                fs.readdirSync('/Applications')
                    .filter(d => d.includes('Adobe After Effects'))
                    .sort().reverse()
                    .forEach(ver => {
                        paths.push(path.join('/Applications', ver, 'aerender'));
                    });
            } catch (e) {}
        }

        for (const p of paths) {
            if (fs.existsSync(p)) {
                CONFIG.aerenderPath = p;
                console.log('[Pulse] aerender:', p);
                return;
            }
        }
    }

    // ==================== AE Event Listeners ====================
    function setupAEEventListeners() {
        // Listen for AE events to detect user activity
        state.csInterface.addEventListener('com.adobe.csxs.events.WindowVisibilityChanged', onVisibilityChange);

        // Poll for comp changes (CEP limitation - no direct CTI events)
        setInterval(checkCompState, 500);
    }

    function onVisibilityChange(event) {
        if (event.data === 'true') {
            refreshCompState();
        }
    }

    let lastCompTime = 0;
    let lastCompName = '';

    async function checkCompState() {
        if (!state.ready || !CONFIG.autoDraft.enabled) return;

        try {
            const result = await evalScript('pulse_getCompState()');
            if (!result?.success) return;

            const newTime = result.currentTime;
            const newName = result.name;

            // Detect scrubbing (time changed)
            if (newName === lastCompName && Math.abs(newTime - lastCompTime) > 0.01) {
                onUserActivity('scrub');
            }

            // Detect comp switch
            if (newName !== lastCompName) {
                onUserActivity('compSwitch');
            }

            lastCompTime = newTime;
            lastCompName = newName;

        } catch (e) {}
    }

    function onUserActivity(type) {
        state.lastActivity = Date.now();

        // Clear idle timer
        if (state.idleTimer) {
            clearTimeout(state.idleTimer);
            state.idleTimer = null;
        }

        // Activate draft mode if auto-draft enabled
        if (CONFIG.autoDraft.enabled && !state.autoDraftActive) {
            if (!state.activityTimer) {
                state.activityTimer = setTimeout(() => {
                    activateAutoDraft();
                    state.activityTimer = null;
                }, CONFIG.autoDraft.scrubDelay);
            }
        }

        // Set idle timer to restore quality
        state.idleTimer = setTimeout(() => {
            if (state.autoDraftActive) {
                deactivateAutoDraft();
            }
        }, CONFIG.autoDraft.idleDelay);
    }

    async function activateAutoDraft() {
        if (state.autoDraftActive) return;

        const settings = {
            resolution: CONFIG.autoDraft.resolution,
            disableMotionBlur: CONFIG.autoDraft.disableMotionBlur,
            disableFrameBlending: CONFIG.autoDraft.disableFrameBlending,
            optimizeLayers: CONFIG.autoDraft.optimizeLayers,
            costThreshold: CONFIG.autoDraft.costThreshold
        };

        try {
            const result = await evalScript(`pulse_applyDraft('${JSON.stringify(settings)}')`);
            if (result?.success) {
                state.autoDraftActive = true;
                updateAutoDraftUI(true);
                log('info', 'Auto Draft ON');
            }
        } catch (e) {
            console.error('[Pulse] Auto draft error:', e);
        }
    }

    async function deactivateAutoDraft() {
        if (!state.autoDraftActive) return;

        try {
            const result = await evalScript('pulse_restoreDraft()');
            if (result?.success) {
                state.autoDraftActive = false;
                updateAutoDraftUI(false);
                log('info', 'Auto Draft OFF - Quality restored');
            }
        } catch (e) {
            console.error('[Pulse] Restore error:', e);
        }
    }

    function updateAutoDraftUI(active) {
        const indicator = document.getElementById('auto-draft-indicator');
        if (indicator) {
            indicator.classList.toggle('active', active);
            indicator.textContent = active ? 'DRAFT' : '';
        }
    }

    // ==================== UI Event Listeners ====================
    function setupEventListeners() {
        // Tabs
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => switchTab(tab.dataset.tab));
        });

        // Auto Draft
        addClickListener('btn-auto-draft-toggle', toggleAutoDraft);
        addClickListener('btn-manual-draft', manualDraftToggle);

        // Draft settings
        ['auto-draft-resolution', 'auto-draft-motion-blur', 'auto-draft-frame-blend',
         'auto-draft-optimize-layers', 'auto-draft-threshold'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('change', saveDraftSettings);
        });

        // Tokens
        addClickListener('btn-create-token', createToken);
        addClickListener('btn-scan-tokens', scanTokenCandidates);

        // Profiler
        addClickListener('btn-run-profiler', runProfiler);

        // Settings
        addClickListener('btn-save-settings', saveSettings);
        addClickListener('btn-open-cache', openCacheFolder);

        // Load UI state
        loadUIState();
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
        if (tabId === 'profiler') refreshCompState();
    }

    // ==================== Auto Draft ====================
    function toggleAutoDraft() {
        CONFIG.autoDraft.enabled = !CONFIG.autoDraft.enabled;

        const btn = document.getElementById('btn-auto-draft-toggle');
        if (btn) {
            btn.textContent = CONFIG.autoDraft.enabled ? 'Disable Auto Draft' : 'Enable Auto Draft';
            btn.classList.toggle('btn-active', CONFIG.autoDraft.enabled);
        }

        document.getElementById('auto-draft-status')?.classList.toggle('hidden', !CONFIG.autoDraft.enabled);

        if (!CONFIG.autoDraft.enabled && state.autoDraftActive) {
            deactivateAutoDraft();
        }

        saveConfig();
        log('info', CONFIG.autoDraft.enabled ? 'Auto Draft enabled' : 'Auto Draft disabled');
    }

    async function manualDraftToggle() {
        if (state.autoDraftActive) {
            await deactivateAutoDraft();
        } else {
            await activateAutoDraft();
        }
    }

    function saveDraftSettings() {
        const res = document.getElementById('auto-draft-resolution');
        const mb = document.getElementById('auto-draft-motion-blur');
        const fb = document.getElementById('auto-draft-frame-blend');
        const ol = document.getElementById('auto-draft-optimize-layers');
        const th = document.getElementById('auto-draft-threshold');

        if (res) CONFIG.autoDraft.resolution = res.value;
        if (mb) CONFIG.autoDraft.disableMotionBlur = mb.checked;
        if (fb) CONFIG.autoDraft.disableFrameBlending = fb.checked;
        if (ol) CONFIG.autoDraft.optimizeLayers = ol.checked;
        if (th) CONFIG.autoDraft.costThreshold = parseInt(th.value) || 40;

        saveConfig();
    }

    // ==================== Render Tokens ====================
    async function createToken() {
        log('info', 'Creating token...');
        updateStatus('busy');

        try {
            const result = await evalScript('pulse_createToken()');

            if (!result?.success) {
                log('error', result?.error || 'Failed to create token');
                updateStatus('ready');
                return;
            }

            const tokenId = `${sanitize(result.precompName)}_${result.hash}`;

            // Check if token already exists with same hash
            if (state.tokens[tokenId]) {
                log('info', 'Token already exists (no changes detected)');
                updateStatus('ready');
                return;
            }

            state.tokens[tokenId] = {
                id: tokenId,
                hash: result.hash,
                precompName: result.precompName,
                layerIndex: result.layerIndex,
                width: result.width,
                height: result.height,
                frameRate: result.frameRate,
                duration: result.duration,
                frameCount: result.frameCount,
                cost: result.cost,
                costBreakdown: result.costBreakdown,
                status: 'pending',
                renderPath: null,
                createdAt: Date.now()
            };

            saveTokens();
            renderTokensList();
            switchTab('tokens');
            log('success', `Token created: ${result.precompName} (cost: ${result.cost})`);

        } catch (e) {
            log('error', e.message);
        }

        updateStatus('ready');
    }

    async function scanTokenCandidates() {
        log('info', 'Scanning for heavy precomps...');

        try {
            const result = await evalScript('pulse_getTokenCandidates()');

            if (!result?.success) {
                log('error', result?.error || 'Scan failed');
                return;
            }

            const candidates = result.candidates || [];
            const recommended = candidates.filter(c => c.recommended);

            if (recommended.length === 0) {
                log('info', 'No heavy precomps found');
                return;
            }

            log('success', `Found ${recommended.length} precomp(s) recommended for caching`);

            // Show candidates in UI
            renderCandidatesList(candidates);

        } catch (e) {
            log('error', e.message);
        }
    }

    function renderCandidatesList(candidates) {
        const container = document.getElementById('token-candidates');
        if (!container) return;

        if (candidates.length === 0) {
            container.innerHTML = '<p class="muted">No precomps found</p>';
            return;
        }

        container.innerHTML = candidates.slice(0, 10).map(c => `
            <div class="candidate-item ${c.recommended ? 'recommended' : ''}">
                <div class="candidate-info">
                    <span class="candidate-name">${esc(c.precompName)}</span>
                    <span class="candidate-cost">Cost: ${c.cost}</span>
                </div>
                <div class="candidate-details">${esc(c.breakdown)}</div>
                ${c.recommended ? `<button class="btn btn-small btn-primary" onclick="Pulse.createTokenForLayer(${c.layerIndex})">Create Token</button>` : ''}
            </div>
        `).join('');
    }

    async function createTokenForLayer(layerIndex) {
        try {
            // Select the layer first
            await evalScript(`app.project.activeItem.layer(${layerIndex}).selected = true`);
            await createToken();
        } catch (e) {
            log('error', e.message);
        }
    }

    function renderTokensList() {
        const container = document.getElementById('tokens-list');
        if (!container) return;

        const tokens = Object.values(state.tokens);

        if (tokens.length === 0) {
            container.innerHTML = '<p class="muted">No tokens. Select a precomp and click "Create Token".</p>';
            return;
        }

        container.innerHTML = tokens.map(t => `
            <div class="token-item" data-id="${esc(t.id)}">
                <div class="token-header">
                    <span class="token-name">${esc(t.precompName)}</span>
                    <span class="token-status ${t.status}">${t.status}</span>
                </div>
                <div class="token-info">
                    ${t.width}x${t.height} @ ${t.frameRate}fps | ${t.frameCount} frames | Cost: ${t.cost}
                </div>
                <div class="token-hash">Hash: ${t.hash}</div>
                <div class="token-actions">
                    ${t.status === 'pending' ? `<button class="btn btn-small btn-primary" onclick="Pulse.renderToken('${t.id}')">Render</button>` : ''}
                    ${t.status === 'ready' ? `<button class="btn btn-small btn-success" onclick="Pulse.swapToken('${t.id}')">Swap In</button>` : ''}
                    ${t.status === 'swapped' ? `<button class="btn btn-small btn-warning" onclick="Pulse.restoreToken('${t.id}')">Restore</button>` : ''}
                    <button class="btn btn-small btn-danger" onclick="Pulse.deleteToken('${t.id}')">Delete</button>
                </div>
            </div>
        `).join('');
    }

    async function renderToken(tokenId) {
        const token = state.tokens[tokenId];
        if (!token) return;

        if (!CONFIG.aerenderPath) {
            log('error', 'aerender not found');
            return;
        }

        log('info', `Rendering ${token.precompName}...`);
        updateStatus('busy');
        token.status = 'rendering';
        saveTokens();
        renderTokensList();

        try {
            const projResult = await evalScript('pulse_getProjectPath()');
            if (!projResult?.success) {
                throw new Error('Save your project first');
            }

            const outputDir = path.join(CONFIG.cacheDir, tokenId);
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }

            const outputPath = path.join(outputDir, `[#####].${CONFIG.format}`);

            const args = [
                '-project', projResult.path,
                '-comp', token.precompName,
                '-output', outputPath,
                '-s', '0',
                '-e', String(token.frameCount - 1)
            ];

            await runAerender(args);

            token.status = 'ready';
            token.renderPath = outputDir;
            saveTokens();
            log('success', `Rendered: ${token.precompName}`);

        } catch (e) {
            token.status = 'error';
            saveTokens();
            log('error', `Render failed: ${e.message}`);
        }

        updateStatus('ready');
        renderTokensList();
    }

    function runAerender(args) {
        return new Promise((resolve, reject) => {
            console.log('[Pulse] aerender:', args.join(' '));

            const proc = spawn(CONFIG.aerenderPath, args);
            let output = '';

            proc.stdout.on('data', d => output += d);
            proc.stderr.on('data', d => output += d);

            proc.on('close', code => {
                if (code === 0) resolve(output);
                else reject(new Error(`aerender exit code ${code}`));
            });

            proc.on('error', reject);
        });
    }

    async function swapToken(tokenId) {
        const token = state.tokens[tokenId];
        if (!token || !token.renderPath) return;

        // Find first frame
        const files = fs.readdirSync(token.renderPath)
            .filter(f => f.endsWith('.' + CONFIG.format))
            .sort();

        if (files.length === 0) {
            log('error', 'No rendered frames found');
            return;
        }

        const firstFrame = path.join(token.renderPath, files[0]).replace(/\\/g, '\\\\');

        try {
            const result = await evalScript(`pulse_swapToken("${tokenId}", "${firstFrame}", ${token.frameRate})`);

            if (result?.success) {
                token.status = 'swapped';
                saveTokens();
                renderTokensList();
                log('success', 'Token swapped in');
            } else {
                log('error', result?.error || 'Swap failed');
            }
        } catch (e) {
            log('error', e.message);
        }
    }

    async function restoreToken(tokenId) {
        try {
            const result = await evalScript(`pulse_restoreToken("${tokenId}")`);

            if (result?.success) {
                state.tokens[tokenId].status = 'ready';
                saveTokens();
                renderTokensList();
                log('success', 'Token restored');
            }
        } catch (e) {
            log('error', e.message);
        }
    }

    function deleteToken(tokenId) {
        if (!confirm('Delete this token?')) return;

        delete state.tokens[tokenId];
        saveTokens();
        renderTokensList();
        log('info', 'Token deleted');
    }

    // ==================== Profiler ====================
    async function runProfiler() {
        log('info', 'Running profiler...');
        updateStatus('busy');

        try {
            const result = await evalScript('pulse_runProfiler()');

            if (!result?.success) {
                log('error', result?.error || 'Profiler failed');
                updateStatus('ready');
                return;
            }

            state.profilerResults = result;
            renderProfilerResults(result);
            log('success', `Analyzed ${result.items.length} layers, total cost: ${result.totalCost}`);

        } catch (e) {
            log('error', e.message);
        }

        updateStatus('ready');
    }

    function renderProfilerResults(data) {
        const container = document.getElementById('profiler-results');
        if (!container) return;

        const maxCost = Math.max(...data.items.map(i => i.cost), 1);

        let html = `
            <div class="profiler-summary">
                <div class="summary-stat">
                    <span class="stat-value">${data.totalCost}</span>
                    <span class="stat-label">Total Cost</span>
                </div>
                <div class="summary-stat">
                    <span class="stat-value">${data.items.length}</span>
                    <span class="stat-label">Layers</span>
                </div>
                <div class="summary-stat ${data.mfrBreakers.length > 0 ? 'warning' : ''}">
                    <span class="stat-value">${data.mfrBreakers.length}</span>
                    <span class="stat-label">MFR Breakers</span>
                </div>
            </div>
        `;

        // Recommendations
        if (data.recommendations && data.recommendations.length > 0) {
            html += '<div class="recommendations">';
            data.recommendations.forEach(rec => {
                html += `
                    <div class="recommendation ${rec.type}">
                        <div class="rec-title">${esc(rec.title)}</div>
                        <div class="rec-desc">${esc(rec.description)}</div>
                        ${rec.action ? `<button class="btn btn-small btn-primary" onclick="Pulse.executeRecommendation('${rec.action}', ${JSON.stringify(rec.targets || []).replace(/"/g, '&quot;')})">${rec.action === 'enableAutoDraft' ? 'Enable' : 'Apply'}</button>` : ''}
                    </div>
                `;
            });
            html += '</div>';
        }

        // Layer list
        html += '<div class="profiler-layers">';
        data.items.forEach(item => {
            const pct = (item.cost / maxCost) * 100;
            const barClass = pct > 70 ? 'high' : pct > 40 ? 'medium' : 'low';

            html += `
                <div class="profiler-item ${item.canTokenize ? 'tokenizable' : ''}">
                    <div class="profiler-main">
                        <span class="layer-name">${esc(item.name)}</span>
                        <span class="layer-type">${item.type}</span>
                    </div>
                    <div class="profiler-breakdown">${esc(item.breakdown)}</div>
                    <div class="profiler-bar">
                        <div class="bar-fill ${barClass}" style="width: ${pct}%"></div>
                        <span class="bar-value">${item.cost}</span>
                    </div>
                    ${item.canTokenize ? `<button class="btn btn-tiny" onclick="Pulse.createTokenForLayer(${item.layerIndex})">Cache</button>` : ''}
                </div>
            `;
        });
        html += '</div>';

        // MFR Breakers
        if (data.mfrBreakers.length > 0) {
            html += '<div class="mfr-breakers"><h4>MFR Breakers</h4>';
            data.mfrBreakers.forEach(b => {
                html += `<div class="mfr-item"><strong>${esc(b.layer)}</strong>: ${esc(b.effect)} (${b.reason})</div>`;
            });
            html += '</div>';
        }

        container.innerHTML = html;
    }

    function executeRecommendation(action, targets) {
        switch (action) {
            case 'enableAutoDraft':
                if (!CONFIG.autoDraft.enabled) toggleAutoDraft();
                break;
            case 'createTokens':
                if (targets && targets.length > 0) {
                    createTokenForLayer(targets[0]);
                }
                break;
        }
    }

    // ==================== Comp State ====================
    async function refreshCompState() {
        try {
            const result = await evalScript('pulse_getCompState()');
            if (result?.success) {
                state.compState = result;
                renderCompSummary(result);
            }
        } catch (e) {}
    }

    function renderCompSummary(data) {
        const el = document.getElementById('comp-summary');
        if (!el) return;

        el.innerHTML = `
            <p><strong>${esc(data.name)}</strong></p>
            <p>${data.width}x${data.height} @ ${data.frameRate}fps</p>
            <p>Duration: ${data.duration.toFixed(2)}s | Layers: ${data.numLayers}</p>
            <p>Resolution: ${data.resolution} | Cost: ${data.totalCost}</p>
            ${data.draftActive ? '<p class="draft-active">Draft Mode Active</p>' : ''}
        `;
    }

    // ==================== Settings ====================
    function loadUIState() {
        // Auto Draft settings
        const res = document.getElementById('auto-draft-resolution');
        const mb = document.getElementById('auto-draft-motion-blur');
        const fb = document.getElementById('auto-draft-frame-blend');
        const ol = document.getElementById('auto-draft-optimize-layers');
        const th = document.getElementById('auto-draft-threshold');

        if (res) res.value = CONFIG.autoDraft.resolution;
        if (mb) mb.checked = CONFIG.autoDraft.disableMotionBlur;
        if (fb) fb.checked = CONFIG.autoDraft.disableFrameBlending;
        if (ol) ol.checked = CONFIG.autoDraft.optimizeLayers;
        if (th) th.value = CONFIG.autoDraft.costThreshold;

        // General settings
        setVal('setting-cache-dir', CONFIG.cacheDir);
        setVal('setting-format', CONFIG.format);
        setVal('setting-aerender', CONFIG.aerenderPath || '');

        // Update button state
        const btn = document.getElementById('btn-auto-draft-toggle');
        if (btn) {
            btn.textContent = CONFIG.autoDraft.enabled ? 'Disable Auto Draft' : 'Enable Auto Draft';
            btn.classList.toggle('btn-active', CONFIG.autoDraft.enabled);
        }
    }

    function saveSettings() {
        CONFIG.cacheDir = getVal('setting-cache-dir') || CONFIG.cacheDir;
        CONFIG.format = getVal('setting-format') || 'png';
        CONFIG.aerenderPath = getVal('setting-aerender') || CONFIG.aerenderPath;

        if (nodeAvailable && CONFIG.cacheDir && !fs.existsSync(CONFIG.cacheDir)) {
            fs.mkdirSync(CONFIG.cacheDir, { recursive: true });
        }

        saveConfig();
        log('success', 'Settings saved');
    }

    function openCacheFolder() {
        if (!nodeAvailable || !CONFIG.cacheDir) return;

        const { exec } = window.cep_node.require('child_process');
        const cmd = os.platform() === 'win32' ? 'explorer' : 'open';
        exec(`${cmd} "${CONFIG.cacheDir}"`);
    }

    // ==================== Persistence ====================
    function loadConfig() {
        if (!nodeAvailable) return;

        const configPath = path.join(CONFIG.cacheDir, 'config.json');
        try {
            if (fs.existsSync(configPath)) {
                const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                Object.assign(CONFIG, data);
            }
        } catch (e) {
            console.error('[Pulse] Config load error:', e);
        }
    }

    function saveConfig() {
        if (!nodeAvailable) return;

        const configPath = path.join(CONFIG.cacheDir, 'config.json');
        try {
            fs.writeFileSync(configPath, JSON.stringify(CONFIG, null, 2));
        } catch (e) {
            console.error('[Pulse] Config save error:', e);
        }
    }

    function loadTokens() {
        if (!nodeAvailable) return;

        const tokensPath = path.join(CONFIG.cacheDir, 'tokens.json');
        try {
            if (fs.existsSync(tokensPath)) {
                state.tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
            }
        } catch (e) {
            state.tokens = {};
        }
    }

    function saveTokens() {
        if (!nodeAvailable) return;

        const tokensPath = path.join(CONFIG.cacheDir, 'tokens.json');
        try {
            fs.writeFileSync(tokensPath, JSON.stringify(state.tokens, null, 2));
        } catch (e) {}
    }

    // ==================== ExtendScript ====================
    function evalScript(script) {
        return new Promise((resolve, reject) => {
            if (!state.csInterface) {
                reject(new Error('CSInterface not ready'));
                return;
            }

            const timeout = setTimeout(() => reject(new Error('Timeout')), 30000);

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
        });
    }

    async function testConnection() {
        try {
            const result = await evalScript('pulse_ping()');
            if (result?.success) {
                console.log('[Pulse] Connected to AE', result.aeVersion);
            }
        } catch (e) {
            console.warn('[Pulse] Connection test failed');
        }
    }

    // ==================== UI Helpers ====================
    function showError(msg) {
        const app = document.getElementById('app');
        if (app) {
            app.innerHTML = `<div style="padding: 20px; color: #f44336;"><h2>Error</h2><p>${msg}</p></div>`;
        }
    }

    function updateStatus(status) {
        const el = document.getElementById('connection-status');
        const text = el?.querySelector('.status-text');
        if (!el || !text) return;

        el.className = 'status ' + status;
        text.textContent = status === 'ready' ? 'Ready' : status === 'busy' ? 'Working...' : 'Error';
    }

    function log(level, msg) {
        const area = document.getElementById('log-area');
        if (!area) {
            console.log(`[Pulse] ${msg}`);
            return;
        }

        const entry = document.createElement('div');
        entry.className = `log-entry ${level}`;
        entry.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
        area.appendChild(entry);
        area.scrollTop = area.scrollHeight;

        while (area.children.length > 50) {
            area.removeChild(area.firstChild);
        }
    }

    function esc(str) {
        if (typeof str !== 'string') return str;
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function sanitize(str) {
        return str.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32);
    }

    function setVal(id, val) {
        const el = document.getElementById(id);
        if (el) el.value = val || '';
    }

    function getVal(id) {
        return document.getElementById(id)?.value || '';
    }

    // ==================== Public API ====================
    window.Pulse = {
        renderToken,
        swapToken,
        restoreToken,
        deleteToken,
        createTokenForLayer,
        executeRecommendation
    };

})();
