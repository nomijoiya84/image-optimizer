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
let detectedCapabilities = { simd: false, threads: false };

// Unique ID counter for timer management
let timerIdCounter = 0;

// Log worker start but DON'T start WASM loading immediately
console.log('[Worker] Worker started. WASM will load on-demand or when requested.');

// Feature detection
const capabilitiesPromise = (async () => {
    try {
        // Detect Threads (SharedArrayBuffer)
        detectedCapabilities.threads = typeof SharedArrayBuffer !== 'undefined';

        // Detect SIMD
        try {
            const { simd } = await import('./vendor/wasm-feature-detect/dist/esm/index.js');
            detectedCapabilities.simd = await simd();
        } catch (e) {
            // If module import fails, try a simple manual check or default to false
            detectedCapabilities.simd = WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 253, 15, 253, 98, 11]));
        }

        console.log(`[Worker] Capabilities detected: SIMD=${detectedCapabilities.simd}, Threads=${detectedCapabilities.threads}`);
    } catch (e) {
        console.warn('[Worker] Capability detection error:', e);
    }
})();

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
        let resizeCount = 0; // Track resize iterations to prevent infinite loops
        const MAX_RESIZES = 3;

        // OPTIMIZATION: Reduce max attempts for slow WASM formats (AVIF/JXL)
        const isWasm = (format === 'avif' || format === 'jxl');
        const MAX_ATTEMPTS = isWasm ? 6 : 15;

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

                // Success Condition:
                // 1. Close enough (within 15% of target)
                // 2. High quality already (maxQ close to top)
                // 3. WASM "Good Enough" check (avoid re-encoding if we are reasonably close to save time)

                const ratio = size / targetSize;
                const isAcceptable = ratio > 0.85; // If we are at 85% of target, that's good filling

                if (isAcceptable || currentQ >= maxQ - 0.05) {
                    console.log(`[Worker] Target met early. Size: ${size}, Target: ${targetSize}`);
                    break;
                }

                // If we are REALLY small (like 50% of target), we SHOULD try to increase quality
                // EXCEPT for WASM where every pass costs ~1-2 seconds.
                if (isWasm && iterations >= 2 && ratio > 0.7) {
                    console.log(`[Worker] WASM optimization: Accepting 70%+ fill after 2 passes to save time.`);
                    break;
                }

                // Try higher
                minQ = currentQ;
            } else {
                // Too big
                if (!supportsQuality(format)) {
                    console.log(`[Worker] ${format} is mostly fixed/lossless. Skipping loop.`);
                    maxQ = minQ;
                } else {
                    maxQ = currentQ;
                }
            }

            // Next Move logic
            if (maxQ - minQ < 0.04) {
                // Converged
                if (bestResult) {
                    result = bestResult;
                    break;
                }
                // If no best result (always > target), force resize logic below
                console.log('[Worker] Converged but still too big. Resizing.');

                // Smart Resize Calc
                const ratio = targetSize / size;
                const scale = Math.sqrt(ratio) * 0.95;
                currentW = Math.max(100, Math.floor(currentW * scale));
                currentH = Math.max(100, Math.floor(currentH * scale));

                currentCanvas = resizeImage(currentCanvas, currentW, currentH);

                // Reset Search
                minQ = MIN_QUALITY;
                maxQ = 0.92;
                currentQ = 0.75;

                // Reset iterations budget
                iterations = 0;
                resizeCount++;

                // Prevent infinite resize loop
                if (resizeCount >= MAX_RESIZES) {
                    console.log('[Worker] Max resize iterations reached. Returning best result.');
                    break;
                }

                continue;
            }


            // Binary search step
            currentQ = (minQ + maxQ) / 2;
        }

        // If after all attempts we have no valid result, return the last one
        const finalRes = bestResult || result;

        // Guard against null result (all encoding attempts failed)
        if (!finalRes || !finalRes.blob) {
            throw new Error('All encoding attempts failed - no valid result produced');
        }

        // Optimization: Only generate preview if the main format is NOT natively displayable
        let previewBlob = null;
        if (!finalRes.isDisplayable) {
            previewBlob = await generatePreview(currentCanvas);
        }

        try { console.timeEnd(timerId); } catch (e) { /* */ }
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
    ctx.imageSmoothingQuality = 'high'; // 'high' for better quality downscaling
    ctx.drawImage(source, 0, 0, width, height);
    return canvas;
}

async function generatePreview(canvas) {
    // Only resize if canvas is larger than preview size
    const maxPreviewDim = 800;
    if (canvas.width <= maxPreviewDim && canvas.height <= maxPreviewDim) {
        // Canvas is small enough, use directly
        return await canvas.convertToBlob({ type: 'image/webp', quality: 0.5 });
    }

    const scale = maxPreviewDim / Math.max(canvas.width, canvas.height);
    const previewCanvas = resizeImage(canvas, Math.round(canvas.width * scale), Math.round(canvas.height * scale));
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
                // Ensure capabilities are checked (for other uses)
                await capabilitiesPromise;

                const sourceUrl = WASM_CODEC_SOURCES[format];
                console.log(`[Worker] Loading ${format} codec from: ${sourceUrl}`);

                const mod = await import(sourceUrl);
                const encodeFn = mod.encode || mod.default;

                if (!encodeFn) throw new Error(`Codec ${format} does not export an encode function`);

                // Pre-initialize the module if 'init' is available
                if (mod.init && typeof mod.init === 'function') {
                    try {
                        await mod.init();
                    } catch (e) {
                        // Ignore known benign errors during init
                        if (!e.message?.includes("reading 'data'")) {
                            console.warn(`[Worker] Initialization for ${format} failed:`, e);
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
    const q100 = Math.round(normalizedQuality * 100);

    if (format === 'avif') {
        return {
            quality: q100,
            qualityAlpha: -1,
            speed: 8, // Fast encoding (range 0-10, 10 is fastest)
            subsample: 1 // YUV420
        };
    }
    if (format === 'jxl') {
        return {
            quality: q100,
            effort: 1 // Fastest encoding (range 1-9, 1 is fastest)
        };
    }
    return {};
}

function supportsQuality(format) {
    return !FORMAT_DEFINITIONS[format]?.lossless;
}
