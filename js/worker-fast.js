/**
 * Fast Image Optimization Worker - Optimized for performance
 * Uses aggressive heuristics to reach target size quickly.
 */

import {
    FORMAT_DEFINITIONS,
    WASM_CODEC_SOURCES,
    DEFAULT_QUALITY,
    MAX_RESIZE_ITERATIONS,
    MIN_QUALITY
} from './constants.js';

// Cache for loaded WASM modules
const wasmCodecCache = {};
let wasmWarmupPromise = null;
let isWarmedUp = false;
let warmupStarted = false;

// Unique ID counter for timer management (prevents timer collision warnings)
let timerIdCounter = 0;

// Log worker start but DON'T start WASM loading immediately
// WASM will load lazily when first needed OR when explicitly requested
console.log('[Worker] Worker started. WASM will load on-demand or when requested.');

/**
 * Handle incoming messages from main thread
 */
self.onmessage = async (e) => {
    const { id, type, file, settings } = e.data;

    try {
        if (type === 'optimizeWithSettings') {
            const result = await processWithSettings(file, settings);
            self.postMessage({ id, success: true, result });
        } else if (type === 'optimizeToTargetSize') {
            const result = await processToTargetSize(file, settings);
            self.postMessage({ id, success: true, result });
        } else if (type === 'warmup') {
            // Start warmup if not already started
            if (!warmupStarted) {
                warmupStarted = true;
                console.log('[Worker] Warmup requested, starting WASM preload...');
                const startTime = performance.now();
                wasmWarmupPromise = (async () => {
                    try {
                        await warmup();
                        isWarmedUp = true;
                        console.log(`[Worker] WASM preload complete in ${(performance.now() - startTime).toFixed(0)}ms`);
                    } catch (err) {
                        console.warn('[Worker] WASM preload failed (will use native fallbacks):', err);
                        isWarmedUp = true; // Mark as done even on failure
                    }
                })();
            }
            await wasmWarmupPromise;
            console.log('[Worker] Warmup complete, WASM modules loaded');
            // Signal to main thread that warmup is complete
            self.postMessage({ type: 'warmupComplete' });
        }
    } catch (error) {
        console.error('Worker optimization error:', error);
        self.postMessage({ id, success: false, error: error.message || 'Unknown error in worker' });
    }
};

/**
 * Pre-load WASM codecs
 */
async function warmup() {
    try {
        const formats = Object.keys(WASM_CODEC_SOURCES);
        // Load each format and log timing
        const results = await Promise.allSettled(formats.map(async fmt => {
            const t0 = performance.now();
            await loadWasmCodec(fmt);
            console.log(`[Worker] Loaded ${fmt} in ${(performance.now() - t0).toFixed(0)}ms`);
        }));
        results.forEach((r, i) => {
            if (r.status === 'rejected') {
                console.warn(`[Worker] Failed to load ${formats[i]}:`, r.reason);
            }
        });
    } catch (err) {
        console.warn('Worker warmup failed (partial):', err);
    }
}

/**
 * Optimize with fixed settings
 */
async function processWithSettings(file, { quality, maxW, maxH, format }) {
    const imgBitmap = await createImageBitmap(file);
    const canvas = resizeImage(imgBitmap, maxW, maxH);
    imgBitmap.close();

    // Use user's quality setting, but cap at 0.92 for practical limits
    const effectiveQuality = Math.min(quality, 0.92);
    const result = await encodeCanvasWithFallback(canvas, format, effectiveQuality);

    if (!result) throw new Error('Failed to encode image.');

    let previewBlob = null;
    if (!result.isDisplayable) {
        previewBlob = await generatePreview(canvas);
    }
    return { ...result, previewBlob };
}

/**
 * Fast optimization to reach target size with Binary Search & Smart Resizing
 */
