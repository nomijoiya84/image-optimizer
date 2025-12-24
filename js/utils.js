/**
 * Utility functions for Image Optimizer
 */

// Memory management for object URLs
const revocableUrls = new Set();

/**
 * Safely revoke a blob URL to free up memory
 * @param {string} url 
 */
export function safeRevokeUrl(url) {
    if (url && url.startsWith('blob:') && revocableUrls.has(url)) {
        URL.revokeObjectURL(url);
        revocableUrls.delete(url);
    }
}

/**
 * Create a pointer URL from a blob and track it for later revocation
 * @param {Blob} blob 
 * @returns {string}
 */
export function createPointerUrl(blob) {
    const url = URL.createObjectURL(blob);
    revocableUrls.add(url);
    return url;
}

/**
 * Format bytes to human readable file size
 * @param {number} bytes 
 * @returns {string}
 */
export function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const sign = bytes < 0 ? -1 : 1;
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const absoluteBytes = Math.abs(bytes);
    const i = Math.floor(Math.log(absoluteBytes) / Math.log(k));
    const value = Math.round(absoluteBytes / Math.pow(k, i) * 100) / 100;
    const formatted = value + ' ' + sizes[i];
    return sign < 0 ? `-${formatted}` : formatted;
}

/**
 * Calculate saved size between original and optimized
 * @param {number} originalSize 
 * @param {number} optimizedSize 
 * @returns {string}
 */
export function calculateSavings(originalSize, optimizedSize) {
    const saved = originalSize - optimizedSize;
    return formatFileSize(saved);
}

/**
 * Get numerical compression percentage
 */
export function getCompressionPercentage(originalSize, optimizedSize) {
    if (!originalSize) return 0;
    return Math.round((1 - optimizedSize / originalSize) * 100);
}

/**
 * Get human readable compression label
 */
export function getCompressionLabel(originalSize, optimizedSize) {
    if (!originalSize) {
        return '0% change';
    }
    const percentage = getCompressionPercentage(originalSize, optimizedSize);
    return percentage >= 0 ? `${percentage}% smaller` : `${Math.abs(percentage)}% larger`;
}

/**
 * Get CSS class based on compression quality
 */
export function getCompressionBadgeClass(originalSize, optimizedSize) {
    const percentage = getCompressionPercentage(originalSize, optimizedSize);
    if (percentage >= 50) return 'excellent';
    if (percentage >= 20) return 'good';
    return '';
}

/**
 * Simple HTML escaping
 */
export function escapeHTML(str) {
    if (!str) return '';
    const p = document.createElement('p');
    p.textContent = str;
    return p.innerHTML;
}

/**
 * Convert dataURL to Blob
 */
export async function dataURLtoBlob(dataurl) {
    const response = await fetch(dataurl);
    return await response.blob();
}

/**
 * Convert Blob to dataURL
 */
export function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

/**
 * Get the optimized filename based on original name and target format
 * @param {string} originalName 
 * @param {string} format 
 * @returns {string}
 */
export function getOptimizedFileName(originalName, format) {
    const nameWithoutExt = originalName && originalName.lastIndexOf('.') > 0
        ? originalName.substring(0, originalName.lastIndexOf('.'))
        : (originalName || 'image');

    // Fallback if format is not in definitions
    const extension = format;
    return `${nameWithoutExt}_optimized.${extension}`;
}

/**
 * Run a list of async tasks with concurrency limit
 * @param {Array<Function>} tasks - Array of functions that return a promise
 * @param {number} concurrency - Max parallel tasks
 */
export async function runWithConcurrency(tasks, concurrency) {
    const results = [];
    const executing = [];
    for (const task of tasks) {
        const p = task().then(res => {
            executing.splice(executing.indexOf(p), 1);
            return res;
        });
        results.push(p);
        executing.push(p);
        if (executing.length >= concurrency) {
            await Promise.race(executing);
        }
    }
    return Promise.all(results);
}

