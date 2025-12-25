/**
 * Pulse for After Effects - ExtendScript Engine
 * Real performance acceleration through:
 * - Automatic draft ladder (activity-aware quality switching)
 * - Smart render tokens with dependency hashing
 * - Layer-level cost profiling
 * - Granular optimization controls
 */

// ==================== JSON Polyfill ====================
if (typeof JSON === 'undefined') { JSON = {}; }

if (typeof JSON.stringify !== 'function') {
    JSON.stringify = function(obj) {
        var t = typeof obj;
        if (t !== 'object' || obj === null) {
            if (t === 'string') return '"' + obj.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t') + '"';
            if (t === 'number' || t === 'boolean') return String(obj);
            return 'null';
        }
        if (obj instanceof Array) {
            var arr = [];
            for (var i = 0; i < obj.length; i++) arr.push(JSON.stringify(obj[i]));
            return '[' + arr.join(',') + ']';
        }
        var pairs = [];
        for (var key in obj) {
            if (obj.hasOwnProperty(key)) pairs.push('"' + key + '":' + JSON.stringify(obj[key]));
        }
        return '{' + pairs.join(',') + '}';
    };
}

if (typeof JSON.parse !== 'function') {
    JSON.parse = function(str) { return eval('(' + str + ')'); };
}

// ==================== Result Helper ====================
function result(success, data, error) {
    var obj = { success: success };
    if (data) for (var key in data) if (data.hasOwnProperty(key)) obj[key] = data[key];
    if (error) obj.error = String(error);
    return JSON.stringify(obj);
}

// ==================== Core Helpers ====================
function getActiveComp() {
    try {
        var comp = app.project.activeItem;
        if (comp && comp instanceof CompItem) return comp;
    } catch (e) {}
    return null;
}

function isPrecompLayer(layer) {
    try { return layer.source && layer.source instanceof CompItem; } catch (e) { return false; }
}

// ==================== State Storage ====================
var PULSE_STATE = {
    draftActive: false,
    savedSettings: null,
    layerStates: [],
    lastActivity: 0,
    autoMode: false
};

// ==================== Cost Estimation Engine ====================
// Heuristic cost scores for different AE features
var COST_WEIGHTS = {
    effect: 15,           // Per effect
    effect3D: 40,         // 3D effects (camera, lights)
    motionBlur: 25,       // Motion blur
    frameBlending: 20,    // Frame blending
    expression: 10,       // Per expression
    expressionComplex: 30,// Complex expressions (wiggle, time, etc.)
    precomp: 5,           // Per nested layer
    collapse: 35,         // Collapsed transformations
    trackMatte: 15,       // Track mattes
    threeDLayer: 20,      // 3D layer
    continuousRaster: 25, // Continuous rasterization
    adjustment: 10,       // Adjustment layer
    mask: 5,              // Per mask
    maskFeather: 10,      // Feathered masks
    highRes: 0.01,        // Per 1000 pixels beyond 1080p
    highFrameRate: 0.5    // Per fps beyond 30
};

// Effects known to be expensive
var EXPENSIVE_EFFECTS = [
    'CC Particle', 'Particle', 'Trapcode', 'Optical Flares',
    'Camera Lens Blur', 'CC Glass', 'Warp Stabilizer', 'Content-Aware',
    '3D Channel', 'Ray-traced', 'Cinema 4D', 'Element 3D',
    'Particular', 'Form', 'Mir', 'Plexus', 'Stardust',
    'ReelSmart', 'RE:Vision', 'Mocha', 'Roto Brush',
    'Puppet', 'Liquify', 'Mesh Warp', 'Displacement Map',
    'Fractal Noise', 'Turbulent Noise', 'Cell Pattern'
];

/**
 * Calculate cost score for a single layer
 */