async function processToTargetSize(file, { targetSize, maxW, maxH, format }) {
    const timerId = `processToTargetSize_${timerIdCounter++}`;
    console.time(timerId);
    const imgBitmap = await createImageBitmap(file);

    try {
        // 1. Initial Smart Resize
        // If the original image is massive and target is tiny, pre-scale aggressively
        // to avoid wasting time encoding a 4K image to 50KB.
        let currentW = imgBitmap.width;
        let currentH = imgBitmap.height;

        // Initial constraint resize
        if (currentW > maxW || currentH > maxH) {
            const ratio = Math.min(maxW / currentW, maxH / currentH);
            currentW = Math.round(currentW * ratio);
            currentH = Math.round(currentH * ratio);
        }

        // Feature: Heuristic pre-downscale for very small targets
        // If target < 100KB and image > 2000px, downscale immediately
        if (targetSize < 100 * 1024 && (currentW > 1600 || currentH > 1600)) {
            const scale = 0.6; // Safety start
            currentW = Math.round(currentW * scale);
            currentH = Math.round(currentH * scale);
            console.log(`[Worker] Smart pre-resize for small target: ${currentW}x${currentH}`);
        }

        let currentCanvas = resizeImage(imgBitmap, currentW, currentH);

        // 2. Variable Initialization for Binary Search
        let minQ = MIN_QUALITY;
        let maxQ = 0.95;
        let currentQ = 0.8; // Optimistic start

        // Smart Quality Estimate based on approx pixels vs target size
        // (Very rough: 0.15 bytes per pixel for decent JPEG/WebP)
        const totalPixels = currentW * currentH;
        const bytesPerPixel = targetSize / totalPixels;
        if (bytesPerPixel < 0.1) currentQ = 0.6;
        if (bytesPerPixel < 0.05) currentQ = 0.4;

        let result = null;
        let bestResult = null;
        let iterations = 0;
        const MAX_ATTEMPTS = 15;
        // 3. Optimization Loop
        while (iterations < MAX_ATTEMPTS) {
            iterations++;

            // Encode
            console.log(`[Worker] Pass ${iterations}: Q=${currentQ.toFixed(3)}`);
            result = await encodeCanvasWithFallback(currentCanvas, format, currentQ);

            if (!result) throw new Error('Encoding failed');

            const size = result.blob.size;

            // Check success
            if (size <= targetSize) {
                bestResult = result;
                // If we are close enough (within 10% of target or maxQ reached), stop
                // Or if we are already at high quality
                if (size > targetSize * 0.9 || currentQ >= maxQ - 0.05) {
                    break;
                }
                // Can we go higher?
                minQ = currentQ;
            } else {
                // Too big
                if (!supportsQuality(format)) {
                    // Lossless format: Quality adjustments are futile.
                    // Force convergence to trigger resize immediately.
                    console.log(`[Worker] ${format} is lossless/fixed. Skipping quality loop.`);
                    maxQ = minQ;
                } else {
                    maxQ = currentQ;
                }
            }

            // Next Move logic
            if (maxQ - minQ < 0.05) {
                // Quality range exhausted (converged)
                // If we found a valid result, great.
                if (bestResult) {
                    result = bestResult;
                    break;
                }

                // If we are here, even MIN_QUALITY is too big.
                // WE MUST RESIZE.
                console.log('[Worker] Quality floor hit, triggering resize.');

                // Calculate resize scale needed
                const ratio = targetSize / size;
                const scale = Math.sqrt(ratio) * 0.95; // 0.95 safety factor

                currentW = Math.max(100, Math.floor(currentW * scale));
                currentH = Math.max(100, Math.floor(currentH * scale));

                // Update canvas
                const nextCanvas = resizeImage(currentCanvas, currentW, currentH);
                currentCanvas = nextCanvas; // Old one GC'd?

                // Reset quality search for new size
                // We can be optimistic again now that we are smaller
                minQ = MIN_QUALITY;
                maxQ = 0.92;
                currentQ = 0.75;

                // Reset binary search bounds? 
                // Actually, let's just make valid bounds.
                continue;
            }

            // Binary search step
            currentQ = (minQ + maxQ) / 2;
        }

        // If after all attempts we have no valid result (unlikely with resize), return the last one
        // (It might be slightly over target if extreme edge case, handled by UI warning or acceptor)
        const finalRes = bestResult || result;

        // Optimization: Only generate preview if the main format is NOT natively displayable
        // (For displayable formats like JPEG/PNG, the UI uses the main blob directly)
        let previewBlob = null;
        if (!finalRes.isDisplayable) {
            previewBlob = await generatePreview(currentCanvas);
        }

        try { console.timeEnd(timerId); } catch (e) { /* Timer already ended or doesn't exist */ }
        return { ...finalRes, previewBlob };

    } finally {
        imgBitmap.close();
    }
}

// --- Helpers (Shared with regular worker) ---

function resizeImage(source, maxW, maxH) {
    let width = source.width;
    let height = source.height;

    if (width > maxW) {
        height = Math.round((height * maxW) / width);
        width = maxW;
    }
    if (height > maxH) {
        width = Math.round((width * maxH) / height);
        height = maxH;
    }

    // Ensure minimum dimensions to prevent zero-dimension canvas errors
    width = Math.max(1, width);
    height = Math.max(1, height);

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'medium'; // 'medium' is faster than 'high'
    ctx.drawImage(source, 0, 0, width, height);
    return canvas;
}

async function generatePreview(canvas) {
    let previewCanvas = canvas;
    if (canvas.width > 800 || canvas.height > 800) {
        const scale = Math.min(1, 800 / Math.max(canvas.width, canvas.height));
        previewCanvas = resizeImage(canvas, canvas.width * scale, canvas.height * scale);
    }
    return await previewCanvas.convertToBlob({ type: 'image/webp', quality: 0.5 });
}

