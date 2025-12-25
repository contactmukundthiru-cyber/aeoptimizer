/**
 * Pulse for After Effects - ExtendScript Functions
 * Handles all After Effects automation via ExtendScript
 *
 * Compatible with After Effects CC 2019+
 */

// ==================== JSON Polyfill for ExtendScript ====================
// ExtendScript doesn't have native JSON in older versions

if (typeof JSON === 'undefined') {
    JSON = {};
}

if (typeof JSON.stringify !== 'function') {
    JSON.stringify = function(obj) {
        var t = typeof obj;
        if (t !== 'object' || obj === null) {
            // Simple types
            if (t === 'string') {
                return '"' + obj.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t') + '"';
            }
            if (t === 'number' || t === 'boolean') {
                return String(obj);
            }
            return 'null';
        }

        // Arrays
        if (obj instanceof Array) {
            var arr = [];
            for (var i = 0; i < obj.length; i++) {
                arr.push(JSON.stringify(obj[i]));
            }
            return '[' + arr.join(',') + ']';
        }

        // Objects
        var pairs = [];
        for (var key in obj) {
            if (obj.hasOwnProperty(key)) {
                var val = JSON.stringify(obj[key]);
                pairs.push('"' + key + '":' + val);
            }
        }
        return '{' + pairs.join(',') + '}';
    };
}

if (typeof JSON.parse !== 'function') {
    JSON.parse = function(str) {
        return eval('(' + str + ')');
    };
}

// ==================== Utility Functions ====================

/**
 * Safe wrapper for returning results to CEP
 */
function result(success, data, error) {
    var obj = { success: success };
    if (data !== undefined && data !== null) {
        for (var key in data) {
            if (data.hasOwnProperty(key)) {
                obj[key] = data[key];
            }
        }
    }
    if (error) {
        obj.error = String(error);
    }
    return JSON.stringify(obj);
}

/**
 * Get the active composition or return null
 */
function getActiveComp() {
    try {
        var comp = app.project.activeItem;
        if (comp && comp instanceof CompItem) {
            return comp;
        }
    } catch (e) {}
    return null;
}

/**
 * Find a layer by its comment field
 */
function findLayerByComment(comp, searchText) {
    for (var i = 1; i <= comp.numLayers; i++) {
        var layer = comp.layer(i);
        if (layer.comment && layer.comment.indexOf(searchText) !== -1) {
            return layer;
        }
    }
    return null;
}

/**
 * Check if a layer is a precomp
 */
function isPrecompLayer(layer) {
    try {
        return layer.source && layer.source instanceof CompItem;
    } catch (e) {
        return false;
    }
}

// ==================== Draft Mode State Storage ====================

var PULSE_DRAFT_STATE = null;

// ==================== Main Functions ====================

/**
 * Get summary of active composition for hashing and UI display
 * Called from panel.js: pulse_getActiveCompSummary()
 */
function pulse_getActiveCompSummary() {
    try {
        var comp = getActiveComp();
        if (!comp) {
            return result(false, null, 'No active composition. Please open a composition.');
        }

        var precompCount = 0;
        var layers = [];

        for (var i = 1; i <= comp.numLayers; i++) {
            var layer = comp.layer(i);

            var effectCount = 0;
            try {
                var effects = layer.property('Effects');
                if (effects) {
                    effectCount = effects.numProperties;
                }
            } catch (e) {}

            var layerInfo = {
                index: i,
                name: layer.name,
                type: 'layer',
                enabled: layer.enabled,
                effectsCount: effectCount
            };

            if (isPrecompLayer(layer)) {
                layerInfo.type = 'precomp';
                layerInfo.precompName = layer.source.name;
                precompCount++;
            }

            layers.push(layerInfo);
        }

        return result(true, {
            comp: {
                name: comp.name,
                width: comp.width,
                height: comp.height,
                frameRate: comp.frameRate,
                duration: comp.duration,
                numFrames: Math.ceil(comp.duration * comp.frameRate),
                numLayers: comp.numLayers,
                numPrecomps: precompCount,
                motionBlur: comp.motionBlur,
                resolutionFactor: comp.resolutionFactor[0]
            },
            layers: layers
        });
    } catch (e) {
        return result(false, null, 'Error getting comp summary: ' + e.toString());
    }
}

/**
 * Apply or restore draft mode settings
 * @param {boolean} enable - True to enable draft mode, false to restore
 * @param {number} aggressiveness - 1=Light, 2=Medium, 3=Heavy
 */
