// Global variables
let uploadedFiles = [];
let optimizedImages = [];
let optimizedPreviews = [];
let isOptimizing = false;
let batchGridVisible = false;
const revocableUrls = new Set();

// DOM elements
let uploadArea, fileInput, controlsSection, resultsSection;
let qualitySlider, qualityValue, maxWidth, widthValue;
let maxHeight, heightValue, formatSelect, optimizeBtn;
let targetSizeToggle, targetSizeInput, targetSizeValue, targetSizeWrapper;
let batchTools, batchCountEl, batchSavingsEl, batchGridToggle;
let batchGridWrapper, batchGrid, downloadAllBtn;
let themeToggle;
let formatRecommendationText;
let formatWarningText;

const FORMAT_DEFINITIONS = {
    auto: { label: 'Auto (Smart)', mime: '', extension: '' },
    jpeg: { label: 'JPEG', mime: 'image/jpeg', extension: 'jpg', supportsAlpha: false },
    png: { label: 'PNG', mime: 'image/png', extension: 'png', supportsAlpha: true, lossless: true },
    webp: { label: 'WebP', mime: 'image/webp', extension: 'webp', supportsAlpha: true, supportsAnimation: true },
    avif: { label: 'AVIF', mime: 'image/avif', extension: 'avif', supportsAlpha: true, supportsAnimation: true },
    jxl: { label: 'JPEG XL', mime: 'image/jxl', extension: 'jxl', supportsAlpha: true }
};

const FORMAT_PRIORITY_ORDER = ['avif', 'jxl', 'webp', 'jpeg', 'png'];
const WASM_CODEC_SOURCES = {
    avif: 'https://cdn.jsdelivr.net/npm/@jsquash/avif/encode.js',
    jxl: 'https://cdn.jsdelivr.net/npm/@jsquash/jxl/encode.js'
};
const wasmCodecCache = {};

let formatSupportMap = {};
let imageFeatureCache = [];
let motionDetectionCache = new Map();
let formatWarningTimeoutId = null;
let lastFormatWarningMessage = '';

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', function () {
    // DOM elements
    uploadArea = document.getElementById('uploadArea');
    fileInput = document.getElementById('fileInput');
    controlsSection = document.getElementById('controlsSection');
    resultsSection = document.getElementById('resultsSection');
    qualitySlider = document.getElementById('qualitySlider');
    qualityValue = document.getElementById('qualityValue');
    maxWidth = document.getElementById('maxWidth');
    widthValue = document.getElementById('widthValue');
    maxHeight = document.getElementById('maxHeight');
    heightValue = document.getElementById('heightValue');
    formatSelect = document.getElementById('formatSelect');
    optimizeBtn = document.getElementById('optimizeBtn');
    targetSizeToggle = document.getElementById('targetSizeToggle');
    targetSizeInput = document.getElementById('targetSizeInput');
    targetSizeValue = document.getElementById('targetSizeValue');
    targetSizeWrapper = document.getElementById('targetSizeWrapper');
    batchTools = document.getElementById('batchTools');
    batchCountEl = document.getElementById('batchCount');
    batchSavingsEl = document.getElementById('batchSavings');
    batchGridToggle = document.getElementById('batchGridToggle');
    batchGridWrapper = document.getElementById('batchGridWrapper');
    batchGrid = document.getElementById('batchGrid');
    downloadAllBtn = document.getElementById('downloadAllBtn');
    themeToggle = document.getElementById('themeToggle');
    formatRecommendationText = document.getElementById('formatRecommendation');
    formatWarningText = document.getElementById('formatWarning');

    // Check if all elements exist
    if (!uploadArea || !fileInput || !controlsSection || !resultsSection ||
        !qualitySlider || !qualityValue || !maxWidth || !widthValue ||
        !maxHeight || !heightValue || !formatSelect || !optimizeBtn ||
        !targetSizeToggle || !targetSizeInput || !targetSizeValue || !targetSizeWrapper ||
        !batchTools || !batchCountEl || !batchSavingsEl || !batchGridToggle ||
        !batchGridWrapper || !batchGrid || !downloadAllBtn || !themeToggle) {
        Toast.error('Critical UI elements are missing. The app may not function correctly.', 'Initialization Error');
        return;
    }

    initializeFormatSupport();
    syncFormatSelectWithSupport();
    updateFormatRecommendationUI();
    if (formatWarningText) {
        formatWarningText.textContent = '';
        formatWarningText.setAttribute('hidden', 'hidden');
    }

    // Event listeners
    uploadArea.addEventListener('click', () => fileInput.click());
    uploadArea.addEventListener('dragover', handleDragOver);
    uploadArea.addEventListener('dragleave', handleDragLeave);
    uploadArea.addEventListener('drop', handleDrop);
    fileInput.addEventListener('change', handleFileSelect);
    qualitySlider.addEventListener('input', (e) => qualityValue.textContent = e.target.value + '%');
    maxWidth.addEventListener('input', (e) => widthValue.textContent = e.target.value + 'px');
    maxHeight.addEventListener('input', (e) => heightValue.textContent = e.target.value + 'px');
    targetSizeToggle.addEventListener('change', (e) => {
        targetSizeWrapper.style.display = e.target.checked ? 'block' : 'none';
    });
    targetSizeInput.addEventListener('input', (e) => {
        let value = parseFloat(e.target.value);
        if (isNaN(value) || value < 1) value = 1;
        targetSizeValue.textContent = value + ' KB';
    });
    optimizeBtn.addEventListener('click', optimizeImages);
    batchGridToggle.addEventListener('click', handleBatchGridToggle);
    downloadAllBtn.addEventListener('click', handleDownloadAllClick);
    themeToggle.addEventListener('click', handleThemeToggle);
    if (resultsSection) {
        resultsSection.addEventListener('click', handleResultsSectionClick);
    }
    formatSelect.addEventListener('change', () => hideFormatWarning());

    const savedTheme = localStorage.getItem('theme') || 'light';
    applyTheme(savedTheme);
    console.log('Image Optimizer initialized successfully!');

    // Register Service Worker
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js')
                .then(reg => console.log('Service Worker registered', reg))
                .catch(err => console.error('Service Worker registration failed', err));
        });
    }
});

function safeRevokeUrl(url) {
    if (url && url.startsWith('blob:') && revocableUrls.has(url)) {
        URL.revokeObjectURL(url);
        revocableUrls.delete(url);
    }
}

function createPointerUrl(blob) {
    const url = URL.createObjectURL(blob);
    revocableUrls.add(url);
    return url;
}

// Drag and drop handlers
function handleDragOver(e) {
    e.preventDefault();
    uploadArea.classList.add('dragover');
}

function handleDragLeave(e) {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
}

function handleDrop(e) {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    if (isOptimizing) {
        Toast.warning('Please wait for current optimization to complete.', 'Optimization in Progress');
        return;
    }
    const files = Array.from(e.dataTransfer.files).filter(file => file.type.startsWith('image/'));
    if (files.length > 0) {
        processFiles(files, false);
    }
}

