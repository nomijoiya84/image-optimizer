/**
 * Global constants and definitions
 */

export const FORMAT_DEFINITIONS = {
    auto: { label: 'Auto (Smart)', mime: '', extension: '' },
    jpeg: { label: 'JPEG', mime: 'image/jpeg', extension: 'jpg', supportsAlpha: false },
    png: { label: 'PNG', mime: 'image/png', extension: 'png', supportsAlpha: true, lossless: true },
    webp: { label: 'WebP', mime: 'image/webp', extension: 'webp', supportsAlpha: true, supportsAnimation: true },
    avif: { label: 'AVIF', mime: 'image/avif', extension: 'avif', supportsAlpha: true, supportsAnimation: true },
    jxl: { label: 'JPEG XL', mime: 'image/jxl', extension: 'jxl', supportsAlpha: true }
};

// Priority order: WebP first (native, fast), then AVIF/JXL as fallback (WASM, slower)
export const FORMAT_PRIORITY_ORDER = ['webp', 'jpeg', 'png', 'avif', 'jxl'];

export const WASM_CODEC_SOURCES = {
    avif: './vendor/jsquash-avif/encode.js',
    jxl: './vendor/jsquash-jxl/encode.js'
};

export const DEFAULT_QUALITY = 0.8;
export const MAX_RESIZE_ITERATIONS = 5;
export const MIN_QUALITY = 0.05;