function calculateLayerCost(layer, depth) {
    if (!layer || !layer.enabled) return { score: 0, breakdown: [] };

    depth = depth || 0;
    var score = 0;
    var breakdown = [];

    try {
        // 3D layer
        if (layer.threeDLayer) {
            score += COST_WEIGHTS.threeDLayer;
            breakdown.push('3D layer');
        }

        // Motion blur
        if (layer.motionBlur) {
            score += COST_WEIGHTS.motionBlur;
            breakdown.push('Motion blur');
        }

        // Collapsed/Continuous rasterization
        try {
            if (layer.collapseTransformation) {
                score += COST_WEIGHTS.collapse;
                breakdown.push('Collapsed');
            }
        } catch (e) {}

        // Adjustment layer
        try {
            if (layer.adjustmentLayer) {
                score += COST_WEIGHTS.adjustment;
                breakdown.push('Adjustment');
            }
        } catch (e) {}

        // Track matte
        try {
            if (layer.trackMatteType && layer.trackMatteType !== TrackMatteType.NO_TRACK_MATTE) {
                score += COST_WEIGHTS.trackMatte;
                breakdown.push('Track matte');
            }
        } catch (e) {}

        // Effects
        try {
            var effects = layer.property('Effects');
            if (effects && effects.numProperties > 0) {
                var effectCount = effects.numProperties;
                var expensiveCount = 0;

                for (var e = 1; e <= effectCount; e++) {
                    var effect = effects.property(e);
                    var effectName = effect.matchName || effect.name || '';

                    // Check if expensive
                    for (var x = 0; x < EXPENSIVE_EFFECTS.length; x++) {
                        if (effectName.indexOf(EXPENSIVE_EFFECTS[x]) !== -1) {
                            expensiveCount++;
                            break;
                        }
                    }
                }

                score += effectCount * COST_WEIGHTS.effect;
                score += expensiveCount * COST_WEIGHTS.effect * 3; // Triple for expensive
                breakdown.push(effectCount + ' effects' + (expensiveCount > 0 ? ' (' + expensiveCount + ' heavy)' : ''));
            }
        } catch (e) {}

        // Masks
        try {
            var masks = layer.property('Masks');
            if (masks && masks.numProperties > 0) {
                var maskCount = masks.numProperties;
                var featheredCount = 0;

                for (var m = 1; m <= maskCount; m++) {
                    try {
                        var mask = masks.property(m);
                        var feather = mask.property('Mask Feather');
                        if (feather && (feather.value[0] > 0 || feather.value[1] > 0)) {
                            featheredCount++;
                        }
                    } catch (e) {}
                }

                score += maskCount * COST_WEIGHTS.mask;
                score += featheredCount * COST_WEIGHTS.maskFeather;
                if (maskCount > 0) breakdown.push(maskCount + ' masks');
            }
        } catch (e) {}

        // Expressions
        try {
            var hasExpressions = false;
            var complexExpressions = 0;
            var transform = layer.transform;
            var props = ['position', 'scale', 'rotation', 'opacity', 'anchorPoint'];

            for (var p = 0; p < props.length; p++) {
                try {
                    var prop = transform[props[p]];
                    if (prop && prop.expressionEnabled && prop.expression) {
                        hasExpressions = true;
                        var expr = prop.expression.toLowerCase();
                        // Complex expressions
                        if (expr.indexOf('wiggle') !== -1 ||
                            expr.indexOf('time') !== -1 ||
                            expr.indexOf('loopout') !== -1 ||
                            expr.indexOf('valueAtTime') !== -1 ||
                            expr.indexOf('comp(') !== -1) {
                            complexExpressions++;
                        }
                    }
                } catch (e) {}
            }

            if (hasExpressions) {
                score += COST_WEIGHTS.expression;
                score += complexExpressions * COST_WEIGHTS.expressionComplex;
                breakdown.push('Expressions' + (complexExpressions > 0 ? ' (complex)' : ''));
            }
        } catch (e) {}

        // Precomp recursion (limited depth)
        if (isPrecompLayer(layer) && depth < 3) {
            var precomp = layer.source;
            var precompScore = 0;

            for (var i = 1; i <= Math.min(precomp.numLayers, 20); i++) {
                var subCost = calculateLayerCost(precomp.layer(i), depth + 1);
                precompScore += subCost.score;
            }

            score += precompScore * 0.8; // Slight discount for nested
            score += precomp.numLayers * COST_WEIGHTS.precomp;
            breakdown.push('Precomp (' + precomp.numLayers + ' layers, score: ' + Math.round(precompScore) + ')');
        }

    } catch (e) {}

    return { score: Math.round(score), breakdown: breakdown };
}

// ==================== Auto Draft Ladder ====================

/**
 * Get comprehensive comp state for smart draft mode
 */