function handleFileSelect(e) {
    if (isOptimizing) {
        Toast.warning('Please wait for current optimization to complete.', 'Optimization in Progress');
        e.target.value = '';
        return;
    }
    const files = Array.from(e.target.files).filter(file => file.type.startsWith('image/'));
    if (files.length > 0) {
        processFiles(files, false);
    }
    e.target.value = '';
}

function processFiles(files, replaceExisting = false) {
    if (replaceExisting) {
        revocableUrls.forEach(url => safeRevokeUrl(url));
        uploadedFiles = [...files];
        imageFeatureCache = new Array(uploadedFiles.length);
        motionDetectionCache = new Map();
    } else {
        uploadedFiles = [...uploadedFiles, ...files];
        imageFeatureCache = [...imageFeatureCache, ...new Array(files.length)];
    }
    resetBatchUI();
    controlsSection.style.display = 'block';
    updateFormatRecommendationUI(true);
    displayUploadedFiles();
}

function displayUploadedFiles() {
    if (!resultsSection) return;
    resultsSection.innerHTML = '';

    uploadedFiles.forEach((file, index) => {
        // Reuse existing preview URL if found in DOM or just create one
        // Better: just always create one but clear results section properly
        const objectUrl = createPointerUrl(file);
        const card = createImageCard(file, objectUrl, index, false);
        resultsSection.appendChild(card);
        collectFormatInsight(file, objectUrl);
    });
}

function getCurrentFileIndex(file) {
    if (!file) return -1;
    return uploadedFiles.indexOf(file);
}

function handleResultsSectionClick(event) {
    const removeBtn = event.target.closest('.card-remove-btn');
    if (!removeBtn) return;
    event.preventDefault();
    event.stopPropagation();
    const index = parseInt(removeBtn.getAttribute('data-index') || '-1', 10);
    if (!Number.isNaN(index)) {
        removeImage(index);
    }
}

function removeImage(index) {
    if (isOptimizing) {
        Toast.warning('Please wait for the current optimization to finish before removing images.', 'Action Blocked');
        return;
    }
    if (index < 0 || index >= uploadedFiles.length) return;

    uploadedFiles.splice(index, 1);
    optimizedImages.splice(index, 1);
    optimizedPreviews.splice(index, 1);
    imageFeatureCache.splice(index, 1);
    pruneMotionDetectionCache();

    const card = resultsSection ? resultsSection.querySelector(`.result-card[data-index="${index}"]`) : null;
    if (card) {
        // Clean up URLs from the card
        const images = card.querySelectorAll('img');
        images.forEach(img => safeRevokeUrl(img.src));
        card.remove();
    }

    if (!uploadedFiles.length) {
        controlsSection.style.display = 'none';
        if (resultsSection) {
            resultsSection.innerHTML = '';
        }
        resetBatchUI();
        updateFormatRecommendationUI(true);
        return;
    }

    refreshCardIndices();
    updateBatchUI();
    updateFormatRecommendationUI();
}

function refreshCardIndices() {
    if (!resultsSection) return;
    const cards = resultsSection.querySelectorAll('.result-card');
    cards.forEach((card, idx) => {
        card.dataset.index = idx;
        const removeBtn = card.querySelector('.card-remove-btn');
        if (removeBtn) {
            removeBtn.setAttribute('data-index', idx);
        }
    });
}

function pruneMotionDetectionCache() {
    if (!motionDetectionCache.size) return;
    const validKeys = new Set(uploadedFiles.map((file) => getMotionCacheKey(file)).filter(Boolean));
    Array.from(motionDetectionCache.keys()).forEach((key) => {
        if (!validKeys.has(key)) {
            motionDetectionCache.delete(key);
        }
    });
}

function getMotionCacheKey(file) {
    if (!file) return '';
    return `${file.name}-${file.size}-${file.lastModified || 0}`;
}

function collectFormatInsight(file, dataUrl) {
    if (!file || !dataUrl) return;
    const analyzerImg = new Image();
    analyzerImg.onload = async () => {
        try {
            const currentIndex = getCurrentFileIndex(file);
            if (currentIndex === -1) return;
            const features = await deriveImageFeatures(file, analyzerImg);
            imageFeatureCache[currentIndex] = features;
            updateFormatRecommendationUI();
        } catch (error) {
            console.warn('Format analysis failed for', file.name, error);
        }
    };
    analyzerImg.onerror = () => {
        console.warn('Unable to analyze image for format recommendation:', file.name);
    };
    analyzerImg.src = dataUrl;
}

function createImageCard(file, imageSrc, index, isOptimized, originalSrc = null) {
    const card = document.createElement('div');
    card.className = 'result-card';
    card.dataset.index = index;

    const rawFileName = file.name.length > 35 ? file.name.substring(0, 35) + '...' : file.name;
    const fileName = escapeHTML(rawFileName);
    const fileSize = formatFileSize(file.size);
    const removeButtonMarkup = buildRemoveButton(index);

    if (isOptimized && originalSrc) {
        const optimizedFile = optimizedImages[index];
        const optimizedSize = optimizedFile?.size || 0;
        const downloadName = optimizedFile?.name || getOptimizedFileName(file.name);
        const compressionClass = getCompressionBadgeClass(file.size, optimizedSize);
        const compressionLabel = getCompressionLabel(file.size, optimizedSize);
        card.innerHTML = `
            ${removeButtonMarkup}
            <h3>${fileName}</h3>
            ${buildComparisonMarkup(file, originalSrc, imageSrc, index)}
            <div class="stats">
                <div class="stat-item">
                    <div class="stat-label">Original</div>
                    <div class="stat-value">${fileSize}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">Optimized</div>
                    <div class="stat-value">${formatFileSize(optimizedSize)}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">Saved</div>
                    <div class="stat-value">${calculateSavings(file.size, optimizedSize)}</div>
                </div>
            </div>
            <div class="compression-badge ${compressionClass}">
                ${compressionLabel}
            </div>
            <a href="${imageSrc}" download="${downloadName}" class="download-btn">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="17 8 12 3 7 8"></polyline>
                    <line x1="12" y1="3" x2="12" y2="15"></line>
                </svg>
                Download Optimized
            </a>
        `;

        requestAnimationFrame(() => {
            const module = card.querySelector('.comparison-module');
            initializeComparisonModule(module);
        });
    } else {
        card.innerHTML = `
            ${removeButtonMarkup}
            <h3>${fileName}</h3>
            <img src="${imageSrc}" alt="${escapeHTML(file.name)}" class="image-preview">
            <div class="stats">
                <div class="stat-item">
                    <div class="stat-label">Size</div>
                    <div class="stat-value">${fileSize}</div>
                </div>
            </div>
        `;
    }

    return card;
}

function buildRemoveButton(index) {
    return `
        <button class="card-remove-btn" type="button" data-index="${index}" aria-label="Remove image">
            <svg viewBox="0 0 24 24" role="presentation" aria-hidden="true" focusable="false">
                <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round"></line>
                <line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round"></line>
            </svg>
        </button>
    `;
}

