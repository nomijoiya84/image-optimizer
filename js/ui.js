/**
 * UI Component builders and management
 */

import { elements } from './dom.js';
import { FORMAT_DEFINITIONS } from './constants.js';
import {
    formatFileSize,
    calculateSavings,
    getCompressionLabel,
    getCompressionBadgeClass,
    safeRevokeUrl,
    escapeHTML
} from './utils.js';
import {
    uploadedFiles,
    optimizedImages,
    optimizedPreviews,
    fileSettings,
    batchGridVisible,
    setBatchGridVisible
} from './state.js';
import { getFormatLabel } from './formats.js';

/**
 * Creates an image card for the results section
 */
export function createImageCard(file, objectUrl, index, isOptimized = false, resultData = null) {
    const card = document.createElement('div');
    card.className = 'result-card';
    card.setAttribute('data-index', index);

    // Header
    const title = document.createElement('h3');
    title.textContent = file.name;
    card.appendChild(title);

    // Remove button
    const removeBtn = document.createElement('button');
    removeBtn.className = 'card-remove-btn';
    removeBtn.innerHTML = '×';
    removeBtn.title = 'Remove';
    removeBtn.onclick = (e) => {
        e.stopPropagation();
        if (window.removeFile) window.removeFile(index);
    };
    card.appendChild(removeBtn);

    // Preview
    const imgWrapper = document.createElement('div');
    imgWrapper.className = 'image-container';

    const img = document.createElement('img');
    img.className = 'image-preview';
    img.src = isOptimized ? resultData.url : objectUrl;
    img.alt = file.name;

    imgWrapper.appendChild(img);
    card.appendChild(imgWrapper);

    // Calculate sizes outside the blocks so they're accessible to both
    const originalSize = file.size;
    const optimizedSize = (isOptimized && resultData) ? resultData.blob.size : 0;

    if (isOptimized && resultData) {
        // Optimized stats (already existing logic)
        const stats = document.createElement('div');
        stats.className = 'stats';

        stats.innerHTML = `
            <div class="stat-item">
                <span class="stat-label">Original</span>
                <span class="stat-value">${formatFileSize(originalSize)}</span>
            </div>
            <div class="stat-item">
                <span class="stat-label">Optimized</span>
                <span class="stat-value highlight">${formatFileSize(optimizedSize)}</span>
            </div>
            <div class="stat-item">
                <span class="stat-label">Saved</span>
                <span class="stat-value">${calculateSavings(originalSize, optimizedSize)}</span>
            </div>
        `;
        card.appendChild(stats);
    } else {
        // Initial state stats - Show original size here!
        const initialStats = document.createElement('div');
        initialStats.className = 'initial-stats';
        initialStats.innerHTML = `
            <div class="initial-stat-item">
                <span class="stat-label">Original Size</span>
                <span class="stat-value">${formatFileSize(file.size)}</span>
            </div>
            <div class="initial-status-badge">Ready to optimize</div>
        `;
        card.appendChild(initialStats);
    }

    if (isOptimized && resultData) {

        // Compression badge
        const badge = document.createElement('div');
        badge.className = `compression-badge ${getCompressionBadgeClass(originalSize, optimizedSize)}`;
        badge.textContent = getCompressionLabel(originalSize, optimizedSize);
        card.appendChild(badge);

        // Toolbar: Comparison & Format Selection
        const toolbar = document.createElement('div');
        toolbar.className = 'comparison-toolbar';

        const compareBtn = document.createElement('button');
        compareBtn.className = 'btn-pill btn-compare';
        compareBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M16 3h5v5M8 21H3v-5M21 3l-7 7M3 21l7-7"></path>
            </svg> Comparison
        `;
        compareBtn.onclick = () => {
            if (window.openComparison) window.openComparison(index);
        };
        toolbar.appendChild(compareBtn);

        // Individual format dropdown
        const formatSelect = document.createElement('select');
        formatSelect.className = 'card-format-select';
        ['jpeg', 'png', 'webp', 'avif', 'jxl'].forEach(fmt => {
            const opt = document.createElement('option');
            opt.value = fmt;
            opt.textContent = getFormatLabel(fmt);
            if (fmt === resultData.formatUsed) opt.selected = true;
            formatSelect.appendChild(opt);
        });
        formatSelect.onchange = (e) => {
            if (window.updateFileFormat) window.updateFileFormat(index, e.target.value);
            if (window.retryOptimization) window.retryOptimization(index);
        };
        toolbar.appendChild(formatSelect);

        card.appendChild(toolbar);

        // Download button
        const downloadBtn = document.createElement('button');
        downloadBtn.className = 'download-btn';
        downloadBtn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg> Download Optimized
        `;
        downloadBtn.onclick = () => {
            if (window.downloadSingle) window.downloadSingle(index);
        };
        card.appendChild(downloadBtn);
    }

    return card;
}