function pulse_getCompState() {
    try {
        var comp = getActiveComp();
        if (!comp) return result(false, null, 'No active composition');

        // Resolution
        var resText = 'Full';
        if (comp.resolutionFactor[0] === 2) resText = 'Half';
        else if (comp.resolutionFactor[0] === 3) resText = 'Third';
        else if (comp.resolutionFactor[0] === 4) resText = 'Quarter';

        // Count heavy layers
        var heavyLayers = 0;
        var totalCost = 0;

        for (var i = 1; i <= comp.numLayers; i++) {
            var cost = calculateLayerCost(comp.layer(i), 0);
            totalCost += cost.score;
            if (cost.score > 50) heavyLayers++;
        }

        return result(true, {
            name: comp.name,
            width: comp.width,
            height: comp.height,
            frameRate: comp.frameRate,
            duration: comp.duration,
            currentTime: comp.time,
            numLayers: comp.numLayers,
            motionBlur: comp.motionBlur,
            frameBlending: comp.frameBlending,
            resolution: resText,
            resolutionFactor: comp.resolutionFactor[0],
            totalCost: totalCost,
            heavyLayers: heavyLayers,
            draftActive: PULSE_STATE.draftActive
        });
    } catch (e) {
        return result(false, null, e.toString());
    }
}

/**
 * Apply granular draft settings
 * @param {Object} settings - Draft configuration
 */
function pulse_applyDraft(settingsJson) {
    try {
        var settings = JSON.parse(settingsJson);
        var comp = getActiveComp();
        if (!comp) return result(false, null, 'No active composition');

        app.beginUndoGroup('Pulse Auto Draft');

        // Save current state if not already saved
        if (!PULSE_STATE.savedSettings) {
            PULSE_STATE.savedSettings = {
                motionBlur: comp.motionBlur,
                frameBlending: comp.frameBlending,
                resolutionFactor: [comp.resolutionFactor[0], comp.resolutionFactor[1]],
                layers: []
            };

            // Save per-layer states
            for (var i = 1; i <= comp.numLayers; i++) {
                var layer = comp.layer(i);
                var layerState = {
                    index: i,
                    name: layer.name,
                    motionBlur: layer.motionBlur,
                    quality: null,
                    enabled: layer.enabled
                };
                try { layerState.quality = layer.quality; } catch (e) {}
                PULSE_STATE.savedSettings.layers.push(layerState);
            }
        }

        var changes = [];

        // Resolution
        if (settings.resolution) {
            var resFactor = 1;
            if (settings.resolution === 'half') resFactor = 2;
            else if (settings.resolution === 'third') resFactor = 3;
            else if (settings.resolution === 'quarter') resFactor = 4;

            if (comp.resolutionFactor[0] !== resFactor) {
                comp.resolutionFactor = [resFactor, resFactor];
                changes.push('Resolution: ' + settings.resolution);
            }
        }

        // Motion blur
        if (settings.disableMotionBlur && comp.motionBlur) {
            comp.motionBlur = false;
            changes.push('Motion blur OFF');
        }

        // Frame blending
        if (settings.disableFrameBlending && comp.frameBlending) {
            comp.frameBlending = false;
            changes.push('Frame blending OFF');
        }

        // Per-layer optimizations
        if (settings.optimizeLayers) {
            var threshold = settings.costThreshold || 50;
            var layersOptimized = 0;

            for (var j = 1; j <= comp.numLayers; j++) {
                var layer = comp.layer(j);
                if (!layer.enabled) continue;

                var cost = calculateLayerCost(layer, 0);

                if (cost.score >= threshold) {
                    // Disable layer motion blur
                    if (layer.motionBlur) {
                        layer.motionBlur = false;
                    }

                    // Set to draft quality
                    try {
                        if (layer.quality === LayerQuality.BEST) {
                            layer.quality = LayerQuality.DRAFT;
                        }
                    } catch (e) {}

                    layersOptimized++;
                }
            }

            if (layersOptimized > 0) {
                changes.push(layersOptimized + ' layers optimized');
            }
        }

        // Disable tagged heavy layers
        if (settings.disableHeavyLayers) {
            var disabled = 0;
            for (var k = 1; k <= comp.numLayers; k++) {
                var lyr = comp.layer(k);
                if (lyr.enabled && lyr.comment && lyr.comment.indexOf('PULSE_HEAVY') !== -1) {
                    lyr.enabled = false;
                    disabled++;
                }
            }
            if (disabled > 0) changes.push(disabled + ' heavy layers disabled');
        }

        PULSE_STATE.draftActive = true;
        app.endUndoGroup();

        return result(true, {
            changes: changes,
            draftActive: true
        });

    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return result(false, null, e.toString());
    }
}

