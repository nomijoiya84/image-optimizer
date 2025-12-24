/**
 * Image comparison modal module
 */

import { uploadedFiles, optimizedImages, optimizedPreviews } from './state.js';
import { formatFileSize, calculateSavings, createPointerUrl, safeRevokeUrl } from './utils.js';

let comparisonModal;
let slider;
let handle;
let originalImg;
let optimizedImg;
let originalLabel;
let optimizedLabel;
let closeBtn;
let overlay;
let currentOriginalUrl = null;

// Stat elements
let statOriginal;
let statOptimized;
let statSaved;

export function initComparison() {
    comparisonModal = document.getElementById('comparisonModal');
    if (!comparisonModal) return;

    slider = document.getElementById('comparisonSlider');
    handle = document.getElementById('comparisonHandle');
    originalImg = document.getElementById('compareOriginal');
    optimizedImg = document.getElementById('compareOptimized');
    originalLabel = document.getElementById('compareOriginalLabel');
    optimizedLabel = document.getElementById('compareOptimizedLabel');
    closeBtn = document.getElementById('closeComparison');
    overlay = document.getElementById('closeComparisonOverlay');

    statOriginal = document.getElementById('compStatOriginal');
    statOptimized = document.getElementById('compStatOptimized');
    statSaved = document.getElementById('compStatSaved');

    if (slider) {
        slider.addEventListener('input', (e) => {
            const val = e.target.value;
            // Standard Compare: Original (Left) vs Optimized (Right)
            // Optimized is on Top. We clip the LEFT side of Optimized to reveal Original underneath.
            // inset(top right bottom left)
            optimizedImg.style.clipPath = `inset(0 0 0 ${val}%)`;
            handle.style.left = `${val}%`;
        });
    }

    if (closeBtn) closeBtn.onclick = closeComparisonModal;
    if (overlay) overlay.onclick = closeComparisonModal;

    // ESC key to close
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && comparisonModal.style.display === 'flex') {
            closeComparisonModal();
        }
    });
}

export function openComparison(index) {
    if (!comparisonModal) return;

    const file = uploadedFiles[index];
    const optimizedBlob = optimizedImages[index];
    const optimizedUrl = optimizedPreviews[index];

    if (!file || !optimizedBlob) return;

    // Cleanup previous URL if exists
    if (currentOriginalUrl) {
        safeRevokeUrl(currentOriginalUrl);
        currentOriginalUrl = null;
    }

    const originalSizeStr = formatFileSize(file.size);
    const optimizedSizeStr = formatFileSize(optimizedBlob.size);

    originalLabel.textContent = `Original (${originalSizeStr})`;
    optimizedLabel.textContent = `Optimized (${optimizedSizeStr})`;

    if (statOriginal) statOriginal.textContent = originalSizeStr;
    if (statOptimized) statOptimized.textContent = optimizedSizeStr;
    if (statSaved) statSaved.textContent = calculateSavings(file.size, optimizedBlob.size);

    // Reset slider to middle
    if (slider) {
        slider.value = 50;
    }
    // Clip Left 50% of Optimized, so Original shows on Left
    if (optimizedImg) {
        optimizedImg.style.clipPath = 'inset(0 0 0 50%)';
    }
    if (handle) {
        handle.style.left = '50%';
    }

    // Wait for images to load before showing to prevent layout shift/empty modal
    let loadedCount = 0;
    let modalShown = false;
    const checkLoaded = () => {
        loadedCount++;
        if (loadedCount === 2 && !modalShown) {
            modalShown = true;
            comparisonModal.style.display = 'flex';
            comparisonModal.classList.remove('is-loading');
            document.body.style.overflow = 'hidden'; // Prevent background scroll
        }
    };

    comparisonModal.classList.add('is-loading');
    originalImg.onload = checkLoaded;
    optimizedImg.onload = checkLoaded;

    // Fallback if images are already cached or fail
    originalImg.onerror = checkLoaded;
    optimizedImg.onerror = checkLoaded;

    // Timeout fallback: show modal after 3 seconds even if images haven't loaded
    setTimeout(() => {
        if (!modalShown) {
            modalShown = true;
            comparisonModal.style.display = 'flex';
            comparisonModal.classList.remove('is-loading');
            document.body.style.overflow = 'hidden';
        }
    }, 3000);

    // Set SRCS
    currentOriginalUrl = createPointerUrl(file);
    originalImg.src = currentOriginalUrl;
    optimizedImg.src = optimizedUrl;
}

export function closeComparisonModal() {
    if (comparisonModal) {
        comparisonModal.style.display = 'none';
        document.body.style.overflow = '';
        if (currentOriginalUrl) {
            safeRevokeUrl(currentOriginalUrl);
            currentOriginalUrl = null;
        }
    }
}