/**
 * Replace card at specific index
 */
export function replaceCardAtIndex(index, newCard) {
    if (!elements.resultsSection) return;
    const oldCard = elements.resultsSection.querySelector(`.result-card[data-index="${index}"]`);
    if (oldCard) {
        // Memory cleanup - revoke old image URLs
        const newImages = Array.from(newCard.querySelectorAll('img')).map(img => img.src);
        const oldImages = oldCard.querySelectorAll('img');
        oldImages.forEach(img => {
            const src = img.src;
            if (src && src.startsWith('blob:') && !newImages.includes(src)) {
                safeRevokeUrl(src);
            }
        });

        // Also cleanup the initial preview URL tracked in fileSettings
        if (fileSettings[index]?.initialPreviewUrl) {
            const initialUrl = fileSettings[index].initialPreviewUrl;
            if (!newImages.includes(initialUrl)) {
                safeRevokeUrl(initialUrl);
            }
            fileSettings[index].initialPreviewUrl = null;
        }

        elements.resultsSection.replaceChild(newCard, oldCard);
    } else {
        elements.resultsSection.appendChild(newCard);
    }
}

/**
 * Update UI when a file is successfully optimized
 */
export function updateUIWithResult(index, file, originalUrl, result) {
    const newCard = createImageCard(file, originalUrl, index, true, result);
    replaceCardAtIndex(index, newCard);
    updateBatchSummary();
}

/**
 * Update card to failed state
 */
export function updateCardToFailed(index, file, errorMessage = null) {
    const card = elements.resultsSection.querySelector(`.result-card[data-index="${index}"]`);
    if (!card) return;

    card.classList.remove('is-processing', 'skeleton-card');
    card.classList.add('has-failed');

    // Add failed badge if not already there
    if (!card.querySelector('.failed-badge')) {
        const badge = document.createElement('div');
        badge.className = 'failed-badge';
        badge.textContent = errorMessage || 'Optimization Failed';
        if (errorMessage) badge.title = errorMessage; // Tooltip
        card.appendChild(badge);

        const retryBtn = document.createElement('button');
        retryBtn.className = 'btn btn-outline btn-sm';
        retryBtn.style.marginTop = '1rem';
        retryBtn.textContent = 'Retry';
        retryBtn.onclick = () => {
            if (window.retryOptimization) window.retryOptimization(index);
        };
        card.appendChild(retryBtn);
    } else if (errorMessage) {
        // Update existing badge
        card.querySelector('.failed-badge').textContent = errorMessage;
    }
}

/**
 * Update batch statistics summary
 */
export function updateBatchSummary() {
    const totalProcessed = optimizedImages.filter(Boolean).length;
    if (totalProcessed === 0) {
        elements.batchTools.style.display = 'none';
        return;
    }

    elements.batchTools.style.display = 'flex';
    elements.batchCount.textContent = `${totalProcessed} optimized image${totalProcessed !== 1 ? 's' : ''}`;
    elements.downloadAllBtn.disabled = false;

    // Safely calculate - check both file and optimizedImages existence
    const originalTotal = uploadedFiles.reduce((acc, f, i) => acc + ((f && optimizedImages[i]) ? f.size : 0), 0);
    const optimizedTotal = optimizedImages.reduce((acc, blob) => acc + (blob ? blob.size : 0), 0);

    elements.batchSavings.textContent = calculateSavings(originalTotal, optimizedTotal);
}

/**
 * Toggle the batch grid overview
 */
export function toggleBatchGrid() {
    const visible = !batchGridVisible;
    setBatchGridVisible(visible);

    elements.batchGridWrapper.style.display = visible ? 'block' : 'none';
    elements.batchGridToggle.textContent = visible ? 'Hide Overview' : 'Show Overview';

    if (visible) {
        renderBatchGrid();
    }
}