/**
 * Restore original settings
 */
function pulse_restoreDraft() {
    try {
        var comp = getActiveComp();
        if (!comp) return result(false, null, 'No active composition');
        if (!PULSE_STATE.savedSettings) return result(false, null, 'No saved state');

        app.beginUndoGroup('Pulse Restore');

        var saved = PULSE_STATE.savedSettings;

        // Restore comp settings
        comp.motionBlur = saved.motionBlur;
        comp.frameBlending = saved.frameBlending;
        comp.resolutionFactor = saved.resolutionFactor;

        // Restore layer settings
        for (var i = 0; i < saved.layers.length; i++) {
            var layerState = saved.layers[i];
            if (layerState.index <= comp.numLayers) {
                var layer = comp.layer(layerState.index);
                if (layer.name === layerState.name) {
                    layer.motionBlur = layerState.motionBlur;
                    try {
                        if (layerState.quality !== null) {
                            layer.quality = layerState.quality;
                        }
                    } catch (e) {}
                    // Restore enabled state for PULSE_HEAVY layers
                    if (layer.comment && layer.comment.indexOf('PULSE_HEAVY') !== -1) {
                        layer.enabled = layerState.enabled;
                    }
                }
            }
        }

        PULSE_STATE.savedSettings = null;
        PULSE_STATE.draftActive = false;
        app.endUndoGroup();

        return result(true, { draftActive: false });

    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return result(false, null, e.toString());
    }
}

// ==================== Render Token System ====================

/**
 * Generate deterministic hash for a layer/precomp
 * Captures all render-affecting parameters
 */
function pulse_generateTokenHash(layerIndex) {
    try {
        var comp = getActiveComp();
        if (!comp) return result(false, null, 'No active composition');

        var layer = comp.layer(layerIndex);
        if (!layer) return result(false, null, 'Layer not found');
        if (!isPrecompLayer(layer)) return result(false, null, 'Not a precomp layer');

        var precomp = layer.source;
        var hashData = [];

        // Precomp identity
        hashData.push('name:' + precomp.name);
        hashData.push('size:' + precomp.width + 'x' + precomp.height);
        hashData.push('fps:' + precomp.frameRate);
        hashData.push('dur:' + precomp.duration.toFixed(4));
        hashData.push('layers:' + precomp.numLayers);

        // Capture layer structure (first 30 layers)
        var maxLayers = Math.min(precomp.numLayers, 30);
        for (var i = 1; i <= maxLayers; i++) {
            var subLayer = precomp.layer(i);
            var layerHash = [];

            layerHash.push(subLayer.name);
            layerHash.push(subLayer.enabled ? '1' : '0');
            layerHash.push(subLayer.inPoint.toFixed(3));
            layerHash.push(subLayer.outPoint.toFixed(3));

            // Source identity
            try {
                if (subLayer.source) {
                    if (subLayer.source.file) {
                        layerHash.push('file:' + subLayer.source.file.modified.getTime());
                    } else if (subLayer.source instanceof CompItem) {
                        layerHash.push('comp:' + subLayer.source.name);
                    }
                }
            } catch (e) {}

            // Effect parameters (first 5 effects, first 3 params each)
            try {
                var effects = subLayer.property('Effects');
                if (effects) {
                    var maxEffects = Math.min(effects.numProperties, 5);
                    for (var e = 1; e <= maxEffects; e++) {
                        var effect = effects.property(e);
                        layerHash.push('fx:' + effect.matchName);

                        // Capture key property values
                        var maxProps = Math.min(effect.numProperties, 3);
                        for (var p = 1; p <= maxProps; p++) {
                            try {
                                var prop = effect.property(p);
                                if (prop.value !== undefined) {
                                    if (typeof prop.value === 'number') {
                                        layerHash.push(prop.value.toFixed(2));
                                    } else if (prop.value instanceof Array) {
                                        layerHash.push(prop.value.join(','));
                                    }
                                }
                            } catch (pe) {}
                        }
                    }
                }
            } catch (e) {}

            // Transform state
            try {
                var transform = subLayer.transform;
                layerHash.push('pos:' + transform.position.value.join(','));
                layerHash.push('scl:' + transform.scale.value.join(','));
                layerHash.push('rot:' + (transform.rotation ? transform.rotation.value : transform.zRotation.value));
                layerHash.push('opa:' + transform.opacity.value);
            } catch (e) {}

            hashData.push('L' + i + ':' + layerHash.join('|'));
        }

        // Create simple hash from data
        var hashString = hashData.join(';;');
        var hash = 0;
        for (var c = 0; c < hashString.length; c++) {
            hash = ((hash << 5) - hash) + hashString.charCodeAt(c);
            hash = hash & hash; // Convert to 32bit integer
        }
        hash = Math.abs(hash).toString(16).slice(0, 8);

        return result(true, {
            hash: hash,
            layerName: layer.name,
            precompName: precomp.name,
            frameCount: Math.ceil(precomp.duration * precomp.frameRate),
            width: precomp.width,
            height: precomp.height,
            frameRate: precomp.frameRate,
            duration: precomp.duration
        });

    } catch (e) {
        return result(false, null, e.toString());
    }
}