function initializeComparisonModule(module) {
    if (!module) return;

    const stage = module.querySelector('.comparison-stage');
    const afterLayer = module.querySelector('.comparison-after-layer');
    const handle = module.querySelector('.comparison-handle');
    const lens = module.querySelector('.comparison-zoom-lens');
    const zoomToggleBtn = module.querySelector('.zoom-toggle-btn');
    const zoomSourceBtns = module.querySelectorAll('.zoom-source-btn');
    const beforeImg = module.querySelector('.comparison-image--before');
    const afterImg = module.querySelector('.comparison-image--after');

    if (!stage || !afterLayer || !handle) return;

    let sliderValue = 50;
    let isDragging = false;
    let activePointerId = null;
    let zoomEnabled = false;
    let zoomSource = 'optimized';
    let lastPointerCoords = null;
    const zoomFactor = 2.5;

    const setSliderValue = (value) => {
        sliderValue = Math.min(100, Math.max(0, value));
        // Use clip-path instead of width for responsive sizing
        // inset(top right bottom left)
        const insetRight = 100 - sliderValue;
        afterLayer.style.clipPath = `inset(0 ${insetRight}% 0 0)`;
        afterLayer.style.webkitClipPath = `inset(0 ${insetRight}% 0 0)`; // Safari fallback

        handle.style.left = `${sliderValue}%`;
        handle.setAttribute('aria-valuenow', Math.round(sliderValue));
    };

    const updateSliderFromClientX = (clientX) => {
        const rect = stage.getBoundingClientRect();
        const percentage = ((clientX - rect.left) / rect.width) * 100;
        setSliderValue(percentage);
    };

    const stopDragging = () => {
        isDragging = false;
        activePointerId = null;
        stage.classList.remove('is-dragging');
    };

    const updateLensPosition = (coords) => {
        if (!zoomEnabled || !lens) return;

        const rect = stage.getBoundingClientRect();
        const x = coords.clientX - rect.left;
        const y = coords.clientY - rect.top;

        if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
            lens.classList.remove('is-visible');
            return;
        }

        lens.classList.add('is-visible');
        lens.style.left = `${x}px`;
        lens.style.top = `${y}px`;

        const activeImage = zoomSource === 'optimized' ? afterImg : beforeImg;
        if (!activeImage || !activeImage.complete || !activeImage.naturalWidth) return;

        // Calculate background size relative to the rendered image size (rect)
        // rather than natural dimensions directly, to ensure zoom feels consistent
        const bgSizeX = rect.width * zoomFactor;
        const bgSizeY = rect.height * zoomFactor;

        lens.style.backgroundImage = `url(${activeImage.src})`;
        lens.style.backgroundSize = `${bgSizeX}px ${bgSizeY}px`;

        const percentX = (x / rect.width) * 100;
        const percentY = (y / rect.height) * 100;
        lens.style.backgroundPosition = `${percentX}% ${percentY}%`;
        lens.dataset.source = zoomSource;
    };

    stage.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || event.pointerType === 'touch' && event.isPrimary === false) return;
        isDragging = true;
        activePointerId = event.pointerId;
        stage.classList.add('is-dragging');
        stage.setPointerCapture(event.pointerId);
        updateSliderFromClientX(event.clientX);
    });

    stage.addEventListener('pointermove', (event) => {
        if (isDragging && event.pointerId === activePointerId) {
            event.preventDefault();
            updateSliderFromClientX(event.clientX);
        }
        if (zoomEnabled) {
            lastPointerCoords = { clientX: event.clientX, clientY: event.clientY };
            updateLensPosition(lastPointerCoords);
        }
    });

    const releasePointer = (event) => {
        if (event.pointerId !== activePointerId) return;
        stopDragging();
        try {
            stage.releasePointerCapture(event.pointerId);
        } catch (err) {
            // Ignore release errors
        }
    };

    stage.addEventListener('pointerup', releasePointer);
    stage.addEventListener('pointercancel', releasePointer);

    stage.addEventListener('pointerleave', () => {
        if (!isDragging) {
            lens?.classList.remove('is-visible');
        }
    });

    handle.addEventListener('keydown', (event) => {
        const step = event.shiftKey ? 10 : 2;
        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            setSliderValue(sliderValue - step);
        } else if (event.key === 'ArrowRight') {
            event.preventDefault();
            setSliderValue(sliderValue + step);
        } else if (event.key === 'Home') {
            event.preventDefault();
            setSliderValue(0);
        } else if (event.key === 'End') {
            event.preventDefault();
            setSliderValue(100);
        }
    });

    const updateZoomSource = (source) => {
        zoomSource = source;
        stage.dataset.zoomSource = source;
        zoomSourceBtns.forEach((btn) => {
            const isActive = btn.dataset.source === source;
            btn.classList.toggle('active', isActive);
        });
        if (zoomEnabled && lastPointerCoords) {
            updateLensPosition(lastPointerCoords);
        }
    };

    zoomSourceBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
            const source = btn.dataset.source || 'optimized';
            if (source !== zoomSource) {
                updateZoomSource(source);
            }
            if (source === 'original') {
                setSliderValue(0);
            } else {
                setSliderValue(100);
            }
        });
    });

    zoomToggleBtn?.addEventListener('click', () => {
        zoomEnabled = !zoomEnabled;
        zoomToggleBtn.setAttribute('aria-pressed', zoomEnabled);
        zoomToggleBtn.classList.toggle('is-active', zoomEnabled);
        stage.classList.toggle('zoom-active', zoomEnabled);
        if (!zoomEnabled) {
            lens?.classList.remove('is-visible');
        } else if (lastPointerCoords) {
            updateLensPosition(lastPointerCoords);
        }
    });

    stage.addEventListener('pointerenter', (event) => {
        if (!zoomEnabled) return;
        lastPointerCoords = { clientX: event.clientX, clientY: event.clientY };
        updateLensPosition(lastPointerCoords);
    });

    setSliderValue(sliderValue);
    updateZoomSource(zoomSource);
}

function buildComparisonMarkup(file, originalSrc, optimizedSrc, index) {
    const safeOriginalAlt = escapeHTML(`Original ${file.name}`);
    const safeOptimizedAlt = escapeHTML(`Optimized ${file.name}`);

    return `
        <div class="comparison-module" data-index="${index}">
            <div class="comparison-toolbar">
                <span class="comparison-pill">
                    <svg viewBox="0 0 24 24" role="presentation" aria-hidden="true">
                        <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
                    </svg>
                    Drag to compare
                </span>
                <div class="comparison-actions">
                    <button class="zoom-toggle-btn" type="button" aria-pressed="false">
                        <svg viewBox="0 0 24 24" role="presentation" aria-hidden="true">
                            <circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2" fill="none"></circle>
                            <line x1="16.5" y1="16.5" x2="21" y2="21" stroke="currentColor" stroke-width="2" stroke-linecap="round"></line>
                        </svg>
                        Zoom
                    </button>
                    <div class="zoom-source-group" role="group" aria-label="Zoom source">
                        <button class="zoom-source-btn active" type="button" data-source="optimized">After</button>
                        <button class="zoom-source-btn" type="button" data-source="original">Before</button>
                    </div>
                </div>
            </div>
            <div class="comparison-stage" data-zoom-source="optimized">
                <img src="${originalSrc}" alt="${safeOriginalAlt}" class="comparison-image comparison-image--before" draggable="false">
                <div class="comparison-after-layer" style="clip-path: inset(0 50% 0 0); -webkit-clip-path: inset(0 50% 0 0);">
                    <img src="${optimizedSrc}" alt="${safeOptimizedAlt}" class="comparison-image comparison-image--after" draggable="false">
                </div>
                <button class="comparison-handle" type="button" role="slider" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50" aria-label="Drag to compare">
                    <span class="comparison-handle-icon"></span>
                </button>
                <div class="comparison-zoom-lens" aria-hidden="true"></div>
            </div>
            <p class="comparison-hint">Drag the handle or use arrow keys for fine control. Toggle zoom to inspect pixels.</p>
        </div>
    `;
}