/**
 * Render small thumbnails in batch grid
 */
export function renderBatchGrid() {
    elements.batchGrid.innerHTML = '';
    uploadedFiles.forEach((file, index) => {
        // Skip files that were removed or don't have optimized previews yet
        if (!file || !optimizedPreviews[index]) return;
        const thumb = document.createElement('div');
        thumb.className = 'batch-thumb';
        const img = document.createElement('img');
        img.src = optimizedPreviews[index];
        img.alt = file.name;
        thumb.appendChild(img);
        elements.batchGrid.appendChild(thumb);
    });
}

/**
 * Handle batch download as ZIP
 */
export async function downloadAll() {
    if (!optimizedImages.some(Boolean)) return;

    setDownloadAllButtonLoading(true);

    try {
        if (typeof JSZip === 'undefined') {
            throw new Error('JSZip library is not available.');
        }

        const zip = new JSZip();
        const usedNames = new Map(); // Track name usage to prevent collisions
        let fileCount = 0;

        uploadedFiles.forEach((file, i) => {
            // Skip if either file or optimized blob is missing
            if (!file || !optimizedImages[i]) return;

            const optimizedBlob = optimizedImages[i];

            // Determine extension from actual blob type
            const mime = optimizedBlob.type;
            let extension = 'jpg';
            // Find extension from definitions
            for (const def of Object.values(FORMAT_DEFINITIONS)) {
                if (def.mime === mime) {
                    extension = def.extension;
                    break;
                }
            }
            // Ensure consistency
            if (extension === 'jpeg') extension = 'jpg';

            const baseName = file.name.replace(/\.[^/.]+$/, "");
            let zipFileName = `${baseName}_optimized.${extension}`;

            // CONFLICT RESOLUTION: Add number if name already exists
            if (usedNames.has(zipFileName)) {
                const count = usedNames.get(zipFileName) + 1;
                usedNames.set(zipFileName, count);
                zipFileName = `${baseName}_optimized_${count}.${extension}`;
            } else {
                usedNames.set(zipFileName, 0);
            }

            zip.file(zipFileName, optimizedBlob);
            fileCount++;
        });

        if (fileCount === 0) {
            throw new Error('No optimized images to download.');
        }

        const content = await zip.generateAsync({ type: 'blob' });
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const zipName = `image-optimizer-${timestamp}.zip`;

        const url = URL.createObjectURL(content);
        const link = document.createElement('a');
        link.href = url;
        link.download = zipName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 100);

        if (window.Toast) window.Toast.success('ZIP file prepared and download started!');
    } catch (error) {
        console.error('ZIP creation failed:', error);
        if (window.Toast) window.Toast.error('Failed to create ZIP file. Please try downloading images individually.');
    } finally {
        setDownloadAllButtonLoading(false);
    }
}

function setDownloadAllButtonLoading(isLoading) {
    const btn = elements.downloadAllBtn;
    const successBtn = document.getElementById('successDownloadBtn');

    [btn, successBtn].forEach(el => {
        if (!el) return;
        el.disabled = isLoading;
        const textSpan = el.querySelector('.btn-text') || el;
        if (isLoading) {
            el.classList.add('is-loading');
            if (textSpan.tagName === 'SPAN') textSpan.textContent = 'Preparing ZIP...';
            else el.setAttribute('data-original-text', el.textContent), el.textContent = 'Preparing ZIP...';
        } else {
            el.classList.remove('is-loading');
            if (textSpan.tagName === 'SPAN') textSpan.textContent = 'Download All (ZIP)';
            else if (el.hasAttribute('data-original-text')) el.textContent = el.getAttribute('data-original-text');
        }
    });
}

/**
 * Update the original size hint in the controls panel
 */
export function updateOriginalSizeHint() {
    if (!elements.originalSizeDisplay) return;

    const validFiles = uploadedFiles.filter(Boolean);
    if (validFiles.length === 0) {
        elements.originalSizeDisplay.textContent = '';
        return;
    }

    const totalSize = validFiles.reduce((acc, f) => acc + f.size, 0);
    elements.originalSizeDisplay.textContent = `(Original: ${formatFileSize(totalSize)})`;
}