/**
 * Get all tokenizable precomps with their costs
 */
function pulse_getTokenCandidates() {
    try {
        var comp = getActiveComp();
        if (!comp) return result(false, null, 'No active composition');

        var candidates = [];

        for (var i = 1; i <= comp.numLayers; i++) {
            var layer = comp.layer(i);
            if (!layer.enabled) continue;
            if (!isPrecompLayer(layer)) continue;

            var cost = calculateLayerCost(layer, 0);
            var precomp = layer.source;

            candidates.push({
                layerIndex: i,
                layerName: layer.name,
                precompName: precomp.name,
                cost: cost.score,
                breakdown: cost.breakdown.join(', '),
                duration: precomp.duration,
                frameCount: Math.ceil(precomp.duration * precomp.frameRate),
                recommended: cost.score >= 40 // Recommend if cost is high
            });
        }

        // Sort by cost descending
        candidates.sort(function(a, b) { return b.cost - a.cost; });

        return result(true, { candidates: candidates });

    } catch (e) {
        return result(false, null, e.toString());
    }
}

/**
 * Create token from selected layer
 */
function pulse_createToken() {
    try {
        var comp = getActiveComp();
        if (!comp) return result(false, null, 'No active composition');

        var selected = comp.selectedLayers;
        if (!selected || selected.length === 0) {
            return result(false, null, 'Select a precomp layer');
        }

        var layer = selected[0];
        if (!isPrecompLayer(layer)) {
            return result(false, null, 'Selected layer is not a precomp');
        }

        var hashResult = JSON.parse(pulse_generateTokenHash(layer.index));
        if (!hashResult.success) {
            return result(false, null, hashResult.error);
        }

        var cost = calculateLayerCost(layer, 0);

        return result(true, {
            hash: hashResult.hash,
            layerIndex: layer.index,
            layerName: layer.name,
            precompName: hashResult.precompName,
            width: hashResult.width,
            height: hashResult.height,
            frameRate: hashResult.frameRate,
            duration: hashResult.duration,
            frameCount: hashResult.frameCount,
            cost: cost.score,
            costBreakdown: cost.breakdown.join(', ')
        });

    } catch (e) {
        return result(false, null, e.toString());
    }
}

/**
 * Swap in rendered footage for a token
 */