function escapeHTML(str = '') {
    return str.replace(/[&<>"']/g, (char) => {
        switch (char) {
            case '&':
                return '&amp;';
            case '<':
                return '&lt;';
            case '>':
                return '&gt;';
            case '"':
                return '&quot;';
            case "'":
                return '&#39;';
            default:
                return char;
        }
    });
}

function optimizeImages() {
    if (isOptimizing) {
        return;
    }
    if (uploadedFiles.length === 0) return;

    optimizedImages = new Array(uploadedFiles.length);
    optimizedPreviews = new Array(uploadedFiles.length);
    resultsSection.innerHTML = '';
    resetBatchUI();
    isOptimizing = true;
    showProgressModal();

    const useTargetSize = targetSizeToggle.checked;
    let targetSizeKB = useTargetSize ? parseFloat(targetSizeInput.value) : null;
    if (useTargetSize && (isNaN(targetSizeKB) || targetSizeKB <= 0)) {
        targetSizeKB = 100; // Safe default
        targetSizeInput.value = 100;
        targetSizeValue.textContent = '100 KB';
    }
    const targetSizeBytes = targetSizeKB ? targetSizeKB * 1024 : null;

    const quality = qualitySlider.value / 100;
    const maxW = parseInt(maxWidth.value, 10);
    const maxH = parseInt(maxHeight.value, 10);
    const selectedFormat = formatSelect.value;

    const btnText = optimizeBtn.querySelector('.btn-text');
    if (btnText) {
        btnText.textContent = 'Optimizing...';
    } else {
        optimizeBtn.textContent = 'Optimizing...';
    }
    optimizeBtn.disabled = true;

    const filesToProcess = [...uploadedFiles];
    const totalFiles = filesToProcess.length;
    let processedCount = 0;

    // Reset results for these files
    optimizedImages = new Array(totalFiles);
    optimizedPreviews = new Array(totalFiles);

    // Generate placeholders first to maintain order in UI
    filesToProcess.forEach((file, index) => {
        const objectUrl = createPointerUrl(file);
        const card = createImageCard(file, objectUrl, index, false);
        card.classList.add('is-processing');
        resultsSection.appendChild(card);
    });

    showProgressModal();

    // Process sequentially to prevent UI freezing and memory spikes
    executeSequentialOptimization(filesToProcess, useTargetSize, targetSizeBytes, maxW, maxH, selectedFormat, processedCount, totalFiles)
        .then(() => {
            isOptimizing = false;
            hideProgressModal();
            enableOptimizeButton();
            showSuccessSummary(filesToProcess);
        });
}

async function executeSequentialOptimization(files, useTargetSize, targetSizeBytes, maxW, maxH, selectedFormat, processedCount, totalFiles) {
    for (let index = 0; index < files.length; index++) {
        const file = files[index];
        // Check if existing preview URL from the placeholder card
        const card = resultsSection.querySelector(`.result-card[data-index="${index}"]`);
        const placeholderImg = card?.querySelector('img');
        const objectUrl = placeholderImg?.src || createPointerUrl(file);

        try {
            const img = await loadImage(objectUrl);
            const features = await ensureImageFeatures(index, file, img);
            const targetFormat = resolveOutputFormat(selectedFormat, features);

            if (useTargetSize && targetSizeBytes) {
                await optimizeToTargetSize(img, file, objectUrl, index, targetSizeBytes, maxW, maxH, targetFormat);
            } else {
                await optimizeWithSettings(img, file, objectUrl, index, qualitySlider.value / 100, maxW, maxH, targetFormat);
            }
        } catch (error) {
            console.error(`Optimization failed for ${file?.name || 'image'}`, error);
            Toast.error(`Optimization failed for ${file?.name || 'this image'}.`, 'Optimization Error');
            updateCardToFailed(index, file);
        } finally {
            processedCount++;
            updateProgress(processedCount + 1, totalFiles); // +1 because we updated after processing? No, standard 0-based.
            // updateProgress implementation usually takes (current, total). 
            // Original code: processedCount initialized 0. In callback: processedCount++, then updateProgress(processedCount, totalFiles).
            // So if 1 file, processedCount becomes 1. updateProgress(1, 1). Correct.
            // Here: index 0. processedCount (passed in) is 0? 
            // processedCount is a primitive passed by value? No, it's a variable in closure? 
            // I can't pass 'processedCount' primitive and expect it to update outside logic if I needed it. 
            // But I am rewriting the loop logic here so I can just manage a local counter.
            // Or better, just use index+1.
            updateProgress(index + 1, totalFiles);
        }
    }
}

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Image load error'));
        img.src = src;
    });
}

function enableOptimizeButton() {
    const btnTextNode = optimizeBtn.querySelector('.btn-text');
    if (btnTextNode) {
        btnTextNode.textContent = 'Optimize Images';
    } else {
        optimizeBtn.textContent = 'Optimize Images';
    }
    optimizeBtn.disabled = false;
}

function showSuccessSummary(filesToProcess) {
    const originalTotal = filesToProcess.reduce((acc, file) => acc + file.size, 0);
    const optimizedTotal = optimizedImages.reduce((acc, file) => acc + (file ? file.size : 0), 0);
    const count = optimizedImages.filter(Boolean).length;

    if (count > 0 && typeof showSuccessModal === 'function') {
        showSuccessModal({
            originalTotal,
            optimizedTotal,
            count
        });
    }
}

async function optimizeWithSettings(img, file, originalSrc, index, quality, maxW, maxH, format) {
    const canvas = document.createElement('canvas');
    let width = img.width;
    let height = img.height;

    // Calculate new dimensions maintaining aspect ratio
    if (width > maxW || height > maxH) {
        const ratio = Math.min(maxW / width, maxH / height);
        width = width * ratio;
        height = height * ratio;
    }

    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);

    const encodeResult = await encodeCanvasWithFallback(canvas, format, quality);
    if (!encodeResult) {
        throw new Error('Unable to encode image with available formats.');
    }
    const { blob, url, formatUsed } = encodeResult;
    const mimeType = getMimeTypeForFormat(formatUsed);
    const optimizedFile = new File([blob], getOptimizedFileName(file.name, formatUsed), { type: mimeType });

    storeOptimizedResult(index, optimizedFile, url);

    // Update existing card slot
    const newCard = createImageCard(file, url, index, true, originalSrc);
    replaceCardAtIndex(index, newCard);
}