function pulse_applyDraftMode(enable, aggressiveness) {
    try {
        var comp = getActiveComp();
        if (!comp) {
            return result(false, null, 'No active composition');
        }

        app.beginUndoGroup('Pulse Draft Mode');

        if (enable) {
            // Save current state before making changes
            PULSE_DRAFT_STATE = {
                compName: comp.name,
                compId: comp.id,
                motionBlur: comp.motionBlur,
                resolutionFactor: [comp.resolutionFactor[0], comp.resolutionFactor[1]],
                frameBlending: comp.frameBlending,
                layers: []
            };

            var changesApplied = [];

            // Level 1: Disable motion blur and frame blending
            if (aggressiveness >= 1) {
                if (comp.motionBlur) {
                    comp.motionBlur = false;
                    changesApplied.push('Motion blur disabled');
                }
                if (comp.frameBlending) {
                    comp.frameBlending = false;
                    changesApplied.push('Frame blending disabled');
                }
            }

            // Level 2: Set resolution to Half
            if (aggressiveness >= 2) {
                if (comp.resolutionFactor[0] < 2) {
                    comp.resolutionFactor = [2, 2];
                    changesApplied.push('Resolution set to Half');
                }
            }

            // Level 3: Disable layers tagged "PULSE_HEAVY"
            if (aggressiveness >= 3) {
                for (var i = 1; i <= comp.numLayers; i++) {
                    var layer = comp.layer(i);
                    var layerState = {
                        index: i,
                        name: layer.name,
                        wasEnabled: layer.enabled
                    };

                    // Check if layer name contains PULSE_HEAVY tag
                    if (layer.name.indexOf('PULSE_HEAVY') !== -1 && layer.enabled) {
                        layer.enabled = false;
                        layerState.wasDisabled = true;
                        changesApplied.push('Disabled: ' + layer.name);
                    }

                    PULSE_DRAFT_STATE.layers.push(layerState);
                }
            }

            app.endUndoGroup();

            return result(true, {
                changes: changesApplied.length > 0 ? changesApplied.join(', ') : 'Draft settings applied'
            });

        } else {
            // Restore previous state
            if (!PULSE_DRAFT_STATE) {
                app.endUndoGroup();
                return result(false, null, 'No draft state to restore');
            }

            // Verify we're in the same comp
            if (comp.id !== PULSE_DRAFT_STATE.compId) {
                app.endUndoGroup();
                return result(false, null, 'Active composition has changed. Cannot restore.');
            }

            // Restore comp settings
            comp.motionBlur = PULSE_DRAFT_STATE.motionBlur;
            comp.resolutionFactor = PULSE_DRAFT_STATE.resolutionFactor;
            comp.frameBlending = PULSE_DRAFT_STATE.frameBlending;

            // Restore layer states
            for (var k = 0; k < PULSE_DRAFT_STATE.layers.length; k++) {
                var savedLayer = PULSE_DRAFT_STATE.layers[k];
                if (savedLayer.wasDisabled && savedLayer.index <= comp.numLayers) {
                    var layer = comp.layer(savedLayer.index);
                    // Only restore if the layer name still matches
                    if (layer.name === savedLayer.name) {
                        layer.enabled = true;
                    }
                }
            }

            PULSE_DRAFT_STATE = null;
            app.endUndoGroup();

            return result(true, { changes: 'Original settings restored' });
        }
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return result(false, null, 'Draft mode error: ' + e.toString());
    }
}

/**
 * Create a precomp token from the selected layer
 * Returns info needed by the worker for rendering
 */
function pulse_createPrecompToken() {
    try {
        var comp = getActiveComp();
        if (!comp) {
            return result(false, null, 'No active composition');
        }

        var selectedLayers = comp.selectedLayers;
        if (!selectedLayers || selectedLayers.length === 0) {
            return result(false, null, 'No layer selected. Please select a precomp layer.');
        }

        var layer = selectedLayers[0];

        // Check if it's a precomp layer
        if (!isPrecompLayer(layer)) {
            return result(false, null, 'Selected layer is not a precomp. Please select a precomp layer.');
        }

        var precomp = layer.source;

        // Build summary for hashing
        var summary = {
            precompName: precomp.name,
            width: precomp.width,
            height: precomp.height,
            frameRate: precomp.frameRate,
            duration: precomp.duration,
            numLayers: precomp.numLayers,
            workAreaStart: precomp.workAreaStart,
            workAreaDuration: precomp.workAreaDuration
        };

        // Add layer info for more accurate hashing (first 20 layers)
        var layerSummaries = [];
        var maxLayers = Math.min(precomp.numLayers, 20);
        for (var i = 1; i <= maxLayers; i++) {
            var subLayer = precomp.layer(i);
            layerSummaries.push({
                name: subLayer.name,
                enabled: subLayer.enabled,
                inPoint: subLayer.inPoint,
                outPoint: subLayer.outPoint
            });
        }
        summary.layers = layerSummaries;

        return result(true, {
            compName: comp.name,
            precompName: precomp.name,
            layerIndex: layer.index,
            layerName: layer.name,
            frameRate: precomp.frameRate,
            duration: precomp.duration,
            width: precomp.width,
            height: precomp.height,
            summary: summary
        });
    } catch (e) {
        return result(false, null, 'Error creating token: ' + e.toString());
    }
}