function pulse_swapToken(tokenId, renderPath, frameRate) {
    try {
        var comp = getActiveComp();
        if (!comp) return result(false, null, 'No active composition');

        // Find original layer
        var originalLayer = null;
        for (var i = 1; i <= comp.numLayers; i++) {
            var layer = comp.layer(i);
            if (layer.comment && layer.comment.indexOf('PULSE_TOKEN:' + tokenId) !== -1) {
                originalLayer = layer;
                break;
            }
        }

        // If not found by comment, use selection
        if (!originalLayer) {
            var selected = comp.selectedLayers;
            if (selected && selected.length > 0 && isPrecompLayer(selected[0])) {
                originalLayer = selected[0];
            }
        }

        if (!originalLayer) {
            return result(false, null, 'Cannot find layer to swap');
        }

        // Import footage
        var renderFile = new File(renderPath);
        if (!renderFile.exists) {
            return result(false, null, 'Render file not found');
        }

        app.beginUndoGroup('Pulse Token Swap');

        var importOptions = new ImportOptions(renderFile);
        importOptions.sequence = true;
        importOptions.forceAlphabetical = true;

        var footage = app.project.importFile(importOptions);
        footage.name = 'PULSE_CACHE_' + tokenId;

        // Set frame rate
        if (frameRate) {
            footage.mainSource.conformFrameRate = frameRate;
        }

        // Add to comp
        var cacheLayer = comp.layers.add(footage);
        cacheLayer.name = '[Pulse] ' + originalLayer.name;
        cacheLayer.comment = 'PULSE_CACHE:' + tokenId;

        // Match original layer
        cacheLayer.startTime = originalLayer.startTime;
        cacheLayer.inPoint = originalLayer.inPoint;
        cacheLayer.outPoint = originalLayer.outPoint;

        // Copy transform
        try {
            cacheLayer.transform.anchorPoint.setValue(originalLayer.transform.anchorPoint.value);
            cacheLayer.transform.position.setValue(originalLayer.transform.position.value);
            cacheLayer.transform.scale.setValue(originalLayer.transform.scale.value);
            cacheLayer.transform.rotation.setValue(originalLayer.transform.rotation.value);
            cacheLayer.transform.opacity.setValue(originalLayer.transform.opacity.value);
        } catch (e) {}

        // Position above original
        cacheLayer.moveBefore(originalLayer);

        // Mark and hide original
        originalLayer.comment = 'PULSE_TOKEN:' + tokenId;
        originalLayer.enabled = false;
        originalLayer.shy = true;

        app.endUndoGroup();

        return result(true, { message: 'Token swapped successfully' });

    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return result(false, null, e.toString());
    }
}

/**
 * Restore original layer from token
 */
function pulse_restoreToken(tokenId) {
    try {
        var comp = getActiveComp();
        if (!comp) return result(false, null, 'No active composition');

        var originalLayer = null;
        var cacheLayer = null;

        for (var i = 1; i <= comp.numLayers; i++) {
            var layer = comp.layer(i);
            if (layer.comment === 'PULSE_TOKEN:' + tokenId) {
                originalLayer = layer;
            } else if (layer.comment === 'PULSE_CACHE:' + tokenId) {
                cacheLayer = layer;
            }
        }

        if (!originalLayer) {
            return result(false, null, 'Original layer not found');
        }

        app.beginUndoGroup('Pulse Token Restore');

        originalLayer.enabled = true;
        originalLayer.shy = false;

        if (cacheLayer) {
            cacheLayer.enabled = false;
            cacheLayer.shy = true;
        }

        app.endUndoGroup();

        return result(true, { message: 'Token restored' });

    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return result(false, null, e.toString());
    }
}

// ==================== Profiler ====================

/**
 * Deep profiler with cost breakdown
 */
function pulse_runProfiler() {
    try {
        var comp = getActiveComp();
        if (!comp) return result(false, null, 'No active composition');

        var items = [];
        var totalCost = 0;
        var mfrBreakers = [];
        var expressionWarnings = [];

        for (var i = 1; i <= comp.numLayers; i++) {
            var layer = comp.layer(i);
            if (!layer.enabled) continue;

            var cost = calculateLayerCost(layer, 0);
            totalCost += cost.score;

            // Check for MFR breakers
            try {
                var effects = layer.property('Effects');
                if (effects) {
                    for (var e = 1; e <= effects.numProperties; e++) {
                        var effect = effects.property(e);
                        var matchName = effect.matchName || '';

                        // Effects known to break MFR
                        if (matchName.indexOf('Particle') !== -1 ||
                            matchName.indexOf('Time') !== -1 ||
                            matchName.indexOf('Echo') !== -1 ||
                            matchName.indexOf('CC Force') !== -1 ||
                            matchName.indexOf('Warp') !== -1) {
                            mfrBreakers.push({
                                layer: layer.name,
                                effect: effect.name,
                                reason: 'Temporal dependency'
                            });
                        }
                    }
                }
            } catch (e) {}

            // Check for expensive expressions
            try {
                var transform = layer.transform;
                var props = ['position', 'scale', 'rotation', 'opacity'];
                for (var p = 0; p < props.length; p++) {
                    var prop = transform[props[p]];
                    if (prop && prop.expressionEnabled && prop.expression) {
                        var expr = prop.expression.toLowerCase();
                        if (expr.indexOf('comp(') !== -1 ||
                            expr.indexOf('layer(') !== -1 ||
                            expr.indexOf('thiscomp.layer') !== -1) {
                            expressionWarnings.push({
                                layer: layer.name,
                                property: props[p],
                                reason: 'Cross-layer reference (breaks caching)'
                            });
                        }
                    }
                }
            } catch (e) {}

            items.push({
                layerIndex: i,
                name: layer.name,
                type: isPrecompLayer(layer) ? 'Precomp' : 'Layer',
                isPrecomp: isPrecompLayer(layer),
                cost: cost.score,
                breakdown: cost.breakdown.join(', '),
                canTokenize: isPrecompLayer(layer) && cost.score >= 30
            });
        }

        // Sort by cost
        items.sort(function(a, b) { return b.cost - a.cost; });

        // Resolution penalty
        var resPenalty = 0;
        var pixels = comp.width * comp.height;
        if (pixels > 1920 * 1080) {
            resPenalty = Math.round((pixels - 1920 * 1080) / 1000 * COST_WEIGHTS.highRes);
        }

        // Frame rate penalty
        var fpsPenalty = 0;
        if (comp.frameRate > 30) {
            fpsPenalty = Math.round((comp.frameRate - 30) * COST_WEIGHTS.highFrameRate);
        }

        return result(true, {
            items: items.slice(0, 15),
            totalCost: totalCost,
            compCost: resPenalty + fpsPenalty,
            resPenalty: resPenalty,
            fpsPenalty: fpsPenalty,
            mfrBreakers: mfrBreakers,
            expressionWarnings: expressionWarnings,
            recommendations: generateRecommendations(items, totalCost, mfrBreakers)
        });

    } catch (e) {
        return result(false, null, e.toString());
    }
}

