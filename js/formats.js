/**
 * Image format detection and recommendation logic
 */

import { FORMAT_DEFINITIONS, FORMAT_PRIORITY_ORDER, WASM_CODEC_SOURCES } from './constants.js';
import {
    formatSupportMap,
    setFormatSupportMap,
    imageFeatureCache,
    motionDetectionCache,
    uploadedFiles
} from './state.js';
import { elements } from './dom.js';

// Detected for potential future use - SIMD can significantly speed up WASM encoding
let wasmSimdSupported = false;

/**
 * Check if a format is supported by the browser (native or WASM)
 */
export function isFormatSupported(format) {
    return !!formatSupportMap[format];
}

/**
 * Check if a format is natively supported for encoding by the browser
 */
export function isNativeSupported(format) {
    const mime = FORMAT_DEFINITIONS[format]?.mime;
    if (!mime) return false;

    // Check if it's already in the support map AND was detected as native
    // We'll mark native support during initialization
    return !!formatSupportMap[`native_${format}`];
}

/**
 * Check if a format can be displayed by the browser
 */
export function isBrowserDisplaySupported(format) {
    if (format === 'jxl') return false; // Native JXL display is rare
    if (format === 'avif') {
        // Only return true if the browser has native AVIF support detection
        return !!formatSupportMap['native_avif_decoding'];
    }
    return true; // JPEG, PNG, WebP are safe
}

/**
 * Check if a format supports variable quality (lossy) compression
 */
export function supportsQuality(format) {
    const lossless = FORMAT_DEFINITIONS[format]?.lossless;
    // Currently PNG is our only strictly lossless format in definitions
    return !lossless;
}

/**
 * Find the best supported fallback format
 */
export function findFirstSupportedFormat() {
    return FORMAT_PRIORITY_ORDER.find(f => isFormatSupported(f)) || 'jpeg';
}

/**
 * Initialize support map by checking native capabilities and WASM presence
 */
export async function initializeFormatSupport() {
    const canvas = document.createElement('canvas');
    const newSupportMap = {};

    // Check for WASM SIMD support if available
    try {
        const { simd } = await import('/js/vendor/wasm-feature-detect/dist/esm/index.js');
        wasmSimdSupported = await simd();
        console.log(`WASM SIMD Support: ${wasmSimdSupported ? 'Yes' : 'No'}`);
        // Store SIMD status in support map for workers to access
        newSupportMap.simd = wasmSimdSupported;
    } catch (e) {
        console.warn('WASM feature detection failed, assuming no SIMD');
        newSupportMap.simd = false;
    }

    Object.entries(FORMAT_DEFINITIONS).forEach(([format, definition]) => {
        if (!definition.mime) return;
        try {
            const dataUrl = canvas.toDataURL(definition.mime);
            const native = typeof dataUrl === 'string' && dataUrl.startsWith(`data:${definition.mime}`);
            newSupportMap[format] = native;
            newSupportMap[`native_${format}`] = native;
        } catch (error) {
            newSupportMap[format] = false;
            newSupportMap[`native_${format}`] = false;
        }
    });

    // Ensure baseline formats
    newSupportMap.jpeg = true;
    newSupportMap.native_jpeg = true;
    newSupportMap.png = true;
    newSupportMap.native_png = true;

    // Override with WASM-backed support guarantees
    Object.keys(WASM_CODEC_SOURCES).forEach((format) => {
        // JXL strictly requires SharedArrayBuffer for the WASM encoder in many cases
        if (format === 'jxl' && !hasSharedArrayBufferSupport()) {
            // Check if native support exists (unlikely in most browsers but possible)
            if (!newSupportMap['native_jxl']) {
                newSupportMap[format] = false;
                return;
            }
        }

        newSupportMap[format] = true;
    });

    // Check for native AVIF Decoding support (distinct from Encoding)
    // Many browsers (Chrome, Edge, Firefox) support displaying AVIF even if they can't encode it via Canvas
    try {
        const avifData = 'data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAG1pZjFtaWFmTWExMwgAAAAAM21ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAHBpY3QAAAAAAAAAAAAAAAAAAAAVDaXRlbQAAAAAAAAABgWlbmYAAAAA5aWxvYwAAAAAAAAAB8AAAAAgAAAAAAADgZmluZmUAAAAAAAABAQAAABhhdjAxQ29sb3IAAAAAAAABAAAACWlQURPwAAAFZG1kYXQBAAAADAYIkoKQAiDiAA==';
        const img = new Image();
        const decodingPromise = new Promise((resolve) => {
            img.onload = () => resolve(true);
            img.onerror = () => resolve(false);
            img.src = avifData;
        });
        // Timeout after 150ms to strictly avoid blocking startup
        const timeoutPromise = new Promise(r => setTimeout(() => r(false), 150));
        newSupportMap.native_avif_decoding = await Promise.race([decodingPromise, timeoutPromise]);
    } catch (e) {
        newSupportMap.native_avif_decoding = false;
    }

    setFormatSupportMap(newSupportMap);
    applyAdvancedFormatConstraints();

    // Check for Cross-Origin Isolation (required for SharedArrayBuffer / effective JXL)
    if (!globalThis.crossOriginIsolated) {
        console.warn('Site is not cross-origin isolated. Multithreading for WASM codecs will be limited.');
        if (elements.formatWarning) {
            elements.formatWarning.innerHTML = `⚠️ <strong>Limited performance:</strong> Cross-origin isolation is not enabled. Advanced formats like JXL might be slow or fail.`;
            elements.formatWarning.hidden = false;
        }
    }
}

