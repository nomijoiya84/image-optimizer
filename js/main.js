/**
 * Main Application Entry Point
 */

import { initDOM, elements } from './dom.js';
import { FORMAT_DEFINITIONS } from './constants.js';
import { initializeFormatSupport, syncFormatSelectWithSupport, updateFormatRecommendationUI, resolveOutputFormat } from './formats.js';
import { handleFileSelect, handleDrop, removeFile } from './upload.js';
import {
    isOptimizing,
    setIsOptimizing,
    uploadedFiles,
    fileSettings,
    optimizedImages,
    setOptimizedImages,
    setOptimizedPreviews,
    optimizedPreviews,
    imageFeatureCache,
    acquireFileLock,
    releaseFileLock
} from './state.js';
import { optimizeWithSettings, optimizeToTargetSize, loadImage, initWorker } from './optimize.js';
import { updateBatchSummary, toggleBatchGrid, updateUIWithResult, updateCardToFailed, downloadAll, updateOriginalSizeHint } from './ui.js';
import { initComparison, openComparison } from './comparison.js';
import { createPointerUrl, safeRevokeUrl, formatFileSize, runWithConcurrency, getOptimizedFileName } from './utils.js';

// CRITICAL: Start worker initialization immediately (before DOM is ready)
// This begins WASM loading during page render, saving 1-2 seconds
console.log('[Main] Early worker initialization starting...');
initWorker();

// Export globals for inline event handlers and inter-module access
window.formatFileSize = formatFileSize; // Required by success-modal.js
window.removeFile = removeFile;
window.openComparison = openComparison;
window.updateFileFormat = (index, format) => { fileSettings[index].format = format; };
window.retryOptimization = retryOptimization;
window.downloadSingle = downloadSingle;
window.downloadAll = downloadAll;
window.handleDownloadAllClick = downloadAll; // For compatibility with success-modal.js
window.notifyFormatFallback = (pref, used) => {
    if (window.Toast) {
        window.Toast.info(`Using ${used.toUpperCase()} as fallback for ${pref.toUpperCase()}`, 'Format Falling Back');
    }
};
window.updateUIWithResult = updateUIWithResult;
window.updateOriginalSizeHint = updateOriginalSizeHint;

document.addEventListener('DOMContentLoaded', async () => {
    if (!initDOM()) {
        console.error('Failed to initialize DOM elements');
        return;
    }

    await initializeFormatSupport();
    syncFormatSelectWithSupport();
    initComparison();
    // Worker already initialized at top of module

    // Event Listeners
    elements.uploadArea.addEventListener('click', () => elements.fileInput.click());
    elements.uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        elements.uploadArea.classList.add('dragover');
    });
    elements.uploadArea.addEventListener('dragleave', () => elements.uploadArea.classList.remove('dragover'));
    elements.uploadArea.addEventListener('drop', handleDrop);
    elements.fileInput.addEventListener('change', handleFileSelect);

    // Settings listeners
    elements.qualitySlider.addEventListener('input', (e) => {
        elements.qualityValue.textContent = e.target.value + '%';
    });
    elements.maxWidth.addEventListener('input', (e) => {
        elements.widthValue.textContent = e.target.value + 'px';
    });
    elements.maxHeight.addEventListener('input', (e) => {
        elements.heightValue.textContent = e.target.value + 'px';
    });

    elements.targetSizeToggle.addEventListener('change', (e) => {
        elements.targetSizeWrapper.style.display = e.target.checked ? 'block' : 'none';
        if (e.target.checked && window.updateOriginalSizeHint) window.updateOriginalSizeHint();
    });

    elements.targetSizeInput.addEventListener('input', (e) => {
        elements.targetSizeValue.textContent = e.target.value + ' KB';
    });

    elements.optimizeBtn.addEventListener('click', startOptimization);
    elements.batchGridToggle.addEventListener('click', toggleBatchGrid);
    elements.downloadAllBtn.addEventListener('click', () => {
        if (window.downloadAll) window.downloadAll();
    });

    // Theme toggle
    elements.themeToggle.addEventListener('click', () => {
        document.body.classList.toggle('dark-mode');
        const isDark = document.body.classList.contains('dark-mode');
        localStorage.setItem('theme', isDark ? 'dark' : 'light');
        // Update button text to reflect current state
        const btnText = elements.themeToggle.querySelector('.btn-text');
        if (btnText) {
            btnText.textContent = isDark ? 'Disable Dark Mode' : 'Enable Dark Mode';
        }
    });

    // Restore theme and update button text
    if (localStorage.getItem('theme') === 'dark') {
        document.body.classList.add('dark-mode');
        const btnText = elements.themeToggle.querySelector('.btn-text');
        if (btnText) {
            btnText.textContent = 'Disable Dark Mode';
        }
    }
});