async function encodeCanvasWithFallback(canvas, preferredFormat, quality) {
    // WebP is the preferred primary format (native browser encoding = fast)
    // AVIF/JXL are WASM-based (slow) and should only be used when explicitly requested
    const wasmFormats = Object.keys(WASM_CODEC_SOURCES);
    const isWasmFormat = wasmFormats.includes(preferredFormat);

    let attempts = [];

    if (isWasmFormat) {
        // User explicitly requested a WASM format (avif/jxl)
        // Try to load and use it, even if not pre-warmed (on-demand loading)
        // Fallback to native formats if it fails
        attempts = [preferredFormat, 'webp', 'jpeg', 'png'];
    } else {
        // Native format requested (webp, jpeg, png) - use it directly
        // No WASM formats in fallback chain for speed
        attempts = [preferredFormat];
        if (preferredFormat !== 'webp') attempts.push('webp');
        if (preferredFormat !== 'jpeg') attempts.push('jpeg');
        if (preferredFormat !== 'png') attempts.push('png');
    }

    attempts = [...new Set(attempts)];

    const errors = [];
    for (const format of attempts) {
        try {
            const t0 = performance.now();
            const res = await tryEncodeCanvas(canvas, format, quality);
            if (res) {
                console.log(`[Worker] Encoded with ${format} in ${(performance.now() - t0).toFixed(0)}ms`);
                return res;
            }
            errors.push(`${format}: returned null`);
        } catch (e) {
            errors.push(`${format}: ${e.message}`);
        }
    }

    // If we are here, everything failed.
    console.error('All encoding attempts failed:', errors);
    throw new Error(`Encoding failed for all formats: ${attempts.join(', ')}. Details: ${errors.join('; ')}`);
}

async function tryEncodeCanvas(canvas, format, quality) {
    const definition = FORMAT_DEFINITIONS[format];
    if (!definition?.mime) return null;

    try {
        if (format === 'avif' || format === 'jxl') {
            // WASM-only formats - if WASM fails, we must fail this format
            // (browsers don't natively support encoding these)
            return await encodeWithWasm(canvas, format, quality);
        }
        // Native format (webp, jpeg, png)
        return await encodeNative(canvas, definition.mime, quality, format);
    } catch (e) {
        console.warn(`tryEncodeCanvas failed for ${format}:`, e.message);
        return null; // Return null to trigger fallback to next format
    }
}

async function encodeNative(canvas, mime, quality, format) {
    const blob = await canvas.convertToBlob({ type: mime, quality });
    return {
        blob,
        formatUsed: format,
        isDisplayable: true
    };
}

async function encodeWithWasm(canvas, format, quality) {
    const encodeFn = await loadWasmCodec(format);
    if (!encodeFn) throw new Error(`WASM encoder for ${format} not available`);

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const options = buildWasmOptions(format, quality);

    const encodedBuffer = await encodeFn(imageData, options);
    const mimeType = FORMAT_DEFINITIONS[format]?.mime || 'image/jpeg';
    const blob = new Blob([encodedBuffer], { type: mimeType });

    return {
        blob,
        formatUsed: format,
        isDisplayable: false
    };
}



async function loadWasmCodec(format) {
    if (!WASM_CODEC_SOURCES[format]) return null;
    if (!wasmCodecCache[format]) {
        wasmCodecCache[format] = (async () => {
            try {
                const mod = await import(WASM_CODEC_SOURCES[format]);
                // console.log(`[Worker] Loaded module for ${format}. Keys: ${Object.keys(mod)}`);

                const encodeFn = mod.encode || mod.default;

                // Check if 'init' exists and is a function, AND is not the same as the encode function
                // (Some builds might accidentally alias them or export them strangely)
                if (mod.init && typeof mod.init === 'function' && mod.init !== encodeFn) {
                    try {
                        // console.log(`[Worker] Initializing ${format}...`);
                        await mod.init();
                        // console.log(`[Worker] Initialized ${format}.`);
                    } catch (e) {
                        // If it fails with the specific data error, it was likely the encode function after all
                        if (e.message && e.message.includes("reading 'data'")) {
                            console.warn(`[Worker] 'init' failed with data error (likely alias to encode). Ignoring.`);
                        } else {
                            console.warn(`[Worker] Initialization for ${format} failed (non-critical if module self-inits):`, e);
                        }
                    }
                }

                return encodeFn;
            } catch (error) {
                console.error(`Worker failed to load ${format}`, error);
                throw error;
            }
        })();
    }
    return wasmCodecCache[format];
}

function buildWasmOptions(format, quality) {
    const normalizedQuality = Math.max(0.05, Math.min(1, quality));
    if (format === 'avif') {
        const cqLevel = Math.round((1 - normalizedQuality) * 45) + 5;
        return {
            cqLevel,
            cqAlphaLevel: cqLevel,
            effort: 1, // Reduced from 3 for much faster encoding (2-5x speedup)
            subsample: 1
        };
    }
    if (format === 'jxl') {
        return {
            quality: Math.round(normalizedQuality * 100),
            effort: 1 // Reduced from 3 for much faster encoding
        };
    }
    return {};
}

function supportsQuality(format) {
    return !FORMAT_DEFINITIONS[format]?.lossless;
}
