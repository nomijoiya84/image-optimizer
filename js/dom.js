/**
 * DOM element references
 */

export const elements = {
    uploadArea: null,
    fileInput: null,
    controlsSection: null,
    resultsSection: null,
    qualitySlider: null,
    qualityValue: null,
    maxWidth: null,
    widthValue: null,
    maxHeight: null,
    heightValue: null,
    formatSelect: null,
    optimizeBtn: null,
    targetSizeToggle: null,
    targetSizeInput: null,
    targetSizeValue: null,
    targetSizeWrapper: null,
    batchTools: null,
    batchCount: null,
    batchSavings: null,
    batchGridToggle: null,
    batchGridWrapper: null,
    batchGrid: null,
    downloadAllBtn: null,
    themeToggle: null,
    formatRecommendation: null,
    formatWarning: null,
    originalSizeDisplay: null
};

export function initDOM() {
    elements.uploadArea = document.getElementById('uploadArea');
    elements.fileInput = document.getElementById('fileInput');
    elements.controlsSection = document.getElementById('controlsSection');
    elements.resultsSection = document.getElementById('resultsSection');
    elements.qualitySlider = document.getElementById('qualitySlider');
    elements.qualityValue = document.getElementById('qualityValue');
    elements.maxWidth = document.getElementById('maxWidth');
    elements.widthValue = document.getElementById('widthValue');
    elements.maxHeight = document.getElementById('maxHeight');
    elements.heightValue = document.getElementById('heightValue');
    elements.formatSelect = document.getElementById('formatSelect');
    elements.optimizeBtn = document.getElementById('optimizeBtn');
    elements.targetSizeToggle = document.getElementById('targetSizeToggle');
    elements.targetSizeInput = document.getElementById('targetSizeInput');
    elements.targetSizeValue = document.getElementById('targetSizeValue');
    elements.targetSizeWrapper = document.getElementById('targetSizeWrapper');
    elements.batchTools = document.getElementById('batchTools');
    elements.batchCount = document.getElementById('batchCount');
    elements.batchSavings = document.getElementById('batchSavings');
    elements.batchGridToggle = document.getElementById('batchGridToggle');
    elements.batchGridWrapper = document.getElementById('batchGridWrapper');
    elements.batchGrid = document.getElementById('batchGrid');
    elements.downloadAllBtn = document.getElementById('downloadAllBtn');
    elements.themeToggle = document.getElementById('themeToggle');
    elements.formatRecommendation = document.getElementById('formatRecommendation');
    elements.formatWarning = document.getElementById('formatWarning');
    elements.originalSizeDisplay = document.getElementById('originalSizeDisplay');

    // Only require essential elements - some like formatWarning, originalSizeDisplay are optional
    const requiredElements = [
        'uploadArea', 'fileInput', 'controlsSection', 'resultsSection',
        'qualitySlider', 'qualityValue', 'maxWidth', 'widthValue',
        'maxHeight', 'heightValue', 'formatSelect', 'optimizeBtn',
        'targetSizeToggle', 'targetSizeInput', 'targetSizeValue',
        'targetSizeWrapper', 'batchTools', 'batchCount', 'batchSavings',
        'batchGridToggle', 'batchGridWrapper', 'batchGrid', 'downloadAllBtn',
        'themeToggle'
    ];
    return requiredElements.every(key => elements[key] !== null);
}
