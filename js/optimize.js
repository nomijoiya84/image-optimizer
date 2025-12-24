/**
 * Core image optimization and encoding logic (Main Thread Interface)
 * Delegates heavy work to correct Web Worker.
 */

import { optimizedImages, optimizedPreviews, uploadedFiles } from './state.js';
import { createPointerUrl, safeRevokeUrl } from './utils.js';

// Worker Pool State
let workers = [];
let nextWorkerIndex = 0;
// Map to track which worker handles which message ID (for response routing)
// key: messageId, value: worker instance
const messageWorkerMap = new Map();

export function initWorker() {
    // Initial warmup with minimal workers (2)
    ensureWorkerReady(2);
}

/**
 * Ensures worker pool is created and sized appropriately.
 * Can be called with a specific desired size or defaults to intelligent sizing.
 */
function ensureWorkerReady(minCount = 0) {
    // Calculate optimal pool size based on current state
    const hardwareLimit = navigator.hardwareConcurrency || 4;
    // Limit based on memory: ~1 worker per GB, capped at hardware limit
    const memoryLimit = navigator.deviceMemory ? Math.floor(navigator.deviceMemory) : 4;

    // Determine effective count of files to process if available
    const fileCount = uploadedFiles && uploadedFiles.length > 0 ? uploadedFiles.length : 0;

    // Determine target size:
    // 1. At least minCount (if provided)
    // 2. Or, fit to fileCount if we have files (up to hardware/memory limits)
    // 3. Fallback to 2
    let targetSize = Math.max(2, minCount);

    if (fileCount > 0) {
        targetSize = Math.max(targetSize, Math.min(fileCount, hardwareLimit, memoryLimit));
    } else if (minCount === 0) {
        // If no files and no minCount specified, just ensure we have base capacity (2)
        targetSize = 2;
    }

    // Hard cap at 16 or hardware limit whatever is reasonable
    targetSize = Math.min(targetSize, hardwareLimit, 16);

    // Dynamic expansion
    if (workers.length < targetSize) {
        console.log(`[Main] Expanding worker pool from ${workers.length} to ${targetSize}...`);
        for (let i = workers.length; i < targetSize; i++) {
            const w = new Worker('js/worker-fast.js?v=2.3', { type: 'module' });
            w.addEventListener('message', (e) => handleWorkerMessage(e, w));
            w.addEventListener('error', (e) => handleWorkerError(e, w));
            workers.push(w);
        }

        // Dedicated warmup for the FIRST worker only (if not already done)
        if (workers.length > 0 && !workers[0].hasWarmupTriggered) {
            workers[0].hasWarmupTriggered = true;
            setTimeout(() => {
                console.log('[Main] Starting background WASM warmup for primary worker...');
                workers[0].postMessage({ type: 'warmup' });
            }, 500);
        }
    }
    return Promise.resolve();
}

const pendingPromises = new Map();
let messageIdCounter = 0;

function handleWorkerMessage(e, workerInstance) {
    const { id, success, result, error, type } = e.data;
    // Skip warmup messages in main handler
    if (type === 'warmupComplete') {
        console.log('[Main] A worker warmup complete (WASM loaded).');
        return;
    }

    if (pendingPromises.has(id)) {
        const { resolve, reject } = pendingPromises.get(id);
        pendingPromises.delete(id);
        messageWorkerMap.delete(id);
        if (success) {
            resolve(result);
        } else {
            reject(new Error(error));
        }
    }
}