async function optimizeToTargetSize(img, file, originalSrc, index, targetSizeBytes, maxW, maxH, format) {
    const originalWidth = img.width;
    const originalHeight = img.height;

    let currentWidth = originalWidth;
    let currentHeight = originalHeight;
    // Apply max dimensions constraint first
    if (currentWidth > maxW || currentHeight > maxH) {
        const ratio = Math.min(maxW / currentWidth, maxH / currentHeight);
        currentWidth = Math.floor(currentWidth * ratio);
        currentHeight = Math.floor(currentHeight * ratio);
    }

    const isPNG = format === 'png';
    let minQuality = 0.05;
    let maxQuality = 1.0;
    let currentQuality = 0.8;
    const tolerance = 0.05; // 5% tolerance
    const maxIterations = 30;

    let closestBlob = null;
    let closestUrl = null;
    let closestDiff = Infinity;

    const recordCandidate = (blob, url) => {
        const diff = Math.abs(blob.size - targetSizeBytes);
        const isUnder = blob.size <= targetSizeBytes;
        const currentIsUnder = closestBlob ? closestBlob.size <= targetSizeBytes : false;

        let isBetter = false;

        // Prefer result that is under the limit, otherwise closest
        if (isUnder && !currentIsUnder) {
            isBetter = true;
        } else if (isUnder === currentIsUnder && diff < closestDiff) {
            isBetter = true;
        } else if (!closestBlob) {
            isBetter = true;
        }

        if (isBetter) {
            // Revoke the previous closest URL to prevent memory leaks
            if (closestUrl && closestUrl !== url) {
                safeRevokeUrl(closestUrl);
            }
            closestDiff = diff;
            closestBlob = blob;
            closestUrl = url;
        } else if (url !== closestUrl) {
            // New candidate is not better, so we don't keep it.
            // The caller (main loop) manages currentUrl and might reuse it for next iteration 
            // or switch it. But 'recordCandidate' is called right after generation.
            // If it's not chosen as closest, it remains 'currentUrl' in the loop.
            // The loop checks "if (currentUrl !== closestUrl) safeRevokeUrl(currentUrl)" 
            // which handles cleaning up the losers.
            // So we don't need to do anything here for the loser.
        }
    };

    let activeFormat = format;
    const drawAndMeasure = async (width, height, q) => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        // Ensure quality is never 0 or invalid
        const qualityVal = Math.max(0.01, Math.min(1, q));
        const encodeResult = await encodeCanvasWithFallback(canvas, activeFormat, qualityVal);
        if (!encodeResult) {
            throw new Error('Failed to encode image while targeting file size.');
        }
        activeFormat = encodeResult.formatUsed;
        return { blob: encodeResult.blob, url: encodeResult.url };
    };

    // Initial measurement
    let { blob: currentBlob, url: currentUrl } = await drawAndMeasure(currentWidth, currentHeight, currentQuality);
    recordCandidate(currentBlob, currentUrl);

    let iterations = 0;
    while (iterations < maxIterations) {
        // Check if we are close enough
        if (Math.abs(currentBlob.size - targetSizeBytes) / targetSizeBytes <= tolerance) {
            closestBlob = currentBlob;
            closestUrl = currentUrl;
            break;
        }

        let adjustDimensions = false;

        if (isPNG) {
            adjustDimensions = true;
        } else {
            // For JPEG/WebP/etc, try quality first, then dimensions
            if (currentBlob.size > targetSizeBytes) {
                // Too big
                if (currentQuality > minQuality + 0.02) {
                    maxQuality = currentQuality;
                    currentQuality = (minQuality + maxQuality) / 2;
                } else {
                    // Quality bottomed out, must shrink dimensions
                    adjustDimensions = true;
                }
            } else {
                // Too small, try to improve quality
                if (currentQuality < 0.98) {
                    minQuality = currentQuality;
                    currentQuality = (minQuality + maxQuality) / 2;
                    if (maxQuality - minQuality < 0.01) {
                        // Quality converged
                        if (currentWidth < Math.min(originalWidth, maxW)) {
                            // If we had shrunk it, maybe we can grow it back a little?
                            // For simplicity, let's stop here if quality is maxed for this size.
                            // Or enable adjustDimensions to grow?
                            // Let's safe break to avoid infinite oscillation
                            break;
                        }
                        break;
                    }
                } else {
                    break;
                }
            }
        }

        if (adjustDimensions) {
            const scaleFactor = Math.sqrt(targetSizeBytes / currentBlob.size);
            let nextWidth = Math.floor(currentWidth * scaleFactor);
            let nextHeight = Math.floor(currentHeight * scaleFactor);

            // Dampen changes
            if (currentBlob.size > targetSizeBytes) {
                // Determine penalty based on how far off we are
                // If way off, shrink aggressively. If close, gentle.
                nextWidth = Math.min(nextWidth, Math.floor(currentWidth * 0.95));
                nextHeight = Math.min(nextHeight, Math.floor(currentHeight * 0.95));
            } else {
                nextWidth = Math.max(nextWidth, Math.ceil(currentWidth * 1.05));
                nextHeight = Math.max(nextHeight, Math.ceil(currentHeight * 1.05));
            }

            // Constraints
            const limitW = Math.min(originalWidth, maxW);
            const limitH = Math.min(originalHeight, maxH);

            if (nextWidth > limitW || nextHeight > limitH) {
                // If we hit the generic max limits, just clamp and relying on quality
                if (nextWidth > limitW) {
                    nextWidth = limitW;
                    nextHeight = Math.floor(limitW / (originalWidth / originalHeight));
                }
                if (nextHeight > limitH) {
                    nextHeight = limitH;
                    nextWidth = Math.floor(limitH * (originalWidth / originalHeight));
                }
                // If we are already at limits, we can't grow
                if (nextWidth === currentWidth && nextHeight === currentHeight) {
                    break;
                }
            }

            if (nextWidth < 50 || nextHeight < 50) {
                // Don't shrink to invisible
                break;
            }

            currentWidth = nextWidth;
            currentHeight = nextHeight;
        }

        if (currentUrl !== closestUrl) {
            safeRevokeUrl(currentUrl);
        }
        ({ blob: currentBlob, url: currentUrl } = await drawAndMeasure(currentWidth, currentHeight, currentQuality));
        recordCandidate(currentBlob, currentUrl);
        iterations++;
    }

    const finalBlob = closestBlob || currentBlob;
    const finalUrl = closestUrl || currentUrl;

    const finalFormat = activeFormat;
    const mimeType = getMimeTypeForFormat(finalFormat);
    const optimizedFile = new File([finalBlob], getOptimizedFileName(file.name, finalFormat), { type: mimeType });
    storeOptimizedResult(index, optimizedFile, finalUrl);

    const newCard = createImageCard(file, finalUrl, index, true, originalSrc);
    replaceCardAtIndex(index, newCard);
}