/**
 * Swap in a rendered image sequence for a precomp token
 * @param {string} tokenId - The token identifier
 * @param {string} renderPath - Path to the first frame of the sequence
 */
function pulse_swapInRender(tokenId, renderPath) {
    try {
        var comp = getActiveComp();
        if (!comp) {
            return result(false, null, 'No active composition');
        }

        // Find the original layer by comment or selection
        var originalLayer = findLayerByComment(comp, 'PULSE_ORIGINAL:' + tokenId);

        // If no marked layer, try to find by selection
        if (!originalLayer) {
            var selectedLayers = comp.selectedLayers;
            if (selectedLayers && selectedLayers.length > 0 && isPrecompLayer(selectedLayers[0])) {
                originalLayer = selectedLayers[0];
            }
        }

        if (!originalLayer) {
            return result(false, null, 'Cannot find original layer. Please select the precomp layer to swap.');
        }

        // Validate render path
        var renderFile = new File(renderPath);
        if (!renderFile.exists) {
            return result(false, null, 'Render file not found: ' + renderPath);
        }

        app.beginUndoGroup('Pulse Swap In');

        // Import the image sequence
        var importOptions = new ImportOptions(renderFile);
        importOptions.sequence = true;
        importOptions.forceAlphabetical = true;

        var footage;
        try {
            footage = app.project.importFile(importOptions);
        } catch (importErr) {
            app.endUndoGroup();
            return result(false, null, 'Failed to import render: ' + importErr.toString());
        }

        footage.name = 'PULSE_RENDER_' + tokenId;

        // Set frame rate to match precomp
        if (originalLayer.source && originalLayer.source.frameRate) {
            footage.mainSource.conformFrameRate = originalLayer.source.frameRate;
        }

        // Create a new layer from the footage
        var renderLayer = comp.layers.add(footage);
        renderLayer.name = '[Pulse Cache] ' + originalLayer.name;

        // Match timing and position of original layer
        renderLayer.startTime = originalLayer.startTime;
        renderLayer.inPoint = originalLayer.inPoint;
        renderLayer.outPoint = originalLayer.outPoint;

        // Copy transform properties
        try {
            renderLayer.transform.anchorPoint.setValue(originalLayer.transform.anchorPoint.value);
            renderLayer.transform.position.setValue(originalLayer.transform.position.value);
            renderLayer.transform.scale.setValue(originalLayer.transform.scale.value);
            renderLayer.transform.rotation.setValue(originalLayer.transform.rotation.value);
            renderLayer.transform.opacity.setValue(originalLayer.transform.opacity.value);
        } catch (transformErr) {
            // Some properties might not be accessible, continue anyway
        }

        // Move render layer to be just above original
        renderLayer.moveBefore(originalLayer);

        // Mark layers for swap back
        originalLayer.comment = 'PULSE_ORIGINAL:' + tokenId;
        renderLayer.comment = 'PULSE_RENDER:' + tokenId;

        // Disable original layer (preserve for swap back)
        originalLayer.enabled = false;
        originalLayer.shy = true;

        // Show shy layers so user knows what happened
        comp.hideShyLayers = false;

        app.endUndoGroup();

        return result(true, { message: 'Render swapped in successfully' });
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return result(false, null, 'Swap in error: ' + e.toString());
    }
}

/**
 * Restore the original precomp layer and disable the render layer
 * @param {string} tokenId - The token identifier
 */
function pulse_swapBack(tokenId) {
    try {
        var comp = getActiveComp();
        if (!comp) {
            return result(false, null, 'No active composition');
        }

        var originalLayer = null;
        var renderLayer = null;

        // Find layers by their comments
        for (var i = 1; i <= comp.numLayers; i++) {
            var layer = comp.layer(i);
            if (layer.comment === 'PULSE_ORIGINAL:' + tokenId) {
                originalLayer = layer;
            } else if (layer.comment === 'PULSE_RENDER:' + tokenId) {
                renderLayer = layer;
            }
        }

        if (!originalLayer) {
            return result(false, null, 'Cannot find original layer for token: ' + tokenId);
        }

        app.beginUndoGroup('Pulse Swap Back');

        // Re-enable original layer
        originalLayer.enabled = true;
        originalLayer.shy = false;

        // Disable and hide render layer
        if (renderLayer) {
            renderLayer.enabled = false;
            renderLayer.shy = true;
        }

        app.endUndoGroup();

        return result(true, { message: 'Original precomp restored' });
    } catch (e) {
        try { app.endUndoGroup(); } catch (e2) {}
        return result(false, null, 'Swap back error: ' + e.toString());
    }
}

