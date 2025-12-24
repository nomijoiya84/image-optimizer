/**
 * File upload and selection handling
 */

import { elements } from './dom.js';
import {
    uploadedFiles,
    setUploadedFiles,
    fileSettings,
    setFileSettings,
    imageFeatureCache,
    setImageFeatureCache,
    setIsOptimizing,
    optimizedPreviews,
    optimizedImages,
    isFileLocked
} from './state.js';
import { updateFormatRecommendationUI, detectImageFeatures } from './formats.js';
import { createImageCard, updateBatchSummary } from './ui.js';
import { createPointerUrl, safeRevokeUrl } from './utils.js';
import { loadImage } from './optimize.js';

/**
 * Handle file selection from input
 */
export async function handleFileSelect(e) {
    const files = Array.from(e.target.files);
    if (files.length > 0) {
        await processNewFiles(files);
    }
}

/**
 * Handle dropped files
 */
export async function handleDrop(e) {
    e.preventDefault();
    elements.uploadArea.classList.remove('dragover');
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    if (files.length > 0) {
        await processNewFiles(files);
    }
}

/**
 * Common logic to process newly added files
 */
async function processNewFiles(files) {
    const startIndex = uploadedFiles.length;
    const newUploaded = [...uploadedFiles, ...files];
    setUploadedFiles(newUploaded);

    // Show controls if first files
    if (startIndex === 0) {
        elements.controlsSection.style.display = 'block';
    }

    // Scroll to controls
    elements.controlsSection.scrollIntoView({ behavior: 'smooth' });

    // Initialize UI and feature detection
    files.forEach((file, i) => {
        const index = startIndex + i;
        const cardUrl = createPointerUrl(file);

        // Add placeholder card
        const card = createImageCard(file, cardUrl, index, false);
        elements.resultsSection.appendChild(card);

        // Initialize settings and track initial preview URL for cleanup
        fileSettings[index] = { format: 'auto', initialPreviewUrl: cardUrl };

        // Background feature detection with separate URL (will be revoked after use)
        const featureUrl = createPointerUrl(file);
        processFeatures(file, featureUrl, index);
    });

    updateBatchSummary();
    if (window.updateOriginalSizeHint) window.updateOriginalSizeHint();
}

/**
 * Background task to detect image features
 */
async function processFeatures(file, url, index) {
    try {
        const img = await loadImage(url);
        const features = await detectImageFeatures(img, file);
        imageFeatureCache[index] = features;
        updateFormatRecommendationUI();
    } catch (err) {
        console.warn(`Feature detection failed for ${file.name}`, err);
    } finally {
        // Always revoke the temporary URL used for feature detection
        safeRevokeUrl(url);
    }
}

/**
 * Remove a file from the list
 * Respects file operation locks to prevent race conditions during optimization
 */
export function removeFile(index) {
    // Check if file is currently being processed
    if (isFileLocked(index)) {
        if (window.Toast) {
            window.Toast.warning('Cannot remove file while it is being optimized.');
        }
        console.warn(`Cannot remove file at index ${index}: currently being processed.`);
        return false;
    }

    const card = elements.resultsSection.querySelector(`.result-card[data-index="${index}"]`);
    if (card) {
        // Revoke any blob URLs in the card images
        const imgs = card.querySelectorAll('img');
        imgs.forEach(img => {
            if (img.src) safeRevokeUrl(img.src);
        });
        card.remove();
    }

    // Clear state
    uploadedFiles[index] = null;
    imageFeatureCache[index] = null;
    fileSettings[index] = null;

    // Cleanup optimized result
    if (optimizedPreviews[index]) {
        safeRevokeUrl(optimizedPreviews[index]);
        optimizedPreviews[index] = null;
    }
    optimizedImages[index] = null;

    updateBatchSummary();
    if (window.updateOriginalSizeHint) window.updateOriginalSizeHint();
    return true;
}