function replaceCardAtIndex(index, newCard) {
    if (!resultsSection) return;
    const oldCard = resultsSection.querySelector(`.result-card[data-index="${index}"]`);
    if (oldCard) {
        // Clean up old URLs
        const images = oldCard.querySelectorAll('img');
        images.forEach(img => safeRevokeUrl(img.src));
        resultsSection.replaceChild(newCard, oldCard);
    } else {
        resultsSection.appendChild(newCard);
    }
}

function updateCardToFailed(index, file) {
    const card = resultsSection ? resultsSection.querySelector(`.result-card[data-index="${index}"]`) : null;
    if (card) {
        card.classList.remove('is-processing');
        card.classList.add('has-failed');
        const statusEl = document.createElement('div');
        statusEl.className = 'failed-badge';
        statusEl.textContent = 'Optimization Failed';
        card.appendChild(statusEl);
    }
}

function storeOptimizedResult(index, optimizedFile, previewUrl) {
    optimizedImages[index] = optimizedFile;
    optimizedPreviews[index] = {
        url: previewUrl,
        originalName: uploadedFiles[index]?.name || optimizedFile.name
    };
    updateBatchUI();
}

function handleBatchGridToggle() {
    setBatchGridVisibility(!batchGridVisible);
}

function setBatchGridVisibility(visible) {
    if (!batchGridWrapper || !batchGridToggle) return;
    batchGridVisible = visible;
    if (visible) {
        batchGridWrapper.style.display = 'block';
        batchGridWrapper.removeAttribute('hidden');
        renderBatchGrid();
    } else {
        batchGridWrapper.style.display = 'none';
        batchGridWrapper.setAttribute('hidden', 'hidden');
    }
    batchGridToggle.setAttribute('aria-pressed', visible);
    const textNode = batchGridToggle.querySelector('.btn-text');
    if (textNode) {
        textNode.textContent = visible ? 'Hide Batch Grid' : 'Show Batch Grid';
    }
}

function renderBatchGrid() {
    if (!batchGrid) return;
    const items = optimizedImages.map((file, index) => {
        if (!file) return '';
        const previewData = optimizedPreviews[index];
        const previewSrc = previewData?.url || '';
        const originalFile = uploadedFiles[index];
        const originalSize = originalFile?.size || 0;
        const sizeLabel = originalSize > 0 ? ` • ${getCompressionLabel(originalSize, file.size)}` : '';
        const optimizedSizeLabel = `${formatFileSize(file.size)}${sizeLabel}`;
        const safeName = escapeHTML(file.name);
        const safeAlt = escapeHTML(previewData?.originalName || file.name);
        const imageMarkup = previewSrc
            ? `<img src="${previewSrc}" alt="${safeAlt} preview">`
            : `<div class="batch-grid-placeholder">Preview unavailable</div>`;
        return `
            <article class="batch-grid-item">
                <div class="batch-grid-thumb">
                    ${imageMarkup}
                </div>
                <p class="batch-grid-name">${safeName}</p>
                <p class="batch-grid-size">${optimizedSizeLabel}</p>
            </article>
        `;
    }).join('').trim();
    batchGrid.innerHTML = items || '<p class="batch-grid-placeholder">Optimize images to populate the batch grid.</p>';
}

function handleDownloadAllClick() {
    if (!optimizedImages.some(Boolean) || downloadAllBtn.disabled) return;
    setDownloadAllButtonLoading(true);
    downloadAllAsZip()
        .catch((error) => {
            console.error('Failed to create ZIP:', error);
            Toast.error('Unable to prepare the ZIP file. Please try again.', 'ZIP Error');
        })
        .finally(() => {
            setDownloadAllButtonLoading(false);
        });
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const isDark = theme === 'dark';

    if (isDark) {
        document.body.classList.add('dark-mode');
        document.body.classList.remove('light-mode');
    } else {
        document.body.classList.remove('dark-mode');
        // Optional: fail-safe if anything relies on light-mode class, though CSS implies default
        document.body.classList.add('light-mode');
    }

    if (themeToggle) {
        themeToggle.setAttribute('aria-pressed', isDark);
        const textNode = themeToggle.querySelector('.btn-text');
        if (textNode) {
            textNode.textContent = isDark ? 'Disable Dark Mode' : 'Enable Dark Mode';
        }
    }
}

function handleThemeToggle() {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try {
        localStorage.setItem('theme', next);
    } catch (e) { }
}

function setDownloadAllButtonLoading(isLoading) {
    if (!downloadAllBtn) return;
    downloadAllBtn.classList.toggle('is-loading', isLoading);
    downloadAllBtn.disabled = isLoading || !optimizedImages.some(Boolean);
    const textNode = downloadAllBtn.querySelector('.btn-text');
    if (textNode) {
        textNode.textContent = isLoading ? 'Preparing ZIP...' : 'Download All (ZIP)';
    }
}

