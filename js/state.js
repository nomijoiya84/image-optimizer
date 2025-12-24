/**
 * Global application state
 */

export let uploadedFiles = [];
export let optimizedImages = [];
export let optimizedPreviews = [];
export let fileSettings = []; // Track per-file settings like format
export let isOptimizing = false;
export let batchGridVisible = false;
export let formatSupportMap = {};
export let imageFeatureCache = [];
export let motionDetectionCache = new WeakMap();

// Lock mechanism to prevent race conditions during file operations
// Tracks which file indices are currently being processed
export const fileOperationLocks = new Set();

/**
 * Attempt to acquire a lock for a file index
 * @param {number} index - File index to lock
 * @returns {boolean} - True if lock acquired, false if already locked
 */
export function acquireFileLock(index) {
    if (fileOperationLocks.has(index)) {
        return false;
    }
    fileOperationLocks.add(index);
    return true;
}

/**
 * Release a lock for a file index
 * @param {number} index - File index to unlock
 */
export function releaseFileLock(index) {
    fileOperationLocks.delete(index);
}

/**
 * Check if a file index is currently locked
 * @param {number} index - File index to check
 * @returns {boolean} - True if locked
 */
export function isFileLocked(index) {
    return fileOperationLocks.has(index);
}

// State management functions
export function setIsOptimizing(val) { isOptimizing = val; }
export function setUploadedFiles(val) { uploadedFiles = val; }
export function setOptimizedImages(val) { optimizedImages = val; }
export function setOptimizedPreviews(val) { optimizedPreviews = val; }
export function setFileSettings(val) { fileSettings = val; }
export function setBatchGridVisible(val) { batchGridVisible = val; }
export function setFormatSupportMap(val) { formatSupportMap = val; }
export function setImageFeatureCache(val) { imageFeatureCache = val; }