/**
 * Start the batch optimization process
 */
async function startOptimization() {
    if (isOptimizing) return;

    const validFiles = uploadedFiles.filter(Boolean);
    if (validFiles.length === 0) {
        if (window.Toast) window.Toast.warning('Please upload some images first.');
        return;
    }

    setIsOptimizing(true);
    elements.optimizeBtn.disabled = true;

    // Preparation
    const useTargetSize = elements.targetSizeToggle.checked;
    let targetKB = parseFloat(elements.targetSizeInput.value) || 100;

    // VALIDATION: Clamp target size between 10KB and 10MB
    if (useTargetSize) {
        if (targetKB < 10) {
            targetKB = 10;
            elements.targetSizeInput.value = 10;
            if (window.Toast) window.Toast.info('Target size set to minimum 10 KB');
        } else if (targetKB > 10000) {
            targetKB = 10000;
            elements.targetSizeInput.value = 10000;
            if (window.Toast) window.Toast.info('Target size capped at 10 MB');
        }
    }

    const targetSizeBytes = targetKB * 1024;
    const quality = elements.qualitySlider.value / 100;
    const valW = parseInt(elements.maxWidth.value, 10);
    let maxW = !isNaN(valW) && valW > 0 ? valW : Infinity;
    const valH = parseInt(elements.maxHeight.value, 10);
    let maxH = !isNaN(valH) && valH > 0 ? valH : Infinity;

    // Memory constraint: Cap to 2K on low-memory devices (<4GB)
    if (navigator.deviceMemory && navigator.deviceMemory < 4) {
        const memCap = 2048;
        if (maxW > memCap) {
            maxW = memCap;
            console.log('[Main] Low memory detected. Auto-constraining width to 2048.');
        }
        if (maxH > memCap) {
            maxH = memCap;
            console.log('[Main] Low memory detected. Auto-constraining height to 2048.');
        }
    }
    const selectedFormat = elements.formatSelect.value;

    if (window.showProgressModal) window.showProgressModal();

    let processedCount = 0;
    const totalToProcess = validFiles.length;
    const tasks = [];

    for (let i = 0; i < uploadedFiles.length; i++) {
        const file = uploadedFiles[i];
        if (!file) continue;

        tasks.push(async () => {
            // Acquire lock for this file index to prevent removal during processing
            if (!acquireFileLock(i)) {
                console.warn(`Skipping file at index ${i}: already being processed.`);
                processedCount++;
                if (window.updateProgress) window.updateProgress(processedCount, totalToProcess);
                return;
            }

            const card = elements.resultsSection.querySelector(`.result-card[data-index="${i}"]`);
            if (card) {
                card.classList.add('is-processing', 'skeleton-card');
            }

            const url = createPointerUrl(file);
            try {
                const features = imageFeatureCache[i];
                // Use per-file format if explicitly set (not 'auto'), otherwise use global selectedFormat
                const perFileFormat = fileSettings[i]?.format;
                const effectiveFormat = (perFileFormat && perFileFormat !== 'auto') ? perFileFormat : selectedFormat;
                const format = resolveOutputFormat(effectiveFormat, features, file.type);

                if (useTargetSize) {
                    await optimizeToTargetSize(file, url, i, targetSizeBytes, maxW, maxH, format);
                } else {
                    await optimizeWithSettings(file, url, i, quality, maxW, maxH, format);
                }

                processedCount++;
                if (window.updateProgress) window.updateProgress(processedCount, totalToProcess);
            } catch (err) {
                console.error(`Optimization failed for ${file.name}`, err);
                updateCardToFailed(i, file, err.message || 'Error');
                // Even if failed, we count it as processed for the progress bar
                processedCount++;
                if (window.updateProgress) window.updateProgress(processedCount, totalToProcess);
            } finally {
                // Cleanup the temporary source URL used for processing in all cases
                safeRevokeUrl(url);
                // Release the file lock
                releaseFileLock(i);
            }
        });
    }

    try {
        // Use hardware concurrency for batch processing, matching the worker pool size
        // The worker pool is dynamically sized, so we need to let it size up first
        const concurrency = Math.min(navigator.hardwareConcurrency || 4, tasks.length, 8);
        await runWithConcurrency(tasks, concurrency);

        if (window.showSuccessModal) {
            // Safely calculate totals - check both file and optimizedImages existence
            const originalTotal = uploadedFiles.reduce((acc, f, i) => acc + ((f && optimizedImages[i]) ? f.size : 0), 0);
            const optimizedTotal = optimizedImages.reduce((acc, blob) => acc + (blob ? blob.size : 0), 0);

            // Count only files that have a corresponding optimized image
            const successCount = uploadedFiles.reduce((acc, f, i) => acc + ((f && optimizedImages[i]) ? 1 : 0), 0);

            window.showSuccessModal({
                originalTotal,
                optimizedTotal,
                count: successCount
            });
        }

        if (window.Toast) window.Toast.success('Batch optimization complete!');
    } finally {
        setIsOptimizing(false);
        elements.optimizeBtn.disabled = false;
        if (window.hideProgressModal) window.hideProgressModal();
    }
}