async function downloadAllAsZip() {
    if (typeof JSZip === 'undefined') {
        throw new Error('JSZip library is not available.');
    }
    const zip = new JSZip();
    optimizedImages.forEach((file) => {
        if (!file) return;
        zip.file(file.name, file);
    });
    const blob = await zip.generateAsync({ type: 'blob' });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const zipName = `optimized-images-${timestamp}.zip`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = zipName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function updateBatchUI() {
    if (!batchTools || !batchCountEl || !batchSavingsEl || !downloadAllBtn) return;
    const optimizedCount = optimizedImages.filter(Boolean).length;
    if (optimizedCount === 0) {
        resetBatchUI();
        return;
    }
    batchTools.style.display = 'block';
    const totals = optimizedImages.reduce((acc, file, index) => {
        if (!file) return acc;
        acc.optimized += file.size;
        acc.original += uploadedFiles[index]?.size || 0;
        return acc;
    }, { original: 0, optimized: 0 });
    batchCountEl.textContent = optimizedCount === 1 ? '1 optimized image' : `${optimizedCount} optimized images`;
    const diff = totals.original - totals.optimized;
    const prefix = diff >= 0 ? 'Saved' : 'Grew by';
    const savingsText = totals.original > 0
        ? `${prefix} ${formatFileSize(Math.abs(diff))} (${getCompressionLabel(totals.original, totals.optimized)})`
        : `${prefix} ${formatFileSize(Math.abs(diff))}`;
    batchSavingsEl.textContent = savingsText;
    downloadAllBtn.disabled = optimizedCount === 0;
    if (batchGridVisible) {
        renderBatchGrid();
    }
}

function resetBatchUI() {
    if (!batchTools || !batchCountEl || !batchSavingsEl) return;
    batchTools.style.display = 'none';
    batchGridVisible = false;
    if (batchGridWrapper) {
        batchGridWrapper.style.display = 'none';
        batchGridWrapper.setAttribute('hidden', 'hidden');
    }
    if (batchGrid) {
        batchGrid.innerHTML = '';
    }
    if (batchGridToggle) {
        batchGridToggle.setAttribute('aria-pressed', 'false');
        const textNode = batchGridToggle.querySelector('.btn-text');
        if (textNode) {
            textNode.textContent = 'Show Batch Grid';
        }
    }
    batchCountEl.textContent = '0 optimized images';
    batchSavingsEl.textContent = 'Saved 0 KB';
    if (downloadAllBtn) {
        downloadAllBtn.disabled = true;
        const btnText = downloadAllBtn.querySelector('.btn-text');
        if (btnText) {
            btnText.textContent = 'Download All (ZIP)';
        }
    }
}

function dataURLtoBlob(dataurl) {
    const arr = dataurl.split(',');
    const mime = arr[0].match(/:(.*?);/)[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
}

function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

function getOptimizedFileName(originalName, forcedFormat = null) {
    const nameWithoutExt = originalName && originalName.lastIndexOf('.') > 0
        ? originalName.substring(0, originalName.lastIndexOf('.'))
        : (originalName || 'image');
    const format = forcedFormat && forcedFormat !== 'auto'
        ? forcedFormat
        : (formatSelect?.value && formatSelect.value !== 'auto' ? formatSelect.value : 'jpeg');
    const extension = FORMAT_DEFINITIONS[format]?.extension || format || 'jpg';
    return `${nameWithoutExt}_optimized.${extension}`;
}

function formatFileSize(bytes) {
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

function calculateSavings(originalSize, optimizedSize) {
    const saved = originalSize - optimizedSize;
    return formatFileSize(saved);
}

function getCompressionPercentage(originalSize, optimizedSize) {
    if (!originalSize) return 0;
    return Math.round((1 - optimizedSize / originalSize) * 100);
}

function getCompressionLabel(originalSize, optimizedSize) {
    if (!originalSize) {
        return '0% change';
    }
    const percentage = getCompressionPercentage(originalSize, optimizedSize);
    return percentage >= 0 ? `${percentage}% smaller` : `${Math.abs(percentage)}% larger`;
}

function getCompressionBadgeClass(originalSize, optimizedSize) {
    const percentage = getCompressionPercentage(originalSize, optimizedSize);
    if (percentage >= 50) return 'excellent';
    if (percentage >= 20) return 'good';
    return '';
}

function initializeFormatSupport() {
    const canvas = document.createElement('canvas');
    formatSupportMap = {};
    Object.entries(FORMAT_DEFINITIONS).forEach(([format, definition]) => {
        if (!definition.mime) return;
        try {
            const dataUrl = canvas.toDataURL(definition.mime);
            formatSupportMap[format] = typeof dataUrl === 'string' && dataUrl.startsWith(`data:${definition.mime}`);
        } catch (error) {
            formatSupportMap[format] = false;
        }
    });
    formatSupportMap.jpeg = true;
    formatSupportMap.png = true;
    // Override with WASM-backed support guarantees
    // WASM codecs are always available regardless of native browser support
    Object.keys(WASM_CODEC_SOURCES).forEach((format) => {
        formatSupportMap[format] = true;
    });
    applyAdvancedFormatConstraints();
}

function applyAdvancedFormatConstraints() {
    if (!hasSharedArrayBufferSupport()) {
        formatSupportMap.jxl = false;
    }
}

function hasSharedArrayBufferSupport() {
    return typeof SharedArrayBuffer !== 'undefined';
}

function syncFormatSelectWithSupport() {
    if (!formatSelect) return;
    Array.from(formatSelect.options || []).forEach((option) => {
        const format = option.value;
        const baseLabel = option.getAttribute('data-label') || option.textContent;
        option.setAttribute('data-label', baseLabel);
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

function updateFormatRecommendationUI(forceReset = false) {
    if (!formatRecommendationText) return;
    if (!uploadedFiles.length) {
        formatRecommendationText.textContent = 'Upload images to see format recommendations.';
        return;
    }
    if (forceReset || !imageFeatureCache.some(Boolean)) {
        formatRecommendationText.textContent = 'Analyzing images for best formats...';
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
        formatRecommendationText.textContent = 'Analyzing images for best formats...';
        return;
    }
    const sorted = Object.entries(stats.counts).sort((a, b) => {
        if (b[1] === a[1]) {
            return getPreferenceIndex(a[0]) - getPreferenceIndex(b[0]);
        }
        return b[1] - a[1];
    });
    const bestFormat = sorted[0]?.[0] || findFirstSupportedFormat();
    const label = FORMAT_DEFINITIONS[bestFormat]?.label || bestFormat.toUpperCase();
    const reasonParts = [];
    if (stats.animated) {
        reasonParts.push('motion detected');
    } else if (stats.alpha) {
        reasonParts.push('transparency detected');
    } else {
        reasonParts.push('photographic detail');
    }
    formatRecommendationText.textContent = `Recommended: ${label} — ${reasonParts.join(', ')}`;
}

async function ensureImageFeatures(index, file, img) {
    if (imageFeatureCache[index]) {
        return imageFeatureCache[index];
    }
    const features = await deriveImageFeatures(file, img);
    imageFeatureCache[index] = features;
    updateFormatRecommendationUI();
    return features;
}

async function deriveImageFeatures(file, img) {
    const hasAlpha = detectTransparencyFromImage(img);
    const isAnimated = await detectMotionFromFile(file);
    const recommendation = resolveRecommendedFormat({ hasAlpha, isAnimated });
    return { hasAlpha, isAnimated, recommendation };
}

function detectTransparencyFromImage(img) {
    if (!img) return false;
    const sampleSize = 256;
    const scale = Math.min(1, sampleSize / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(img.width * scale));
    canvas.height = Math.max(1, Math.floor(img.height * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for (let i = 3; i < data.length; i += 4) {
        if (data[i] < 250) {
            return true;
        }
    }
    return false;
}

async function detectMotionFromFile(file) {
    if (!file) return false;
    const cacheKey = getMotionCacheKey(file);
    if (!cacheKey) return false;
    if (motionDetectionCache.has(cacheKey)) {
        return motionDetectionCache.get(cacheKey);
    }
    let isAnimated = false;
    try {
        if (file.type === 'image/gif') {
            const buffer = await file.arrayBuffer();
            isAnimated = isAnimatedGif(new Uint8Array(buffer));
        } else if (file.type === 'image/webp') {
            const buffer = await file.arrayBuffer();
            isAnimated = isAnimatedWebp(new Uint8Array(buffer));
        }
    } catch (error) {
        console.warn('Unable to inspect animation data for', file.name, error);
    }
    motionDetectionCache.set(cacheKey, isAnimated);
    return isAnimated;
}

function isAnimatedGif(bytes) {
    if (!bytes || bytes.length < 20) return false;
    let frames = 0;
    for (let i = 0; i < bytes.length - 9; i++) {
        if (bytes[i] === 0x21 && bytes[i + 1] === 0xF9 && bytes[i + 2] === 0x04) {
            frames += 1;
            if (frames > 1) return true;
        }
    }
    return false;
}

function isAnimatedWebp(bytes) {
    if (!bytes || bytes.length < 20) return false;
    const decoder = new TextDecoder('ascii');
    const sample = bytes.subarray(0, Math.min(bytes.length, 4096));
    const text = decoder.decode(sample);
    return text.includes('ANMF') || text.includes('ANIM');
}

function resolveRecommendedFormat(features = {}) {
    const { hasAlpha, isAnimated } = features;
    const preference = [];
    if (isAnimated) {
        preference.push('avif', 'webp');
    } else if (hasAlpha) {
        preference.push('avif', 'jxl', 'webp', 'png');
    } else {
        preference.push('avif', 'jxl', 'webp', 'jpeg');
    }
    preference.push(...FORMAT_PRIORITY_ORDER, 'jpeg', 'png');
    return preference.find(isFormatSupported) || 'jpeg';
}

function resolveOutputFormat(selectedFormat, features = {}) {
    if (selectedFormat && selectedFormat !== 'auto') {
        return ensureFormatSupported(selectedFormat);
    }
    const recommendation = features.recommendation || resolveRecommendedFormat(features);
    return ensureFormatSupported(recommendation);
}

function ensureFormatSupported(format) {
    if (isFormatSupported(format)) {
        return format;
    }
    const fallback = findFirstSupportedFormat();
    console.warn(`Format ${format} is not supported. Falling back to ${fallback}.`);
    announceFormatUnsupported(format, fallback);
    return fallback;
}

function isFormatSupported(format) {
    if (!format || format === 'auto') return false;
    if (format === 'jpeg' || format === 'png') return true;
    if (formatSupportMap[format] === undefined) {
        return true;
    }
    return !!formatSupportMap[format];
}

function findFirstSupportedFormat(order = FORMAT_PRIORITY_ORDER) {
    const searchOrder = [...order, 'webp', 'jpeg', 'png'];
    const match = searchOrder.find((format) => isFormatSupported(format));
    return match || 'jpeg';
}

function announceFormatUnsupported(requestedFormat, fallbackFormat) {
    if (!requestedFormat || requestedFormat === fallbackFormat) return;
    notifyFormatFallback(requestedFormat, fallbackFormat, true);
}

function notifyFormatFallback(requestedFormat, usedFormat, persistent = false) {
    if (!formatWarningText || !requestedFormat || requestedFormat === usedFormat) return;
    const requestedLabel = getFormatLabel(requestedFormat);
    const usedLabel = getFormatLabel(usedFormat);
    const message = `${requestedLabel} isn't available right now. Using ${usedLabel} instead.`;
    showFormatWarning(message, persistent);
}

function getFormatLabel(format) {
    return FORMAT_DEFINITIONS[format]?.label || (format ? format.toUpperCase() : 'selected format');
}

function showFormatWarning(message, isPersistent = false) {
    if (!formatWarningText || !message) return;
    if (message === lastFormatWarningMessage && !formatWarningText.hasAttribute('hidden')) {
        return;
    }
    lastFormatWarningMessage = message;
    formatWarningText.textContent = message;
    formatWarningText.removeAttribute('hidden');
    if (!isPersistent) {
        if (formatWarningTimeoutId) {
            clearTimeout(formatWarningTimeoutId);
        }
        formatWarningTimeoutId = setTimeout(() => {
            hideFormatWarning();
        }, 6000);
    }
}

function hideFormatWarning() {
    if (!formatWarningText) return;
    formatWarningText.textContent = '';
    formatWarningText.setAttribute('hidden', 'hidden');
    lastFormatWarningMessage = '';
    if (formatWarningTimeoutId) {
        clearTimeout(formatWarningTimeoutId);
        formatWarningTimeoutId = null;
    }
}

function getPreferenceIndex(format) {
    const index = FORMAT_PRIORITY_ORDER.indexOf(format);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function getFallbackOrder(preferredFormat) {
    const sequence = [preferredFormat, ...FORMAT_PRIORITY_ORDER, 'webp', 'jpeg', 'png'].filter(Boolean);
    return [...new Set(sequence)];
}

function getMimeTypeForFormat(format) {
    return FORMAT_DEFINITIONS[format]?.mime || 'image/jpeg';
}

async function tryEncodeCanvas(canvas, format, quality) {
    const definition = FORMAT_DEFINITIONS[format];
    if (!definition?.mime) return null;
    try {
        if (format === 'avif' || format === 'jxl') {
            return await encodeWithWasm(canvas, format, quality);
        }

        return new Promise((resolve) => {
            canvas.toBlob((blob) => {
                if (!blob) {
                    resolve(null);
                    return;
                }
                // Check if the browser actually returned the requested format
                // Browser might fallback to PNG if format is unsupported
                if (blob.type !== definition.mime && format !== 'jpeg' && format !== 'png') {
                    // If we asked for webp but got png, browser doesn't support it natively
                    resolve(null);
                    return;
                }
                resolve({
                    blob,
                    url: createPointerUrl(blob),
                    formatUsed: format
                });
            }, definition.mime, quality);
        });
    } catch (error) {
        return null;
    }
}

async function encodeCanvasWithFallback(canvas, preferredFormat, quality) {
    const order = getFallbackOrder(preferredFormat);
    for (const format of order) {
        const result = await tryEncodeCanvas(canvas, format, quality);
        if (result) {
            if (format !== preferredFormat) {
                console.warn(`Falling back to ${format.toUpperCase()} encoding.`);
                notifyFormatFallback(preferredFormat, result.formatUsed);
            }
            return result;
        }
    }
    return null;
}

async function encodeWithWasm(canvas, format, quality) {
    const encodeFn = await loadWasmCodec(format);
    if (!encodeFn) {
        throw new Error(`No WASM encoder available for ${format}.`);
    }
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const options = buildWasmOptions(format, quality);
    const encodedBuffer = await encodeFn(imageData, options);
    const mimeType = getMimeTypeForFormat(format);
    const blob = new Blob([encodedBuffer], { type: mimeType });
    return { blob, url: createPointerUrl(blob), formatUsed: format };
}

async function loadWasmCodec(format) {
    if (!WASM_CODEC_SOURCES[format]) return null;
    if (!wasmCodecCache[format]) {
        wasmCodecCache[format] = import(WASM_CODEC_SOURCES[format])
            .then((mod) => {
                if (!mod?.encode) {
                    throw new Error(`Encoder for ${format} missing encode export.`);
                }
                return mod.encode;
            })
            .catch((error) => {
                console.error(`Failed to load ${format.toUpperCase()} encoder`, error);
                return null;
            });
    }
    return wasmCodecCache[format];
}

function buildWasmOptions(format, quality) {
    const normalizedQuality = clampQuality(quality);
    if (format === 'avif') {
        const cqLevel = Math.round((1 - normalizedQuality) * 45) + 5; // range roughly 5-50
        return {
            cqLevel,
            cqAlphaLevel: cqLevel,
            effort: normalizedQuality >= 0.85 ? 5 : normalizedQuality >= 0.65 ? 4 : 3,
            subsample: normalizedQuality >= 0.75 ? 1 : 2
        };
    }
    if (format === 'jxl') {
        return {
            quality: Math.round(normalizedQuality * 100),
            effort: normalizedQuality >= 0.85 ? 8 : normalizedQuality >= 0.65 ? 6 : 4
        };
    }
    return {};
}

function clampQuality(value) {
    if (typeof value !== 'number' || Number.isNaN(value)) {
        return 0.8;
    }
    return Math.min(1, Math.max(0.05, value));
}