/**
 * Check if WASM SIMD is supported - useful for encoding optimization decisions
 * @returns {boolean}
 */
export function isSimdSupported() {
    return wasmSimdSupported;
}

/**
 * Apply constraints based on advanced features (e.g. SharedArrayBuffer)
 */
export function applyAdvancedFormatConstraints() {
    if (!hasSharedArrayBufferSupport()) {
        // JXL encoder currently requires SharedArrayBuffer
        if (!isNativeSupported('jxl')) {
            console.warn('SharedArrayBuffer not available. Disabling JXL WASM support.');
            formatSupportMap.jxl = false;
        }
    }
}

/**
 * Check for SharedArrayBuffer support
 */
export function hasSharedArrayBufferSupport() {
    return typeof SharedArrayBuffer !== 'undefined';
}

/**
 * Sync the format dropdown UI with support map
 */
export function syncFormatSelectWithSupport() {
    const select = elements.formatSelect;
    if (!select) return;

    Array.from(select.options || []).forEach((option) => {
        const format = option.value;
        const baseLabel = option.getAttribute('data-label') || option.textContent;

        if (!option.hasAttribute('data-label')) {
            option.setAttribute('data-label', baseLabel);
        }

        if (format === 'auto') {
            option.disabled = false;
            option.textContent = baseLabel;
            return;
        }

        const supported = isFormatSupported(format);
        option.disabled = !supported;
        option.textContent = supported ? baseLabel : `${baseLabel} (unsupported)`;
    });
}

/**
 * Detect if an image has transparency or animation
 * Note: Auto mode prefers WebP because it uses native browser encoding (instant).
 * AVIF/JXL require slow WASM encoding, so they should be an explicit user choice.
 */
export async function detectImageFeatures(img, file) {
    const hasAlpha = hasTransparency(img);
    const isAnimated = await isAnimatedImage(file);

    // Default recommendation strategy:
    // 1. WebP is preferred for all cases (native encoding, good compression, supports alpha/animation)
    // 2. JPEG as fallback if WebP not supported and image has no alpha
    // 3. PNG as final fallback for images with alpha when WebP not supported
    let recommendation = 'webp';

    if (!isFormatSupported('webp')) {
        // WebP not supported, choose based on image features
        if (hasAlpha || isAnimated) {
            recommendation = 'png'; // PNG supports alpha and simple animation
        } else {
            recommendation = 'jpeg'; // JPEG is smaller for photos without alpha
        }
    }

    return { hasAlpha, isAnimated, recommendation };
}

/**
 * Resolve the final output format based on selection and features
 */
export function resolveOutputFormat(selectedFormat, features) {
    if (selectedFormat !== 'auto') {
        return ensureFormatSupported(selectedFormat);
    }
    return features ? features.recommendation : 'jpeg';
}

/**
 * Ensure requested format is supported, fallback if not
 */
export function ensureFormatSupported(format) {
    if (isFormatSupported(format)) {
        return format;
    }
    const fallback = findFirstSupportedFormat();
    console.warn(`Format ${format} is not supported. Falling back to ${fallback}.`);
    return fallback;
}

/**
 * Get human readable label for format
 */
export function getFormatLabel(format) {
    return FORMAT_DEFINITIONS[format]?.label || format.toUpperCase();
}

/**
 * Get MIME type for format
 */
export function getMimeTypeForFormat(format) {
    return FORMAT_DEFINITIONS[format]?.mime || 'image/jpeg';
}