function handleWorkerError(e, workerInstance) {
    // Extract meaningful error message
    const errorMessage = e.message || (e.error && e.error.message) || 'Unknown worker error';

    // Find all pending messages for this worker and reject them
    let hasPendingWork = false;
    for (const [id, worker] of messageWorkerMap.entries()) {
        if (worker === workerInstance) {
            hasPendingWork = true;
            if (pendingPromises.has(id)) {
                const { reject } = pendingPromises.get(id);
                pendingPromises.delete(id);
                messageWorkerMap.delete(id);
                reject(new Error(`Worker error: ${errorMessage}`));
            }
        }
    }

    // If no pending work, this is likely an initialization error
    // Log it but don't treat as critical - worker pool will handle recovery
    if (!hasPendingWork) {
        console.warn('[Main] Worker initialization warning (non-critical):', errorMessage);
    } else {
        console.error('[Main] Worker error during task:', errorMessage);
    }

    // Try to replace the failed worker to maintain pool health
    try {
        const failedIndex = workers.indexOf(workerInstance);
        if (failedIndex !== -1) {
            workerInstance.terminate();
            const newWorker = new Worker('js/worker-fast.js?v=2.3', { type: 'module' });
            newWorker.addEventListener('message', (e) => handleWorkerMessage(e, newWorker));
            newWorker.addEventListener('error', (e) => handleWorkerError(e, newWorker));
            workers[failedIndex] = newWorker;
            console.log('[Main] Replaced failed worker at index', failedIndex);
        }
    } catch (replaceError) {
        console.warn('[Main] Failed to replace worker:', replaceError);
    }
}

async function processInWorker(type, file, settings) {
    await ensureWorkerReady();

    return new Promise((resolve, reject) => {
        const id = messageIdCounter++;
        pendingPromises.set(id, { resolve, reject });

        // Round-robin distribution
        const worker = workers[nextWorkerIndex];
        nextWorkerIndex = (nextWorkerIndex + 1) % workers.length;

        worker.postMessage({ id, type, file, settings });
        messageWorkerMap.set(id, worker);
    });
}

/**
 * Optimize to target size using Worker
 */
export async function optimizeToTargetSize(file, originalUrl, index, targetSize, maxW, maxH, format) {
    // img argument is unused now as we pass 'file' to worker
    try {
        const result = await processInWorker('optimizeToTargetSize', file, { targetSize, maxW, maxH, format });
        finalizeOptimization(index, file, originalUrl, result);
    } catch (error) {
        console.error('Worker optimization failed:', error);
        throw error;
    }
}

/**
 * Optimize with settings using Worker
 */
export async function optimizeWithSettings(file, originalUrl, index, quality, maxW, maxH, format) {
    try {
        const result = await processInWorker('optimizeWithSettings', file, { quality, maxW, maxH, format });
        finalizeOptimization(index, file, originalUrl, result);
    } catch (error) {
        console.error('Worker optimization failed:', error);
        throw error;
    }
}

/**
 * Shared finalization logic
 */
function finalizeOptimization(index, file, originalUrl, result) {
    // LOGIC ERROR FIX: If the file was removed while we were working, discard result
    if (!uploadedFiles[index] || uploadedFiles[index] !== file) {
        console.log(`Optimization finished for index ${index} but file was removed. Discarding.`);
        return;
    }

    if (optimizedPreviews[index]) {
        safeRevokeUrl(optimizedPreviews[index]);
    }

    const mainBlob = result.blob;
    let previewUrl;

    // Use previewBlob if provided (for JXL etc) or if not displayable
    if (result.previewBlob && !result.isDisplayable) {
        previewUrl = createPointerUrl(result.previewBlob);
    } else {
        previewUrl = createPointerUrl(mainBlob);
    }

    // Additional properties expected by UI
    const finalResult = {
        blob: mainBlob,
        url: previewUrl,
        formatUsed: result.formatUsed,
        isDisplayable: result.isDisplayable
    };

    optimizedImages[index] = mainBlob;
    optimizedPreviews[index] = previewUrl;

    if (window.updateUIWithResult) {
        window.updateUIWithResult(index, file, originalUrl, finalResult);
    }
}

/**
 * Load an image from URL (Still used by Main Thread for Initial UI/Analysis)
 */
export function loadImage(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = (e) => reject(new Error('Failed to load image.'));
        img.src = url;
    });
}