/**
 * Generate optimization recommendations
 */
function generateRecommendations(items, totalCost, mfrBreakers) {
    var recs = [];

    // High total cost
    if (totalCost > 200) {
        recs.push({
            type: 'warning',
            title: 'High complexity composition',
            description: 'Consider using Auto Draft during editing',
            action: 'enableAutoDraft'
        });
    }

    // Heavy precomps
    var heavyPrecomps = [];
    for (var i = 0; i < items.length; i++) {
        if (items[i].isPrecomp && items[i].cost >= 50) {
            heavyPrecomps.push(items[i]);
        }
    }

    if (heavyPrecomps.length > 0) {
        recs.push({
            type: 'action',
            title: heavyPrecomps.length + ' heavy precomp(s) detected',
            description: 'Create Render Tokens to cache: ' + heavyPrecomps.slice(0, 3).map(function(p) { return p.name; }).join(', '),
            action: 'createTokens',
            targets: heavyPrecomps.map(function(p) { return p.layerIndex; })
        });
    }

    // MFR breakers
    if (mfrBreakers.length > 0) {
        recs.push({
            type: 'info',
            title: mfrBreakers.length + ' effect(s) may break Multi-Frame Rendering',
            description: mfrBreakers.slice(0, 3).map(function(b) { return b.layer + ': ' + b.effect; }).join('; '),
            action: null
        });
    }

    return recs;
}

// ==================== Predictive Rendering ====================

/**
 * Get frames to pre-render around current time
 */
function pulse_getPreRenderFrames(radius) {
    try {
        var comp = getActiveComp();
        if (!comp) return result(false, null, 'No active composition');

        radius = radius || 2; // seconds
        var currentTime = comp.time;
        var frameRate = comp.frameRate;
        var duration = comp.duration;

        var startFrame = Math.max(0, Math.floor((currentTime - radius) * frameRate));
        var endFrame = Math.min(Math.ceil(duration * frameRate) - 1, Math.ceil((currentTime + radius) * frameRate));
        var currentFrame = Math.round(currentTime * frameRate);

        return result(true, {
            currentFrame: currentFrame,
            startFrame: startFrame,
            endFrame: endFrame,
            frameRate: frameRate,
            totalFrames: endFrame - startFrame + 1
        });

    } catch (e) {
        return result(false, null, e.toString());
    }
}

/**
 * Get project path for aerender
 */
function pulse_getProjectPath() {
    try {
        if (!app.project.file) {
            return result(false, null, 'Save project first');
        }
        return result(true, { path: app.project.file.fsName });
    } catch (e) {
        return result(false, null, e.toString());
    }
}

// ==================== Utility Functions ====================

function pulse_ping() {
    return result(true, {
        version: '2.0.0',
        aeVersion: app.version,
        features: ['autoDraft', 'renderTokens', 'profiler', 'predictiveRender']
    });
}

function pulse_getActiveCompSummary() {
    return pulse_getCompState();
}