/**
 * Individual retry logic
 */
async function retryOptimization(index) {
    if (isOptimizing) return;
    const file = uploadedFiles[index];
    if (!file) return;

    // Acquire lock to prevent concurrent retries
    if (!acquireFileLock(index)) {
        if (window.Toast) window.Toast.warning('This file is already being processed.');
        return;
    }

    const card = elements.resultsSection.querySelector(`.result-card[data-index="${index}"]`);
    if (card) {
        card.classList.remove('has-failed');
        card.classList.add('is-processing', 'skeleton-card');
    }

    // Capture settings
    const useTargetSize = elements.targetSizeToggle.checked;
    let targetKB = parseFloat(elements.targetSizeInput.value) || 100;

    // VALIDATION: Clamp target size between 10KB and 10MB
    if (useTargetSize) {
        if (targetKB < 10) targetKB = 10;
        else if (targetKB > 10000) targetKB = 10000;
    }

    const targetSizeBytes = targetKB * 1024;
    const quality = elements.qualitySlider.value / 100;
    const valW = parseInt(elements.maxWidth.value, 10);
    let maxW = !isNaN(valW) && valW > 0 ? valW : Infinity;
    const valH = parseInt(elements.maxHeight.value, 10);
    let maxH = !isNaN(valH) && valH > 0 ? valH : Infinity;

    // Memory constraint: Cap to 2K on low-memory devices (<4GB)
    if (navigator.deviceMemory && navigator.deviceMemory < 4) {
        const memCap = 2048;
        if (maxW > memCap) maxW = memCap;
        if (maxH > memCap) maxH = memCap;
    }
    // Use per-file format if explicitly set (not 'auto'), otherwise use global formatSelect
    const perFileFormat = fileSettings[index]?.format;
    const selectedFormat = (perFileFormat && perFileFormat !== 'auto') ? perFileFormat : elements.formatSelect.value;

    const url = createPointerUrl(file);
    try {
        const features = imageFeatureCache[index];
        const format = resolveOutputFormat(selectedFormat, features, file.type);

        if (useTargetSize) {
            await optimizeToTargetSize(file, url, index, targetSizeBytes, maxW, maxH, format);
        } else {
            await optimizeWithSettings(file, url, index, quality, maxW, maxH, format);
        }
    } catch (err) {
        updateCardToFailed(index, file, err.message || 'Error');
    } finally {
        safeRevokeUrl(url);
        releaseFileLock(index);
    }
}

/**
 * Handle single file download
 */
function downloadSingle(index) {
    const blob = optimizedImages[index];
    const file = uploadedFiles[index];
    if (!blob || !file) return;

    // Determine extension from MIME type
    const mime = blob.type;
    let extension = 'jpg';
    for (const def of Object.values(FORMAT_DEFINITIONS)) {
        if (def.mime === mime) {
            extension = def.extension;
            break;
        }
    }

    // Correct file naming
    const finalExtension = extension === 'jpeg' ? 'jpg' : extension;
    const name = getOptimizedFileName(file.name, finalExtension);

    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Cleanup temporary download URL
    setTimeout(() => URL.revokeObjectURL(blobUrl), 100);
}