/**
 * Get fallback order for encoding attempts
 * Prioritizes native formats (webp, jpeg, png) over WASM formats (avif, jxl) for speed
 */
export function getFallbackOrder(preferredFormat) {
    // If preferred is a WASM format (avif/jxl), fallback to native formats
    const wasmFormats = ['avif', 'jxl'];
    const isWasmPreferred = wasmFormats.includes(preferredFormat);

    const order = [preferredFormat];

    // Always have WebP as first fallback (fast, native encoding)
    if (preferredFormat !== 'webp') order.push('webp');
    if (preferredFormat !== 'jpeg') order.push('jpeg');
    if (preferredFormat !== 'png') order.push('png');

    // Only add WASM formats as last resort if they weren't the preferred choice
    if (!isWasmPreferred) {
        // Don't add avif/jxl as fallbacks - they're slow WASM formats
        // Only use them if explicitly requested
    }

    return [...new Set(order)];
}

// Private helper for transparency
function hasTransparency(img) {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    // Check corners and center for alpha
    const positions = [
        [0, 0], [img.width - 1, 0], [0, img.height - 1],
        [img.width - 1, img.height - 1], [Math.floor(img.width / 2), Math.floor(img.height / 2)]
    ];

    for (const [x, y] of positions) {
        ctx.clearRect(0, 0, 1, 1);
        ctx.drawImage(img, x, y, 1, 1, 0, 0, 1, 1);
        const data = ctx.getImageData(0, 0, 1, 1).data;
        if (data[3] < 255) return true;
    }
    return false;
}

// Private helper for animation detection
async function isAnimatedImage(file) {
    if (motionDetectionCache.has(file)) {
        return motionDetectionCache.get(file);
    }

    let isAnimated = false;

    // Basic MIME check
    if (file.type === 'image/gif') {
        // GIF is always assumed animated (most are)
        isAnimated = true;
    } else if (file.type === 'image/webp') {
        // Deep check for WebP animation (looks for 'ANIM' chunk)
        try {
            const buffer = await file.slice(0, 100).arrayBuffer();
            const arr = new Uint8Array(buffer);
            const str = Array.from(arr).map(b => String.fromCharCode(b)).join('');
            isAnimated = str.includes('ANIM');
        } catch (e) {
            console.warn('Failed to check WebP animation', e);
        }
    } else if (file.type === 'image/png' || file.type === 'image/apng') {
        // Check for APNG animation by looking for 'acTL' chunk (animation control)
        try {
            const buffer = await file.slice(0, 200).arrayBuffer();
            const arr = new Uint8Array(buffer);
            const str = Array.from(arr).map(b => String.fromCharCode(b)).join('');
            // APNG has 'acTL' chunk for animation control
            isAnimated = str.includes('acTL');
        } catch (e) {
            console.warn('Failed to check APNG animation', e);
        }
    }

    // Cache the result using the file object itself
    motionDetectionCache.set(file, isAnimated);
    return isAnimated;
}

/**
 * Update the format recommendation text in the UI
 */
export function updateFormatRecommendationUI(forceReset = false) {
    const textEl = elements.formatRecommendation;
    if (!textEl) return;

    if (!uploadedFiles.length) {
        textEl.textContent = 'Upload images to see format recommendations.';
        return;
    }

    if (forceReset || !imageFeatureCache.some(Boolean)) {
        textEl.textContent = 'Analyzing images for best formats...';
        return;
    }

    const stats = imageFeatureCache.reduce((acc, features) => {
        if (!features) return acc;
        acc.total += 1;
        acc.counts[features.recommendation] = (acc.counts[features.recommendation] || 0) + 1;
        if (features.isAnimated) acc.animated += 1;
        if (features.hasAlpha) acc.alpha += 1;
        return acc;
    }, { total: 0, counts: {}, animated: 0, alpha: 0 });

    if (!stats.total) {
        textEl.textContent = 'Analyzing images for best formats...';
        return;
    }

    const sorted = Object.entries(stats.counts).sort((a, b) => b[1] - a[1]);
    if (sorted.length === 0) {
        textEl.textContent = 'Analyzing images for best formats...';
        return;
    }
    const topFormat = sorted[0][0];
    const topLabel = getFormatLabel(topFormat);

    let message = `Recommended: <strong>${topLabel}</strong>`;
    if (stats.alpha > 0) message += ` (handles transparency)`;
    if (stats.animated > 0) message += ` (supports animation)`;

    textEl.innerHTML = message;
}