/**
 * Mark a token as dirty in layer metadata
 * @param {string} tokenId - The token identifier
 */
function pulse_markTokenDirty(tokenId) {
    try {
        var comp = getActiveComp();
        if (!comp) {
            return result(false, null, 'No active composition');
        }

        // Find the original layer with this token
        var originalLayer = findLayerByComment(comp, 'PULSE_ORIGINAL:' + tokenId);

        if (originalLayer) {
            originalLayer.comment = 'PULSE_ORIGINAL:' + tokenId + ':DIRTY';
        }

        return result(true, { message: 'Token marked as dirty' });
    } catch (e) {
        return result(false, null, 'Mark dirty error: ' + e.toString());
    }
}

/**
 * Get the project file path
 */
function pulse_getProjectPath() {
    try {
        if (!app.project.file) {
            return result(false, null, 'Project has not been saved. Please save the project first.');
        }

        return result(true, { path: app.project.file.fsName });
    } catch (e) {
        return result(false, null, 'Error getting project path: ' + e.toString());
    }
}

/**
 * Run profiler to find heavy layers/precomps
 * Returns top items sorted by heuristic cost score
 */
function pulse_runProfiler() {
    try {
        var comp = getActiveComp();
        if (!comp) {
            return result(false, null, 'No active composition');
        }

        var items = [];

        for (var i = 1; i <= comp.numLayers; i++) {
            var layer = comp.layer(i);
            if (!layer.enabled) continue;

            var score = 0;
            var details = [];

            // Effect count (heavy impact)
            var effectCount = 0;
            try {
                var effects = layer.property('Effects');
                if (effects) {
                    effectCount = effects.numProperties;
                }
            } catch (e) {}

            if (effectCount > 0) {
                score += effectCount * 10;
                details.push(effectCount + ' effects');
            }

            // 3D layer (moderate impact)
            try {
                if (layer.threeDLayer) {
                    score += 15;
                    details.push('3D');
                }
            } catch (e) {}

            // Motion blur (high impact)
            try {
                if (layer.motionBlur) {
                    score += 20;
                    details.push('Motion blur');
                }
            } catch (e) {}

            // Check for expressions
            try {
                var hasExpressions = false;
                var transform = layer.transform;
                if (transform) {
                    var props = ['position', 'scale', 'rotation', 'opacity', 'anchorPoint'];
                    for (var p = 0; p < props.length; p++) {
                        try {
                            var prop = transform[props[p]];
                            if (prop && prop.expressionEnabled && prop.expression !== '') {
                                hasExpressions = true;
                                break;
                            }
                        } catch (propErr) {}
                    }
                }
                if (hasExpressions) {
                    score += 25;
                    details.push('Expressions');
                }
            } catch (e) {}

            // Precomp (nested complexity)
            var isPrecomp = isPrecompLayer(layer);
            if (isPrecomp) {
                var precomp = layer.source;
                score += precomp.numLayers * 5;
                details.push('Precomp (' + precomp.numLayers + ' layers)');
            }

            // Continuous rasterization / collapse transformations (high impact)
            try {
                if (layer.collapseTransformation) {
                    score += 30;
                    details.push('Collapsed');
                }
            } catch (e) {}

            // Track mattes (moderate impact)
            try {
                if (layer.trackMatteType && layer.trackMatteType !== TrackMatteType.NO_TRACK_MATTE) {
                    score += 10;
                    details.push('Track matte');
                }
            } catch (e) {}

            if (score > 0) {
                items.push({
                    layerIndex: i,
                    name: layer.name,
                    type: isPrecomp ? 'Precomp' : 'Layer',
                    isPrecomp: isPrecomp,
                    score: score,
                    details: details.join(', ')
                });
            }
        }

        // Sort by score descending
        items.sort(function(a, b) {
            return b.score - a.score;
        });

        // Return top 10
        return result(true, { items: items.slice(0, 10) });
    } catch (e) {
        return result(false, null, 'Profiler error: ' + e.toString());
    }
}

/**
 * Select a layer by index
 * @param {number} layerIndex - The layer index (1-based)
 */
function pulse_selectLayer(layerIndex) {
    try {
        var comp = getActiveComp();
        if (!comp) {
            return result(false, null, 'No active composition');
        }

        // Deselect all
        for (var i = 1; i <= comp.numLayers; i++) {
            comp.layer(i).selected = false;
        }

        // Select target layer
        if (layerIndex >= 1 && layerIndex <= comp.numLayers) {
            comp.layer(layerIndex).selected = true;
            return result(true);
        }

        return result(false, null, 'Invalid layer index');
    } catch (e) {
        return result(false, null, 'Select layer error: ' + e.toString());
    }
}

/**
 * Check if Pulse is working (used for connection test)
 */
function pulse_ping() {
    return result(true, {
        version: '1.0.0',
        aeVersion: app.version
    });
}
